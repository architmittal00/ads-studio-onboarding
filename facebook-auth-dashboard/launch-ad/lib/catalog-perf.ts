// Shared by the desktop and phone layouts of Catalog Ads.

export interface Row {
  id: string; name: string; adset: string; campaign: string; status: string; thumb: string;
  productSetId: string; catalogId: string; isCatalog: boolean;
  spend: number; reach: number; impressions: number; clicks: number; purchases: number; value: number;
}
export interface Catalog { id: string; name: string; product_count?: number; relevance?: string }

/** Totals and ratios for a group of ads. Reach is summed across ads, so people reached by several ads count more than once. */
export function totals(rows: Row[]) {
  const t = rows.reduce((a, r) => ({ spend: a.spend + r.spend, reach: a.reach + r.reach, impressions: a.impressions + r.impressions, clicks: a.clicks + r.clicks, purchases: a.purchases + r.purchases, value: a.value + r.value }), { spend: 0, reach: 0, impressions: 0, clicks: 0, purchases: 0, value: 0 });
  return {
    ...t,
    ads: rows.length,
    live: rows.filter((r) => r.status === 'ACTIVE').length,
    roas: t.spend ? t.value / t.spend : 0,
    ctr: t.impressions ? (t.clicks / t.impressions) * 100 : 0,
    cpa: t.purchases ? t.spend / t.purchases : 0,
    cpm: t.impressions ? (t.spend / t.impressions) * 1000 : 0,
    frequency: t.reach ? t.impressions / t.reach : 0,
  };
}
export const rowMetrics = (r: Row) => ({
  roas: r.spend ? r.value / r.spend : 0, cpr: r.purchases ? r.spend / r.purchases : 0,
  cpm: r.impressions ? (r.spend / r.impressions) * 1000 : 0, ctr: r.impressions ? (r.clicks / r.impressions) * 100 : 0,
});

export const STATUS_TONE: Record<string, string> = { ACTIVE: 'ok', WITH_ISSUES: 'bad', DISAPPROVED: 'bad' };

