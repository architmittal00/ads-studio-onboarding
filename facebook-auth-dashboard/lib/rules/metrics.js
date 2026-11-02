import { pickPurchaseCount, pickPurchaseValue } from "@/lib/metrics";

// Every rule compares an entity against the account over the same trailing windows
// (full days ending yesterday, in the account's time zone).
export const WINDOWS = [3, 7, 14, 30];

export function emptyAgg() {
  return { spend: 0, impressions: 0, clicks: 0, purchases: 0, revenue: 0 };
}

export function addInsightsRow(agg, row) {
  agg.spend += parseFloat(row.spend || 0) || 0;
  agg.impressions += parseFloat(row.impressions || 0) || 0;
  agg.clicks += parseFloat(row.clicks || 0) || 0;
  agg.purchases += pickPurchaseCount(row.actions) || 0;
  agg.revenue += pickPurchaseValue(row.action_values) || 0;
}

// Ratios are null (never 0) when their denominator is 0, so a rule can't match on "no data".
export function derive(a) {
  return {
    spend: a.spend,
    purchases: a.purchases,
    revenue: a.revenue,
    roas: a.spend > 0 ? a.revenue / a.spend : null,
    cpr: a.purchases > 0 ? a.spend / a.purchases : null,
    cpm: a.impressions > 0 ? (a.spend / a.impressions) * 1000 : null,
    ctr: a.impressions > 0 ? (a.clicks / a.impressions) * 100 : null,
    cpc: a.clicks > 0 ? a.spend / a.clicks : null,
    cvr: a.clicks > 0 ? (a.purchases / a.clicks) * 100 : null,
  };
}
