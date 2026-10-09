import { graphGetInsights } from "@/lib/facebookGraph";
import { pickPurchaseCount, roasFromRow } from "@/lib/metrics";
import { getCachedReport, setCachedReport } from "@/lib/reportCache";
import { lastNDaysRange } from "@/lib/adCreativeDetails";
import { requireReportRequest, settled, groupAndPareto, capitalize } from "@/lib/reportShared";

// Where 80% of purchase revenue comes from, by age/gender — one Graph call,
// fully independent of every other report section. Split into its own
// endpoint (see pages/api/fb/report/core.js for the full picture) so it
// shows up the moment this one call resolves, rather than waiting on
// whichever other section happens to be slowest.
export default async function handler(req, res) {
  const ctx = await requireReportRequest(req, res, lastNDaysRange);
  if (!ctx) return;
  const { token, accountId, graphTimeRange, force, cacheKeyBase } = ctx;
  const cacheKey = `${cacheKeyBase}:age-gender`;

  if (!force) {
    const cached = getCachedReport(cacheKey);
    if (cached) return res.status(200).json({ ...cached.data, cachedAt: cached.fetchedAt, fromCache: true });
  }

  const warnings = [];
  const [ageGenderResult] = await Promise.allSettled([
    graphGetInsights(`/${accountId}/insights`, token, {
      fields: "spend,actions,action_values,purchase_roas",
      time_range: graphTimeRange,
      breakdowns: "age,gender",
      limit: 500,
    }),
  ]);

  const ageGenderJson = settled(ageGenderResult, null);
  if (ageGenderResult.status === "rejected") warnings.push(`Age/gender breakdown unavailable: ${ageGenderResult.reason.message}`);
  const ageGenderRows = (ageGenderJson?.data || []).map((row) => {
    const { spend, revenue } = roasFromRow(row);
    return { spend, revenue, purchases: pickPurchaseCount(row.actions), age: row.age, gender: row.gender };
  });
  const purchasesByAgeGender = groupAndPareto(
    ageGenderRows,
    (r) => (r.age && r.gender ? `${r.age} · ${capitalize(r.gender)}` : null)
  );

  const payload = { purchasesByAgeGender, warnings };
  setCachedReport(cacheKey, payload);
  res.status(200).json({ ...payload, cachedAt: Date.now(), fromCache: false });
}
