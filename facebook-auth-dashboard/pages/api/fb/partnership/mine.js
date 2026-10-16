import { getServerSession } from "next-auth/next";
import { authOptions } from "../../auth/[...nextauth]";
import { graphGetInsights } from "@/lib/facebookGraph";
import { fetchPartnershipAds } from "@/lib/partnershipDetection";
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
    const ads = await fetchPartnershipAds(token, accountId);
    if (ads.length === 0) {
      return res.status(200).json({ ads: [] });
    }

    const idChunks = chunk(
      ads.map((a) => a.adId),
      INSIGHTS_CHUNK_SIZE
    );
    const insightsResults = await Promise.allSettled(
      idChunks.map((ids) =>
        graphGetInsights(`/${accountId}/insights`, token, {
          level: "ad",
          fields: INSIGHTS_FIELDS,
          filtering: [{ field: "ad.id", operator: "IN", value: ids }],
          time_range: lastNDaysRange(30, new Date()),
          limit: 500,
        })
      )
    );

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

    const enriched = ads.map((ad) => ({ ...ad, ...(metricsByAdId.get(ad.adId) || {}) }));
    res.status(200).json({ ads: enriched });
  } catch (err) {
    res.status(err.graphResponse ? 400 : 500).json({ error: err.message });
  }
}
