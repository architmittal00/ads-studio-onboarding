import { getServerSession } from "next-auth/next";
import { authOptions } from "../../auth/[...nextauth]";
import { graphGetInsights } from "@/lib/facebookGraph";
import { fetchPartnershipAds } from "@/lib/partnershipDetection";
import { lookupContent } from "@/lib/partnershipAds";
import { roasFromRow, pickPurchaseCount, pickPurchaseValue } from "@/lib/metrics";
import { lastNDaysRange, chunk } from "@/lib/adCreativeDetails";

// Backs the "My Partnership Ads" tab and feeds the Overview tab's own
// rollup. Detection (which ads are partnership ads at all) is a live Graph
// check, not a locally-tracked log — see lib/partnershipDetection.js's own
// comment for why, and for what to do if that check turns out not to work
// against a real account. Performance is a plain 30-day Insights lookup
// filtered to exactly those ad ids, same metric derivation
// (roasFromRow/pickPurchaseCount) every other report in this app already
// uses — not reinvented here.
const INSIGHTS_FIELDS = "ad_id,spend,actions,action_values,purchase_roas,ctr,cpm";
const INSIGHTS_CHUNK_SIZE = 50;
// The Content Discovery API's own direct-lookup cap on how many permalinks
// one call can resolve at once (same limit lib/partnershipAds.js's
// lookupContent documents for ad_codes/permalinks/content_ids).
const PERMALINK_LOOKUP_CHUNK_SIZE = 50;

// Resolves each ad's underlying creator (display name/ig id) by matching its
// creative's own `instagram_permalink_url` back through the Content
// Discovery API's permalink lookup — there's no `creator`/`author` field on
// an Ad or AdCreative object directly, so this is the only path from "an ad
// that happens to be branded content" to "whose content it actually is."
// Best-effort: an ad whose permalink doesn't resolve (deleted post, access
// restriction, lookup failure) just keeps `creatorUsername: null` rather
// than failing the whole request — only used by Creator Hub's own grouping,
// which already treats a missing creator as its own bucket.
async function resolveCreators(token, businessId, igUserId, ads) {
  const byPermalink = new Map();
  const withPermalink = ads.filter((a) => a.instagramPermalinkUrl);
  if (!businessId || !igUserId || withPermalink.length === 0) return byPermalink;

  const chunks = chunk(
    withPermalink.map((a) => a.instagramPermalinkUrl),
    PERMALINK_LOOKUP_CHUNK_SIZE
  );
  const results = await Promise.allSettled(chunks.map((permalinks) => lookupContent(token, businessId, { igUserId, permalinks })));
  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    for (const item of result.value) {
      if (item.permalink) byPermalink.set(item.permalink, item.author);
    }
  }
  return byPermalink;
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session?.accessToken) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  const { accountId, businessId, igUserId, since, until } = req.query;
  if (!accountId) {
    return res.status(400).json({ error: "accountId is required" });
  }

  const token = session.accessToken;
  // Optional — defaults to the last 30 days, same as this route's own
  // previously-hardcoded window (see lib/partnershipDetection.js's
  // fetchPartnershipAds for why it now needs a bounded range at all).
  const range = since && until ? { since, until } : lastNDaysRange(30, new Date());
  try {
    const ads = await fetchPartnershipAds(token, accountId, range);
    if (ads.length === 0) {
      return res.status(200).json({ ads: [] });
    }

    const idChunks = chunk(
      ads.map((a) => a.adId),
      INSIGHTS_CHUNK_SIZE
    );
    const [insightsResults, creatorsByPermalink] = await Promise.all([
      Promise.allSettled(
        idChunks.map((ids) =>
          graphGetInsights(`/${accountId}/insights`, token, {
            level: "ad",
            fields: INSIGHTS_FIELDS,
            filtering: [{ field: "ad.id", operator: "IN", value: ids }],
            time_range: range,
            limit: 500,
          })
        )
      ),
      resolveCreators(token, businessId, igUserId, ads).catch(() => new Map()),
    ]);

    const metricsByAdId = new Map();
    for (const result of insightsResults) {
      if (result.status !== "fulfilled") continue;
      for (const row of result.value.data || []) {
        const { spend, roas } = roasFromRow(row);
        const purchases = pickPurchaseCount(row.actions);
        const purchaseValue = pickPurchaseValue(row.action_values);
        metricsByAdId.set(row.ad_id, {
          spend,
          roas,
          purchases,
          purchaseValue,
          cpr: purchases > 0 ? spend / purchases : null,
          ctr: row.ctr != null ? parseFloat(row.ctr) : null,
          cpm: row.cpm != null ? parseFloat(row.cpm) : null,
        });
      }
    }

    const enriched = ads.map((ad) => {
      const author = ad.instagramPermalinkUrl ? creatorsByPermalink.get(ad.instagramPermalinkUrl) : null;
      return {
        ...ad,
        ...(metricsByAdId.get(ad.adId) || {}),
        creatorUsername: author?.display_name || null,
        creatorIgId: author?.ig_user_id || null,
      };
    });
    res.status(200).json({ ads: enriched });
  } catch (err) {
    res.status(err.graphResponse ? 400 : 500).json({ error: err.message });
  }
}
