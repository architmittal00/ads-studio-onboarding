import { graphGetInsights } from "@/lib/facebookGraph";
import { pickPurchaseCount, roasFromRow } from "@/lib/metrics";
import { getCachedReport, setCachedReport } from "@/lib/reportCache";
import { lastNDaysRange } from "@/lib/adCreativeDetails";
import { requireReportRequest, settled, groupAndPareto } from "@/lib/reportShared";

// Where 80% of ad spend goes, by state — one Graph call, fully independent
// of every other report section. Split into its own endpoint (see
// pages/api/fb/report/core.js for the full picture) so it shows up the
// moment this one call resolves, rather than waiting on whichever other
// section happens to be slowest.
export default async function handler(req, res) {
  const ctx = await requireReportRequest(req, res, lastNDaysRange);
  if (!ctx) return;
  const { token, accountId, graphTimeRange, force, cacheKeyBase } = ctx;
  const cacheKey = `${cacheKeyBase}:region`;

  if (!force) {
    const cached = getCachedReport(cacheKey);
    if (cached) return res.status(200).json({ ...cached.data, cachedAt: cached.fetchedAt, fromCache: true });
  }

  const warnings = [];
  const [regionResult] = await Promise.allSettled([
    graphGetInsights(`/${accountId}/insights`, token, {
      fields: "spend,actions,action_values,purchase_roas",
      time_range: graphTimeRange,
      breakdowns: "region",
      limit: 500,
    }),
  ]);

  // Facebook doesn't return purchase/action_values data broken down by
  // region for this account (confirmed: real spend/clicks per state, but
  // zero purchase actions in any row — a Meta Aggregated Event Measurement
  // restriction on geographic breakdowns for web conversions, not a fetch
  // issue here). So this is a spend pareto, not a revenue one like the other
  // breakdowns — top 80% of spend by state, rather than purchase revenue.
  const regionJson = settled(regionResult, null);
  if (regionResult.status === "rejected") warnings.push(`Region breakdown unavailable: ${regionResult.reason.message}`);
  const regionRows = (regionJson?.data || []).map((row) => {
    const { spend, revenue } = roasFromRow(row);
    return { spend, revenue, purchases: pickPurchaseCount(row.actions), region: row.region };
  });
  const spendByRegion = groupAndPareto(regionRows, (r) => r.region || null, { metric: "spend" });

  const payload = { spendByRegion, warnings };
  setCachedReport(cacheKey, payload);
  res.status(200).json({ ...payload, cachedAt: Date.now(), fromCache: false });
}
