import { graphGetInsights } from "@/lib/facebookGraph";
import { pickPurchaseCount, roasFromRow } from "@/lib/metrics";
import { getCachedReport, setCachedReport } from "@/lib/reportCache";
import { lastNDaysRange } from "@/lib/adCreativeDetails";
import { requireReportRequest, daysBetween, settled, bestBucket, toDateStr } from "@/lib/reportShared";

// Overview KPIs + their trend chart + Best Week/Month — the cheapest, most
// independent slice of the old single /api/fb/report handler (4 plain
// aggregate `/insights` calls, no breakdowns, no ad-level fan-out), split
// into its own endpoint so it's typically the first section of the report
// to finish, rather than being held up by the much heavier ad-level/
// breakdown work the other sections need. See pages/api/fb/report/core.js's
// header comment for the full picture of how the report got split up.
export default async function handler(req, res) {
  const ctx = await requireReportRequest(req, res, lastNDaysRange);
  if (!ctx) return;
  const { token, accountId, today, range, graphTimeRange, force, cacheKeyBase } = ctx;
  const cacheKey = `${cacheKeyBase}:headline`;

  if (!force) {
    const cached = getCachedReport(cacheKey);
    if (cached) return res.status(200).json({ ...cached.data, cachedAt: cached.fetchedAt, fromCache: true });
  }

  // Trend chart granularity: daily for a month or less, weekly beyond that —
  // mirrors how Ads Manager switches granularity on its own trend charts.
  const rangeDays = daysBetween(range.since, range.until);
  const trendIncrement = rangeDays <= 31 ? 1 : 7;

  const since90 = new Date(today);
  since90.setDate(today.getDate() - 90);
  const since6mo = new Date(today);
  since6mo.setMonth(today.getMonth() - 6);

  const warnings = [];

  const [overviewResult, trendResult, weeklyResult, monthlyResult] = await Promise.allSettled([
    graphGetInsights(`/${accountId}/insights`, token, {
      fields: "spend,clicks,ctr,actions,action_values,purchase_roas",
      time_range: graphTimeRange,
    }),
    graphGetInsights(`/${accountId}/insights`, token, {
      fields: "spend,clicks,ctr,actions,action_values,purchase_roas",
      time_range: graphTimeRange,
      time_increment: trendIncrement,
    }),
    graphGetInsights(`/${accountId}/insights`, token, {
      fields: "spend,actions,action_values,purchase_roas",
      time_range: { since: toDateStr(since90), until: toDateStr(today) },
      time_increment: 7,
    }),
    graphGetInsights(`/${accountId}/insights`, token, {
      fields: "spend,actions,action_values,purchase_roas",
      time_range: { since: toDateStr(since6mo), until: toDateStr(today) },
      time_increment: "monthly",
    }),
  ]);

  const overviewJson = settled(overviewResult, null);
  if (overviewResult.status === "rejected") warnings.push(`Overview metrics unavailable: ${overviewResult.reason.message}`);
  const overviewRow = overviewJson?.data?.[0];
  const overview = overviewRow
    ? (() => {
        const { spend, revenue, roas } = roasFromRow(overviewRow);
        const clicks = parseFloat(overviewRow.clicks || 0);
        const ctr = parseFloat(overviewRow.ctr || 0);
        const purchases = pickPurchaseCount(overviewRow.actions);
        const cvr = clicks > 0 ? (purchases / clicks) * 100 : 0;
        return { spend, revenue, roas, ctr, purchases, cvr };
      })()
    : { spend: 0, revenue: 0, roas: 0, ctr: 0, purchases: 0, cvr: 0 };

  const trendJson = settled(trendResult, null);
  if (trendResult.status === "rejected") warnings.push(`Trend chart data unavailable: ${trendResult.reason.message}`);
  const trendPoints = (trendJson?.data || []).map((row) => {
    const { spend, roas } = roasFromRow(row);
    const clicks = parseFloat(row.clicks || 0);
    const ctr = parseFloat(row.ctr || 0);
    const purchases = pickPurchaseCount(row.actions);
    const cvr = clicks > 0 ? (purchases / clicks) * 100 : 0;
    return { since: row.date_start, until: row.date_stop, spend, purchases, roas, ctr, cvr };
  });
  const trend = { granularity: trendIncrement === 1 ? "daily" : "weekly", points: trendPoints };

  const weeklyJson = settled(weeklyResult, null);
  if (weeklyResult.status === "rejected") warnings.push(`Weekly trend unavailable: ${weeklyResult.reason.message}`);
  const monthlyJson = settled(monthlyResult, null);
  if (monthlyResult.status === "rejected") warnings.push(`Monthly trend unavailable: ${monthlyResult.reason.message}`);

  const bestWeek = bestBucket(weeklyJson?.data, roasFromRow);
  const bestMonth = bestBucket(monthlyJson?.data, roasFromRow);

  const payload = { dateRange: range, overview, trend, bestWeek, bestMonth, warnings };
  setCachedReport(cacheKey, payload);
  res.status(200).json({ ...payload, cachedAt: Date.now(), fromCache: false });
}
