// Client-side aggregation over /api/fb/catalog-ads/performance rows — ported
// from sr-ads-launch's CatalogAdsApp.tsx (totals()/rowMetrics()). Kept as
// plain functions, not baked into the endpoint itself, since the Overview,
// My Catalog Ads and Product Sets tabs each aggregate a different slice of
// the same rows (catalog vs. normal, per-ad, grouped by product set).

// Totals and ratios for a group of ads. Reach is summed across ads, so
// someone reached by several ads counts more than once — the same
// trade-off this app's own report already makes for reach anywhere it's
// combined across multiple entities.
export function totals(rows) {
  const t = rows.reduce(
    (a, r) => ({
      spend: a.spend + r.spend,
      reach: a.reach + r.reach,
      impressions: a.impressions + r.impressions,
      clicks: a.clicks + r.clicks,
      purchases: a.purchases + r.purchases,
      value: a.value + r.value,
    }),
    { spend: 0, reach: 0, impressions: 0, clicks: 0, purchases: 0, value: 0 }
  );
  return {
    ...t,
    ads: rows.length,
    live: rows.filter((r) => r.status === "ACTIVE").length,
    roas: t.spend ? t.value / t.spend : 0,
    ctr: t.impressions ? (t.clicks / t.impressions) * 100 : 0,
    cpa: t.purchases ? t.spend / t.purchases : 0,
    cpm: t.impressions ? (t.spend / t.impressions) * 1000 : 0,
    frequency: t.reach ? t.impressions / t.reach : 0,
  };
}

export function rowMetrics(r) {
  return {
    roas: r.spend ? r.value / r.spend : 0,
    cpr: r.purchases ? r.spend / r.purchases : 0,
    cpm: r.impressions ? (r.spend / r.impressions) * 1000 : 0,
    ctr: r.impressions ? (r.clicks / r.impressions) * 100 : 0,
  };
}
