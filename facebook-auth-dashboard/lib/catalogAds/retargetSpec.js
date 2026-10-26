// Catalog retargeting options and audience-spec resolution — ported from
// sr-ads-launch's src/lib/constants.ts (RETARGET_PRESETS/CATALOG_EVENTS/
// catalogAudienceSpec), field names unchanged from the source's FormState
// shape since this plugs directly into components/catalogads' own form
// state (see CatalogAudienceFields.js).

// Meta's catalog retargeting presets (Ads Manager wording).
export const RETARGET_PRESETS = [
  { key: "VIEWED_OR_ATC", label: "Viewed or added to cart but not purchased" },
  { key: "ATC", label: "Added to cart but not purchased" },
  { key: "UPSELL", label: "Upsell products" },
  { key: "CROSS_SELL", label: "Cross-sell products" },
  { key: "CUSTOM", label: "Custom combination" },
];

// Events usable in a custom combination.
export const CATALOG_EVENTS = [
  { key: "ViewContent", label: "Viewed" },
  { key: "AddToCart", label: "Added to cart" },
  { key: "Purchase", label: "Purchased" },
];

// Resolves a retargeting preset into the events, exclusion and product set
// Meta's product_audience_specs needs.
export function catalogAudienceSpec(a) {
  switch (a.retargetPreset) {
    case "VIEWED_OR_ATC":
      return { events: ["ViewContent", "AddToCart"], exclude: true, excludeDays: a.retargetDays, sourceSetId: a.productSetId };
    case "ATC":
      return { events: ["AddToCart"], exclude: true, excludeDays: a.retargetDays, sourceSetId: a.productSetId };
    // Upsell: viewed or added to cart in one set, shown products from the ad set's own product set.
    case "UPSELL":
      return { events: ["ViewContent", "AddToCart"], exclude: false, excludeDays: 0, sourceSetId: a.crossSellSourceSetId };
    // Cross-sell: purchased from one set, shown products from the ad set's own product set.
    case "CROSS_SELL":
      return { events: ["Purchase"], exclude: false, excludeDays: 0, sourceSetId: a.crossSellSourceSetId };
    default:
      return { events: a.retargetEvents, exclude: a.excludePurchasers, excludeDays: a.excludeDays, sourceSetId: a.productSetId };
  }
}
