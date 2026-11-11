import { pickPurchaseCount, pickPurchaseValue } from "@/lib/metrics";

// Every rule compares an entity against the account over the same trailing windows
// (full days ending yesterday, in the account's time zone).
export const WINDOWS = [3, 7, 14, 30];

export function emptyAgg() {
  return { spend: 0, impressions: 0, linkClicks: 0, purchases: 0, revenue: 0 };
}

export function addInsightsRow(agg, row) {
  agg.spend += parseFloat(row.spend || 0) || 0;
  agg.impressions += parseFloat(row.impressions || 0) || 0;
  // Link clicks (Ads Manager's "CPC (link click)" / "CTR (link click-through rate)"), not `clicks`,
  // which also counts reactions, profile and "see more" taps — same basis Custom Views uses.
  agg.linkClicks += parseFloat(row.inline_link_clicks || 0) || 0;
  agg.purchases += pickPurchaseCount(row.actions) || 0;
  agg.revenue += pickPurchaseValue(row.action_values) || 0;
}

// Ratios are null (never 0) when their denominator is 0, so a rule can't match on "no data".
// The days just before the last 3 (days 4–7 ago): the 7-day window minus the 3-day one, so it needs no extra
// Insights call. Same ratios as derive(), null when there is nothing to divide by.
export function priorOf3(m) {
  const spend = m[7].spend - m[3].spend;
  const impressions = m[7].impressions - m[3].impressions;
  const linkClicks = m[7].linkClicks - m[3].linkClicks;
  return {
    cpc: linkClicks > 0 ? spend / linkClicks : null,
    ctr: impressions > 0 ? (linkClicks / impressions) * 100 : null,
  };
}

export function derive(a) {
  return {
    spend: a.spend,
    impressions: a.impressions,
    linkClicks: a.linkClicks,
    purchases: a.purchases,
    revenue: a.revenue,
    roas: a.spend > 0 ? a.revenue / a.spend : null,
    cpr: a.purchases > 0 ? a.spend / a.purchases : null,
    cpm: a.impressions > 0 ? (a.spend / a.impressions) * 1000 : null,
    ctr: a.impressions > 0 ? (a.linkClicks / a.impressions) * 100 : null,
    cpc: a.linkClicks > 0 ? a.spend / a.linkClicks : null,
    cvr: a.linkClicks > 0 ? (a.purchases / a.linkClicks) * 100 : null,
  };
}
