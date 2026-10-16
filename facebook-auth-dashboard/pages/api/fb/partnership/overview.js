import { getServerSession } from "next-auth/next";
import { authOptions } from "../../auth/[...nextauth]";
import { graphGet, graphGetInsights } from "@/lib/facebookGraph";
import { fetchPartnershipAds } from "@/lib/partnershipDetection";
import { roasFromRow, pickPurchaseCount, pickPurchaseValue } from "@/lib/metrics";
import { lastNDaysRange, chunk } from "@/lib/adCreativeDetails";

const ROLLUP_FIELDS = "spend,actions,action_values,purchase_roas,ctr,reach,frequency,impressions,clicks";
const FILTER_CHUNK_SIZE = 50;

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
async function rollupForAdIds(token, accountId, adIds, operator) {
  const idChunks = adIds.length > 0 ? chunk(adIds, FILTER_CHUNK_SIZE) : [[]];
  const results = await Promise.allSettled(
    idChunks.map((ids) =>
      graphGetInsights(`/${accountId}/insights`, token, {
        level: "account",
        fields: ROLLUP_FIELDS,
        ...(ids.length > 0 || operator === "NOT_IN" ? { filtering: [{ field: "ad.id", operator, value: ids }] } : {}),
        time_range: lastNDaysRange(30, new Date()),
      })
    )
  );

  const rows = results.filter((r) => r.status === "fulfilled").flatMap((r) => r.value.data || []);
  if (rows.length === 0) {
    return { spend: 0, roas: 0, purchases: 0, purchaseValue: 0, reach: 0, frequency: 0, ctr: 0, cpa: null, cpr: null, incrementalReach: 0 };
  }
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
// is every other ad in the account over the same 30-day window, not a
// separate concept of its own — computed via a NOT_IN filter on the same
// Insights edge, so both sides use identical aggregation logic.
export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session?.accessToken) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  const { accountId } = req.query;
  if (!accountId) {
    return res.status(400).json({ error: "accountId is required" });
  }

  const token = session.accessToken;
  try {
    const partnershipAds = await fetchPartnershipAds(token, accountId);
    const partnershipAdIds = partnershipAds.map((a) => a.adId);
    const activeCount = (statusList) => statusList.filter((s) => s === "ACTIVE").length;

    const [partnership, normal, totalActiveCount] = await Promise.all([
      partnershipAdIds.length > 0
        ? rollupForAdIds(token, accountId, partnershipAdIds, "IN")
        : Promise.resolve({ spend: 0, roas: 0, purchases: 0, purchaseValue: 0, reach: 0, frequency: 0, ctr: 0, cpa: null }),
      rollupForAdIds(token, accountId, partnershipAdIds, "NOT_IN"),
      // `summary=true` on a connection returns a count without paginating
      // every row — cheaper than listing every active ad just to count them.
      graphGet(`/${accountId}/ads`, token, {
        fields: "id",
        filtering: [{ field: "effective_status", operator: "IN", value: ["ACTIVE"] }],
        summary: true,
        limit: 1,
      })
        .then((json) => json.summary?.total_count ?? null)
        .catch(() => null),
    ]);

    const partnershipActiveAds = activeCount(partnershipAds.map((a) => a.status));
    res.status(200).json({
      partnership: { ...partnership, activeAds: partnershipActiveAds },
      normal: { ...normal, activeAds: totalActiveCount != null ? Math.max(totalActiveCount - partnershipActiveAds, 0) : null },
    });
  } catch (err) {
    res.status(err.graphResponse ? 400 : 500).json({ error: err.message });
  }
}
