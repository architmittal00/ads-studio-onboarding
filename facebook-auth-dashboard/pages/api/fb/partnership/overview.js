import { getServerSession } from "next-auth/next";
import { authOptions } from "../../auth/[...nextauth]";
import { graphGet, graphGetInsights } from "@/lib/facebookGraph";
import { discoverDeliveringAdIds, classifyPartnershipAds } from "@/lib/partnershipDetection";
import { roasFromRow, pickPurchaseCount, pickPurchaseValue } from "@/lib/metrics";
import { lastNDaysRange, chunk } from "@/lib/adCreativeDetails";

const ROLLUP_FIELDS = "spend,actions,action_values,purchase_roas,ctr,reach,frequency,impressions,clicks";
const FILTER_CHUNK_SIZE = 50;
const ZERO_ROLLUP = { spend: 0, roas: 0, purchases: 0, purchaseValue: 0, reach: 0, frequency: 0, ctr: 0, cpa: null };

// One account-level (not per-ad) Insights call filtered to a specific set of
// ad ids — `level: "account"` with an ad.id filter gives a correctly
// deduplicated Reach/Frequency across exactly that set, which summing
// several per-ad rows cannot (Reach is Facebook's own deduplicated,
// overlap-prone count — see lib/insightsMetrics.js's own comment on why this
// app never re-derives it from per-row sums elsewhere either). Chunked
// (IN-filter value lists have a practical size cap) and summed across
// chunks — summing re-introduces a small amount of cross-chunk reach overlap
// for very large ad-id sets, an accepted approximation, not a claim of
// perfect precision.
//
// Always `IN`, never `NOT_IN` — CORRECTION (reported live: the Normal Ads
// card showed every metric as a flat zero against a real account, with no
// visible error at all). `NOT_IN` was chunked the same way `IN` is here,
// which is simply wrong for that operator: each chunk's own "not in this
// one chunk of 50" result is nowhere near the true complement, and summing
// several such chunks is meaningless even before getting to whatever made
// every one of those particular calls fail outright on this account. The
// real fix is to never ask Facebook to compute the complement at all —
// the caller below already knows every delivering ad's id (via
// discoverDeliveringAdIds) and every partnership ad's id, so "Normal" is
// just the plain set difference, computed here in JS and passed in as an
// ordinary `IN` list, the same proven-working mechanism Partnership's own
// side already used. Whatever specifically made `NOT_IN` fail is now moot —
// it's never sent to Facebook — but it was being silently swallowed by
// Promise.allSettled + filter-fulfilled-only either way, same failure mode
// lib/adCopy.js's fetchCopyableAds was already corrected for once before:
// a real per-chunk error must not be indistinguishable from "this account
// genuinely spent zero," so an id list that isn't empty but still fails
// every chunk now throws instead of returning fabricated zeros.
async function rollupForAdIds(token, accountId, adIds, range) {
  if (adIds.length === 0) return { ...ZERO_ROLLUP };

  const idChunks = chunk(adIds, FILTER_CHUNK_SIZE);
  const results = await Promise.allSettled(
    idChunks.map((ids) =>
      graphGetInsights(`/${accountId}/insights`, token, {
        level: "account",
        fields: ROLLUP_FIELDS,
        filtering: [{ field: "ad.id", operator: "IN", value: ids }],
        time_range: range,
      })
    )
  );

  const fulfilled = results.filter((r) => r.status === "fulfilled");
  if (fulfilled.length === 0) {
    throw new Error("Could not load performance for these ads — see /logs for the underlying Graph error.");
  }
  const rows = fulfilled.flatMap((r) => r.value.data || []);
  if (rows.length === 0) return { ...ZERO_ROLLUP };

  let spend = 0;
  let purchases = 0;
  let purchaseValue = 0;
  let reach = 0;
  let impressions = 0;
  let clicks = 0;
  for (const row of rows) {
    const derived = roasFromRow(row);
    spend += derived.spend;
    purchases += pickPurchaseCount(row.actions);
    purchaseValue += pickPurchaseValue(row.action_values);
    reach += parseFloat(row.reach || 0);
    impressions += parseFloat(row.impressions || 0);
    clicks += parseFloat(row.clicks || 0);
  }
  return {
    spend,
    roas: spend > 0 ? purchaseValue / spend : 0,
    purchases,
    purchaseValue,
    reach,
    frequency: reach > 0 ? impressions / reach : 0,
    ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
    cpa: purchases > 0 ? spend / purchases : null,
  };
}

// Backs the Overview tab's Partnership Ads vs. Normal Ads comparison. "Normal"
// is every other ad with delivery in the same window, not a separate concept
// of its own — the plain complement of "every delivering ad" minus
// "partnership ads," both sides rolled up through the identical
// rollupForAdIds so they use identical aggregation logic.
export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session?.accessToken) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  const { accountId, since, until } = req.query;
  if (!accountId) {
    return res.status(400).json({ error: "accountId is required" });
  }

  const token = session.accessToken;
  // Optional — defaults to the last 30 days, same as before this became
  // choosable at all (see OverviewTab.js's own date-range picker). Kept
  // optional rather than required so nothing else changes for any other
  // future caller that doesn't care to pick a window.
  const range = since && until ? { since, until } : lastNDaysRange(30, new Date());
  try {
    // The live ACTIVE count does not depend on discovery/classification, so it starts
    // now and overlaps them instead of waiting its turn. `summary=true` returns just a
    // count, cheaper than listing every active ad. It is the account's CURRENT status,
    // independent of the chosen window.
    const activeCountPromise =
    graphGet(`/${accountId}/ads`, token, {
        fields: "id",
        filtering: [{ field: "effective_status", operator: "IN", value: ["ACTIVE", "IN_PROCESS"] }],
        summary: true,
        limit: 1,
      })
        .then((json) => json.summary?.total_count ?? null)
        .catch(() => null);
    const allAdIds = await discoverDeliveringAdIds(token, accountId, range);
    const partnershipAds = await classifyPartnershipAds(token, allAdIds);
    const partnershipAdIds = partnershipAds.map((a) => a.adId);
    const partnershipIdSet = new Set(partnershipAdIds);
    const normalAdIds = allAdIds.filter((id) => !partnershipIdSet.has(id));
    const activeCount = (statusList) => statusList.filter((s) => s === "ACTIVE").length;

    const [partnership, normal, totalActiveCount] = await Promise.all([
      rollupForAdIds(token, accountId, partnershipAdIds, range),
      rollupForAdIds(token, accountId, normalAdIds, range),
      activeCountPromise,
    ]);

    const partnershipActiveAds = activeCount(partnershipAds.map((a) => a.status));
    const normalActiveAds = totalActiveCount != null ? Math.max(totalActiveCount - partnershipActiveAds, 0) : null;
    res.status(200).json({
      partnership: { ...partnership, allAds: partnershipAdIds.length, activeAds: partnershipActiveAds },
      normal: { ...normal, allAds: normalAdIds.length, activeAds: normalActiveAds },
    });
  } catch (err) {
    res.status(err.graphResponse ? 400 : 500).json({ error: err.message });
  }
}
