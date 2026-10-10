import { pickPurchaseCount, pickPurchaseValue, roasFromRow } from "./metrics";

export const LEVEL_OPTIONS = [
  { value: "account", label: "Account" },
  { value: "campaign", label: "Campaign" },
  { value: "adset", label: "Ad Set" },
  { value: "ad", label: "Ad" },
];

// Fields always pulled in for a given level so a result row is labelable
// even if the user picked zero fields that happen to include a name — not
// exposed as metrics themselves, just identity/display plumbing. Parent-
// entity ids (campaign_id at the adset level; adset_id/campaign_id at the ad
// level) ride along for free in the same insights row Facebook already
// returns — included here so pages/api/fb/explore-insights.js's "only show
// these IDs" filter can match on them at any level, the same way it already
// could for parent names.
export const LEVEL_ID_FIELD = { account: null, campaign: "campaign_id", adset: "adset_id", ad: "ad_id" };
const LEVEL_NAME_FIELD = { account: null, campaign: "campaign_name", adset: "adset_name", ad: "ad_name" };
const LEVEL_EXTRA_FIELDS = {
  account: [],
  campaign: ["campaign_id", "campaign_name"],
  adset: ["adset_id", "adset_name", "campaign_id", "campaign_name"],
  ad: ["ad_id", "ad_name", "adset_id", "adset_name", "campaign_id", "campaign_name"],
};

// Curated, known-good single-select breakdown combinations — not a free
// multi-select of individual dimensions. Meta restricts which breakdowns can
// combine with each other and which are valid at which `level`, in ways
// this app has no reliable way to pre-validate; offering pre-combined groups
// (the first three below already proven working in pages/api/fb/report/age-gender.js, region.js, and placement.js)
// avoids producing mostly-400s, while Facebook's own error message still
// surfaces verbatim for the rare invalid case (e.g. a breakdown not valid at
// the chosen level).
export const BREAKDOWN_GROUPS = [
  { value: "none", label: "None (totals only)", breakdowns: [] },
  { value: "age_gender", label: "Age & Gender", breakdowns: ["age", "gender"] },
  { value: "country", label: "Country", breakdowns: ["country"] },
  { value: "region", label: "Region (State)", breakdowns: ["region"] },
  { value: "platform_placement", label: "Platform & Placement", breakdowns: ["publisher_platform", "platform_position"] },
  { value: "impression_device", label: "Impression Device", breakdowns: ["impression_device"] },
  {
    value: "hourly_advertiser_tz",
    label: "Hour of Day (advertiser time zone)",
    breakdowns: ["hourly_stats_aggregated_by_advertiser_time_zone"],
  },
];

export function getBreakdownGroup(value) {
  return BREAKDOWN_GROUPS.find((g) => g.value === value) || BREAKDOWN_GROUPS[0];
}

// Meta returns conversion counts/values as entries in an `actions`/
// `action_values` array (`{action_type, value}`), not their own top-level
// fields — the same shape lib/metrics.js's purchase-specific helpers already
// read. This is a small generalization of that pattern (try several known
// action_type strings for the same real-world event, since Meta has shipped
// more than one naming convention over time) for the handful of other
// conversion events exposed here, kept local to this catalog rather than
// expanding lib/metrics.js's already-shipped, purchase-specific helpers.
function pickAnyActionValue(entries, actionTypes) {
  if (!entries) return 0;
  const match = entries.find((entry) => actionTypes.includes(entry.action_type));
  return match ? parseFloat(match.value) : 0;
}

const ADD_TO_CART_TYPES = ["omni_add_to_cart", "add_to_cart", "offsite_conversion.fb_pixel_add_to_cart"];
const LEAD_TYPES = ["omni_lead", "lead", "offsite_conversion.fb_pixel_lead"];
const INITIATE_CHECKOUT_TYPES = [
  "omni_initiated_checkout",
  "initiate_checkout",
  "offsite_conversion.fb_pixel_initiate_checkout",
];
const ADD_PAYMENT_INFO_TYPES = [
  "omni_add_payment_info",
  "add_payment_info",
  "offsite_conversion.fb_pixel_add_payment_info",
];

// A single "video watched to X%" field is itself an actions-shaped array
// (`[{action_type: "video_view", value: "123"}]`) rather than a plain
// number — this reads the one entry out of it.
function firstActionValue(entries) {
  if (!entries || entries.length === 0) return 0;
  return parseFloat(entries[0].value || 0);
}

// The catalog every multi-select metric picker and the backend's field
// resolution is built from. `fields` is the underlying raw Graph API
// field(s) needed to compute this metric (deduped across every selected
// metric before the real request is made); `extract` reads it back out of
// one raw insights row. `format` drives both table number formatting and
// which metrics Phase 5's chart view can plot (only number/currency/percent/
// decimal are chartable — "text" rankings are table-only).
export const METRIC_CATALOG = [
  // Delivery
  { key: "spend", label: "Spend", group: "Delivery", format: "currency", fields: ["spend"], extract: (r) => parseFloat(r.spend || 0) },
  {
    key: "impressions",
    label: "Impressions",
    group: "Delivery",
    format: "number",
    fields: ["impressions"],
    extract: (r) => parseFloat(r.impressions || 0),
  },
  { key: "reach", label: "Reach", group: "Delivery", format: "number", fields: ["reach"], extract: (r) => parseFloat(r.reach || 0) },
  {
    key: "frequency",
    label: "Frequency",
    group: "Delivery",
    format: "decimal",
    fields: ["frequency"],
    extract: (r) => parseFloat(r.frequency || 0),
  },

  // Engagement
  { key: "clicks", label: "Clicks", group: "Engagement", format: "number", fields: ["clicks"], extract: (r) => parseFloat(r.clicks || 0) },
  {
    key: "unique_clicks",
    label: "Unique Clicks",
    group: "Engagement",
    format: "number",
    fields: ["unique_clicks"],
    extract: (r) => parseFloat(r.unique_clicks || 0),
  },
  { key: "ctr", label: "CTR", group: "Engagement", format: "percent", fields: ["ctr"], extract: (r) => parseFloat(r.ctr || 0) },
  {
    key: "unique_ctr",
    label: "Unique CTR",
    group: "Engagement",
    format: "percent",
    fields: ["unique_ctr"],
    extract: (r) => parseFloat(r.unique_ctr || 0),
  },
  {
    key: "inline_link_clicks",
    label: "Link Clicks",
    group: "Engagement",
    format: "number",
    fields: ["inline_link_clicks"],
    extract: (r) => parseFloat(r.inline_link_clicks || 0),
  },

  // Cost efficiency
  { key: "cpc", label: "CPC", group: "Cost", format: "currency", fields: ["cpc"], extract: (r) => parseFloat(r.cpc || 0) },
  { key: "cpm", label: "CPM", group: "Cost", format: "currency", fields: ["cpm"], extract: (r) => parseFloat(r.cpm || 0) },
  { key: "cpp", label: "CPP", group: "Cost", format: "currency", fields: ["cpp"], extract: (r) => parseFloat(r.cpp || 0) },

  // Conversions
  {
    key: "purchases",
    label: "Purchases",
    group: "Conversions",
    format: "number",
    fields: ["actions"],
    extract: (r) => pickPurchaseCount(r.actions),
  },
  {
    key: "revenue",
    label: "Purchase Value",
    group: "Conversions",
    format: "currency",
    fields: ["action_values"],
    extract: (r) => pickPurchaseValue(r.action_values),
  },
  {
    key: "roas",
    label: "ROAS",
    group: "Conversions",
    format: "decimal",
    fields: ["spend", "action_values", "purchase_roas"],
    extract: (r) => roasFromRow(r).roas,
  },
  {
    key: "add_to_cart",
    label: "Add to Cart",
    group: "Conversions",
    format: "number",
    fields: ["actions"],
    extract: (r) => pickAnyActionValue(r.actions, ADD_TO_CART_TYPES),
  },
  {
    key: "leads",
    label: "Leads",
    group: "Conversions",
    format: "number",
    fields: ["actions"],
    extract: (r) => pickAnyActionValue(r.actions, LEAD_TYPES),
  },
  {
    key: "landing_page_views",
    label: "Landing Page Views",
    group: "Conversions",
    format: "number",
    fields: ["actions"],
    extract: (r) => pickAnyActionValue(r.actions, ["landing_page_view"]),
  },
  {
    key: "initiate_checkout",
    label: "Initiate Checkout",
    group: "Conversions",
    format: "number",
    fields: ["actions"],
    extract: (r) => pickAnyActionValue(r.actions, INITIATE_CHECKOUT_TYPES),
  },
  {
    key: "add_payment_info",
    label: "Add Payment Info",
    group: "Conversions",
    format: "number",
    fields: ["actions"],
    extract: (r) => pickAnyActionValue(r.actions, ADD_PAYMENT_INFO_TYPES),
  },

  // Video
  {
    key: "video_p25",
    label: "Video 25% Watched",
    group: "Video",
    format: "number",
    fields: ["video_p25_watched_actions"],
    extract: (r) => firstActionValue(r.video_p25_watched_actions),
  },
  {
    key: "video_p50",
    label: "Video 50% Watched",
    group: "Video",
    format: "number",
    fields: ["video_p50_watched_actions"],
    extract: (r) => firstActionValue(r.video_p50_watched_actions),
  },
  {
    key: "video_p75",
    label: "Video 75% Watched",
    group: "Video",
    format: "number",
    fields: ["video_p75_watched_actions"],
    extract: (r) => firstActionValue(r.video_p75_watched_actions),
  },
  {
    key: "video_p100",
    label: "Video 100% Watched",
    group: "Video",
    format: "number",
    fields: ["video_p100_watched_actions"],
    extract: (r) => firstActionValue(r.video_p100_watched_actions),
  },
  // Hook/Hold Rate are this catalog's first metrics derived from two raw
  // Graph fields read directly in `extract` (roas is the closest existing
  // precedent, one scalar + one actions array; these are two actions
  // arrays). Division by zero returns `null`, not `Infinity` — `a/0` is a
  // real JS number `formatMetricValue`'s isNaN guard won't catch, and would
  // otherwise print literally as "Infinity".
  {
    key: "hook_rate",
    label: "Hook Rate",
    group: "Video",
    format: "percent",
    fields: ["video_play_actions", "impressions"],
    extract: (r) => {
      const plays = firstActionValue(r.video_play_actions);
      const impressions = parseFloat(r.impressions || 0);
      return impressions > 0 ? (plays / impressions) * 100 : null;
    },
  },
  {
    key: "hold_rate",
    label: "Hold Rate",
    group: "Video",
    format: "percent",
    // ThruPlay (video_thruplay_watched_actions) is only populated for video
    // ads actually optimized toward ThruPlay — for other ads Meta omits the
    // field entirely, which must render "—" (not applicable), not "0.00%"
    // (a real, measured zero). The explicit presence check is what tells
    // these two cases apart; firstActionValue alone can't, since it treats
    // "absent" and "present with 0" identically.
    fields: ["video_thruplay_watched_actions", "video_play_actions"],
    extract: (r) => {
      if (!r.video_thruplay_watched_actions) return null;
      const plays = firstActionValue(r.video_play_actions);
      const thruplays = firstActionValue(r.video_thruplay_watched_actions);
      return plays > 0 ? (thruplays / plays) * 100 : null;
    },
  },

  // Quality rankings — categorical text, not chartable
  {
    key: "quality_ranking",
    label: "Quality Ranking",
    group: "Quality",
    format: "text",
    fields: ["quality_ranking"],
    extract: (r) => r.quality_ranking || "unknown",
  },
  {
    key: "engagement_rate_ranking",
    label: "Engagement Rate Ranking",
    group: "Quality",
    format: "text",
    fields: ["engagement_rate_ranking"],
    extract: (r) => r.engagement_rate_ranking || "unknown",
  },
  {
    key: "conversion_rate_ranking",
    label: "Conversion Rate Ranking",
    group: "Quality",
    format: "text",
    fields: ["conversion_rate_ranking"],
    extract: (r) => r.conversion_rate_ranking || "unknown",
  },
];

export function getMetric(key) {
  return METRIC_CATALOG.find((m) => m.key === key);
}

// Merges the built-in catalog with a caller-supplied list of user-defined
// ratio metrics (`{id, label, numeratorKey, denominatorKey, format}`,
// persisted via lib/clientStorage.js's getCustomMetrics/setCustomMetrics)
// and a caller-supplied list of per-account discovered custom conversions
// (`{id, name, accountId, actionType}`, fetched via
// /api/fb/custom-conversions — see pages/explore.js) into one array shaped
// like ordinary catalog entries — everything built against METRIC_CATALOG
// for *display* (the metric-picker pills, the chart metric dropdown, the
// results table's column lookup) works unchanged against either kind of
// addition as long as it's handed this merged list instead. Neither kind of
// entry has `fields`/`extract` of its own (unlike a real catalog entry) —
// resolveGraphFields/deriveRowMetrics below resolve them separately: ratio
// metrics via their numeratorKey/denominatorKey, custom conversions via
// their actionType. Custom conversions get their own "Custom Conversions"
// group, distinct from ratio metrics' "Custom" group, so the two (one
// user-authored, one discovered from the account) aren't confused in the
// picker.
export function buildEffectiveCatalog(customMetrics, customEvents) {
  const customEntries = (customMetrics || []).map((cm) => ({
    key: cm.id,
    label: cm.label,
    group: "Custom",
    format: cm.format || "decimal",
    numeratorKey: cm.numeratorKey,
    denominatorKey: cm.denominatorKey,
  }));
  const eventEntries = (customEvents || []).map((ce) => ({
    key: ce.id,
    label: ce.name,
    group: "Custom Conversions",
    format: "number",
  }));
  return [...METRIC_CATALOG, ...customEntries, ...eventEntries];
}

// Shared number formatting for a metric's table cell/chart tooltip, driven
// by its catalog `format` tag — one place so the Explore table and chart
// always agree on how a given metric reads. `currency` is only used for
// `format: "currency"`; falls back to a plain number if omitted (matches
// the rest of this app's `money()`-less-currency fallback convention).
export function formatMetricValue(value, format, currency) {
  if (value == null) return "—";
  if (format === "text") return String(value);
  if (typeof value !== "number" || isNaN(value)) return "—";
  switch (format) {
    case "currency":
      if (!currency) return value.toFixed(2);
      try {
        return new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 2 }).format(value);
      } catch {
        return `${value.toFixed(2)} ${currency}`;
      }
    case "percent":
      return `${value.toFixed(2)}%`;
    case "decimal":
      return value.toFixed(2);
    case "number":
      return Math.round(value).toLocaleString("en-IN");
    default:
      return String(value);
  }
}

// Only these formats are plottable as a numeric axis — "text" rankings
// (quality_ranking etc.) are table-only.
const CHARTABLE_FORMATS = new Set(["number", "currency", "percent", "decimal"]);

export function isChartableMetric(key) {
  const metric = getMetric(key);
  return !!metric && CHARTABLE_FORMATS.has(metric.format);
}

// Deduped raw Graph API `fields` needed to compute every selected catalog
// metric, plus the chosen level's identifying fields, plus any raw
// passthrough field names typed into the "custom field" escape hatch, plus
// — for a selected user-defined ratio metric (`customMetrics`, keyed by
// `key`/`id` and matched against `metricKeys` the same way a built-in metric
// is) — whatever its numerator/denominator metrics themselves need, plus —
// for a selected discovered custom conversion (`customEvents`, same
// id-matching convention) — the `actions` field its value lives in. A custom
// metric/event has no `fields` of its own: a ratio metric's Graph-field needs
// are always whichever two built-in metrics (or raw field names) it
// references, and a custom conversion's is always `actions`.
export function resolveGraphFields(metricKeys, customFields, level, customMetrics = [], customEvents = []) {
  const fieldSet = new Set(LEVEL_EXTRA_FIELDS[level] || []);
  const customById = new Map(customMetrics.map((cm) => [cm.id, cm]));
  const eventById = new Map(customEvents.map((ce) => [ce.id, ce]));
  for (const key of metricKeys || []) {
    const builtin = getMetric(key);
    if (builtin) {
      builtin.fields.forEach((f) => fieldSet.add(f));
      continue;
    }
    const custom = customById.get(key);
    if (custom) {
      [custom.numeratorKey, custom.denominatorKey].forEach((k) => {
        const m = getMetric(k);
        if (m) m.fields.forEach((f) => fieldSet.add(f));
        else fieldSet.add(k);
      });
      continue;
    }
    if (eventById.has(key)) fieldSet.add("actions");
  }
  for (const field of customFields || []) {
    if (field) fieldSet.add(field.trim());
  }
  return [...fieldSet];
}

// Flattens one raw Graph API insights row into `{ [metricKey]: value }` for
// every chosen catalog metric, plus `{ [rawFieldName]: value }` for every
// raw custom field, plus `{ [customMetricId]: value }` for every selected
// user-defined ratio metric, plus `{ [customEventId]: value }` for every
// selected discovered custom conversion — so the client never needs to know
// Facebook's actual response shape, just `row[key]`. Two passes: built-ins
// (and raw custom fields) first, straight from the raw row; then custom
// ratios, which read their numerator/denominator out of what pass one
// already produced (falling back to the raw row for a raw-custom-field
// operand). Custom conversions don't need a second pass — like every other
// "Conversions" catalog entry, their value comes straight out of the raw
// row's own `actions` array via pickAnyActionValue, keyed by the specific
// action_type this account's custom conversion was assigned. A zero/missing/
// non-numeric denominator — or numerator — on a ratio metric yields `null`
// (not `0` or `Infinity`), matching this catalog's hook_rate/hold_rate
// convention; a custom conversion simply yields `0` when absent, the normal
// "no conversions this period" case, same as Leads/Add to Cart.
export function deriveRowMetrics(rawRow, metricKeys, customFields, customMetrics = [], customEvents = []) {
  const result = {};
  const customById = new Map(customMetrics.map((cm) => [cm.id, cm]));
  const eventById = new Map(customEvents.map((ce) => [ce.id, ce]));
  const builtinKeys = (metricKeys || []).filter((k) => !customById.has(k) && !eventById.has(k));
  const customKeys = (metricKeys || []).filter((k) => customById.has(k));
  const eventKeys = (metricKeys || []).filter((k) => eventById.has(k));

  for (const key of builtinKeys) {
    const metric = getMetric(key);
    if (metric) result[key] = metric.extract(rawRow);
  }
  for (const field of customFields || []) {
    if (field) result[field] = rawRow[field] ?? null;
  }
  for (const key of customKeys) {
    const cm = customById.get(key);
    const num = result[cm.numeratorKey] ?? rawRow[cm.numeratorKey];
    const den = result[cm.denominatorKey] ?? rawRow[cm.denominatorKey];
    result[key] = typeof num === "number" && typeof den === "number" && den !== 0 ? num / den : null;
  }
  for (const key of eventKeys) {
    result[key] = pickAnyActionValue(rawRow.actions, [eventById.get(key).actionType]);
  }
  return result;
}

// A stable identity for one row — the level's own id (so different
// campaigns/ad sets/ads never collide) plus every breakdown dimension's raw
// value (so "25-34, male" never matches "35-44, female"). Used to match a
// current-period row against its previous-period counterpart when
// comparing.
export function rowIdentityKey(row, level, breakdownGroupValue) {
  const idField = LEVEL_ID_FIELD[level];
  const idPart = idField ? row[idField] : "account";
  const group = getBreakdownGroup(breakdownGroupValue);
  const breakdownPart = group.breakdowns.map((b) => row[b] ?? "").join("|");
  return `${idPart}::${breakdownPart}`;
}

// The level-identifying name (e.g. an ad's name) — null at the account
// level, where there's no per-row entity to name.
export function rowEntityLabel(row, level) {
  const nameField = LEVEL_NAME_FIELD[level];
  return nameField ? row[nameField] ?? null : null;
}

// The breakdown dimension's value(s) for a row (e.g. "25-34, male") — null
// when no breakdown is selected.
export function rowBreakdownLabel(row, breakdownGroupValue) {
  const group = getBreakdownGroup(breakdownGroupValue);
  if (group.breakdowns.length === 0) return null;
  return group.breakdowns.map((b) => row[b]).filter(Boolean).join(", ") || null;
}

// Combined human label for a row — used where a single identifying string
// is actually wanted (the chart's category/x-axis/series-pivot key, where an
// ad name and its breakdown value together are exactly the right grouping
// key). The table shows the entity name and breakdown value as separate
// columns instead (see rowEntityLabel/rowBreakdownLabel) — combining them
// into one string there made an ad's own name indistinguishable from the
// breakdown value next to it.
export function rowLabel(row, level, breakdownGroupValue) {
  const namePart = rowEntityLabel(row, level);
  const breakdownPart = rowBreakdownLabel(row, breakdownGroupValue);
  return [namePart, breakdownPart].filter(Boolean).join(" — ") || "Total";
}
