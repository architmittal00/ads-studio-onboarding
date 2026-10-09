import { graphGetInsights } from "@/lib/facebookGraph";
import { pickPurchaseCount, roasFromRow } from "@/lib/metrics";
import { getCachedReport, setCachedReport } from "@/lib/reportCache";
import { lastNDaysRange } from "@/lib/adCreativeDetails";
import { requireReportRequest, settled, groupAndPareto, placementLabel } from "@/lib/reportShared";

// Where 80% of purchase revenue comes from, by platform & placement (e.g.
// "Instagram · Reels") — one Graph call, fully independent of every other
// report section. Split into its own endpoint (see
// pages/api/fb/report/core.js for the full picture) so it shows up the
// moment this one call resolves, rather than waiting on whichever other
// section happens to be slowest.
export default async function handler(req, res) {
  const ctx = await requireReportRequest(req, res, lastNDaysRange);
  if (!ctx) return;
  const { token, accountId, graphTimeRange, force, cacheKeyBase } = ctx;
  const cacheKey = `${cacheKeyBase}:placement`;

  if (!force) {
    const cached = getCachedReport(cacheKey);
    if (cached) return res.status(200).json({ ...cached.data, cachedAt: cached.fetchedAt, fromCache: true });
  }

  const warnings = [];
  const [platformResult] = await Promise.allSettled([
    graphGetInsights(`/${accountId}/insights`, token, {
      fields: "spend,actions,action_values,purchase_roas",
      time_range: graphTimeRange,
      breakdowns: "publisher_platform,platform_position",
      limit: 500,
    }),
  ]);

  const platformJson = settled(platformResult, null);
  if (platformResult.status === "rejected") warnings.push(`Platform/placement breakdown unavailable: ${platformResult.reason.message}`);
  const platformRows = (platformJson?.data || []).map((row) => {
    const { spend, revenue } = roasFromRow(row);
    return {
      spend,
      revenue,
      purchases: pickPurchaseCount(row.actions),
      platform: row.publisher_platform,
      position: row.platform_position,
    };
  });
  const purchasesByPlacement = groupAndPareto(platformRows, (r) => placementLabel(r.platform, r.position));

  const payload = { purchasesByPlacement, warnings };
  setCachedReport(cacheKey, payload);
  res.status(200).json({ ...payload, cachedAt: Date.now(), fromCache: false });
}
