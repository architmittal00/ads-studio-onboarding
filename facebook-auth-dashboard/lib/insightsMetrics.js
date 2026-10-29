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

// Shared null-on-zero-denominator convention for every funnel-step ratio
// below, same as cost_per_purchase/hook_rate/hold_rate elsewhere in this
// file — `null` (not `0` or `Infinity`) when the previous funnel step never
// happened, since "0%" would misleadingly read as a measured rate rather
// than "not computable".
function safePercent(numerator, denominator) {
  return denominator > 0 ? (numerator / denominator) * 100 : null;
}
function safeRatio(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : null;
}

// Sums one raw field/expression across a set of raw rows — the building
// block every catalog entry's `aggregate` (see below) combines into a
// correct multi-row total, instead of a totals row naively summing (or
// averaging) each row's own already-computed ratio.
function sumBy(rows, extract) {
  return rows.reduce((total, r) => total + (extract(r) || 0), 0);
}

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
// decimal are chartable — "text" rankings are table-only). `aggregate(rows)`,
// when present, combines an array of raw rows into this metric's correct
// multi-row total (e.g. a rate's total is its numerator's sum over its
// denominator's sum, not an average of each row's own rate) — powers the
// Explore results table's Total row (see aggregateRowMetrics below). Omitted
// entirely for a metric with no honest way to combine rows (Reach/Unique
// Clicks/Unique CTR are Facebook's own deduplicated, overlap-prone counts;
// Frequency/CPP derive from Reach; the Quality rankings are categorical) —
// its total then renders as "—", same as a genuinely inapplicable value.
export const METRIC_CATALOG = [
  // Delivery
  {
    key: "spend",
    label: "Spend",
    group: "Delivery",
    format: "currency",
    fields: ["spend"],
    extract: (r) => parseFloat(r.spend || 0),
    aggregate: (rows) => sumBy(rows, (r) => parseFloat(r.spend || 0)),
  },
  // `extract` is a placeholder, never meaningfully called — Budget isn't an
  // Insights-API field at all (it lives on the Campaign/Ad Set object
  // itself, fetched separately by pages/api/fb/explore-insights.js's
  // fetchEntityBudgets, already called unconditionally at Campaign/Ad Set
  // level for the "Change Budget" row action). Its real value is injected
  // directly onto each row once that lookup resolves, the same way `status`
  // is handled — catalog membership here is only so it shows up as a pill in
  // the metric picker and gets currency-formatted like everything else.
  // Null (not 0) at Account/Ad level or on a budget-less entity (e.g. an ad
  // set under a CBO campaign), same "—" convention as every other
  // inapplicable metric. No `aggregate` — a CBO campaign and its own
  // (budget-less) ad sets showing up together in one view have no honest way
  // to be summed without double-counting, same reasoning as Reach.
  { key: "budget", label: "Budget", group: "Delivery", format: "currency", fields: [], extract: () => null },
  {
    key: "impressions",
    label: "Impressions",
    group: "Delivery",
    format: "number",
    fields: ["impressions"],
    extract: (r) => parseFloat(r.impressions || 0),
    aggregate: (rows) => sumBy(rows, (r) => parseFloat(r.impressions || 0)),
  },
  // No `aggregate` — Reach is Facebook's own deduplicated "distinct people"
  // count per entity; the same person reached by two campaigns counts once
  // in each campaign's own Reach, so summing several campaigns' Reach
  // double-counts them. There's no field available here that corrects for
  // the overlap, so a combined Reach total renders as "—" rather than a
  // plausible-looking but wrong number — same reasoning this app already
  // applies when a rollup would otherwise merge several entities' Reach
  // (see REACH_DEPENDENT_KEYS in pages/api/fb/explore-insights.js).
  { key: "reach", label: "Reach", group: "Delivery", format: "number", fields: ["reach"], extract: (r) => parseFloat(r.reach || 0) },
  // No `aggregate` — Frequency (impressions ÷ Reach) inherits Reach's own
  // non-aggregatable overlap problem.
  {
    key: "frequency",
    label: "Frequency",
    group: "Delivery",
    format: "decimal",
    fields: ["frequency"],
    extract: (r) => parseFloat(r.frequency || 0),
  },

  // Engagement
  {
    key: "clicks",
    label: "Clicks",
    group: "Engagement",
    format: "number",
    fields: ["clicks"],
    extract: (r) => parseFloat(r.clicks || 0),
    aggregate: (rows) => sumBy(rows, (r) => parseFloat(r.clicks || 0)),
  },
  // No `aggregate` — Unique Clicks is a deduplicated "distinct people who
  // clicked" count, same overlap problem as Reach above.
  {
    key: "unique_clicks",
    label: "Unique Clicks",
    group: "Engagement",
    format: "number",
    fields: ["unique_clicks"],
    extract: (r) => parseFloat(r.unique_clicks || 0),
  },
  // Meta's own `ctr` field is all-clicks CTR (reactions/shares/comments
  // included, not just an actual click to the advertiser's site) — re-derived
  // from inline_link_clicks/impressions instead, the same "real" click basis
  // lpv_rate/click_to_atc_rate below already use, so "CTR" reads as the
  // link-click-through rate media buyers actually mean by it. `null` (not
  // `0`) on zero impressions, matching this catalog's other ratio metrics.
  {
    key: "ctr",
    label: "CTR",
    group: "Engagement",
    format: "percent",
    fields: ["inline_link_clicks", "impressions"],
    extract: (r) => safePercent(parseFloat(r.inline_link_clicks || 0), parseFloat(r.impressions || 0)),
    aggregate: (rows) =>
      safePercent(sumBy(rows, (r) => parseFloat(r.inline_link_clicks || 0)), sumBy(rows, (r) => parseFloat(r.impressions || 0))),
  },
  // No `aggregate` — derived from Unique Clicks, same overlap problem.
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
    aggregate: (rows) => sumBy(rows, (r) => parseFloat(r.inline_link_clicks || 0)),
  },

  // Cost efficiency
  // Same reasoning as `ctr` above — Meta's own `cpc` field divides spend by
  // every click (including reactions/shares/comments), not just an
  // inline/link click to the advertiser's site.
  {
    key: "cpc",
    label: "CPC",
    group: "Cost",
    format: "currency",
    fields: ["spend", "inline_link_clicks"],
    extract: (r) => safeRatio(parseFloat(r.spend || 0), parseFloat(r.inline_link_clicks || 0)),
    aggregate: (rows) => safeRatio(sumBy(rows, (r) => parseFloat(r.spend || 0)), sumBy(rows, (r) => parseFloat(r.inline_link_clicks || 0))),
  },
  {
    key: "cpm",
    label: "CPM",
    group: "Cost",
    format: "currency",
    fields: ["cpm"],
    extract: (r) => parseFloat(r.cpm || 0),
    // Re-derived from spend/impressions rather than averaging each row's own
    // `cpm` field — the two agree exactly when every row has equal
    // impressions, and diverge (correctly favoring the higher-impression
    // rows) otherwise.
    aggregate: (rows) => {
      const impressions = sumBy(rows, (r) => parseFloat(r.impressions || 0));
      return impressions > 0 ? (sumBy(rows, (r) => parseFloat(r.spend || 0)) / impressions) * 1000 : null;
    },
  },
  // CPP (Cost per 1,000 People Reached) temporarily removed from the catalog
  // per user feedback — reinstate by restoring this entry (its `extract`,
  // and its mentions in RATE_METRIC_KEYS/LOWER_IS_BETTER_METRIC_KEYS below,
  // and REACH_DEPENDENT_KEYS/REACH_DEPENDENT_METRIC_KEYS in
  // pages/api/fb/explore-insights.js and pages/explore.js, were all left in
  // place — nothing else needs to change to bring it back):
  // { key: "cpp", label: "CPP", group: "Cost", format: "currency", fields: ["cpp"], extract: (r) => parseFloat(r.cpp || 0) },
  // Meta's own "Cost per Result" is tied to whatever a campaign's
  // optimization goal is (purchases, leads, …), which isn't tracked
  // per-campaign anywhere in this app — this standardizes on purchases as
  // "the result," consistent with Purchases/ROAS/Purchase Value already
  // being this catalog's dominant conversion metrics. `null` (not `0` or
  // `Infinity`) on zero purchases, same convention as Hook Rate/Hold Rate.
  {
    key: "cost_per_purchase",
    label: "Cost Per Purchase (CPR)",
    group: "Cost",
    format: "currency",
    fields: ["spend", "actions"],
    extract: (r) => {
      const purchases = pickPurchaseCount(r.actions);
      const spend = parseFloat(r.spend || 0);
      return purchases > 0 ? spend / purchases : null;
    },
    aggregate: (rows) => {
      const purchases = sumBy(rows, (r) => pickPurchaseCount(r.actions));
      return purchases > 0 ? sumBy(rows, (r) => parseFloat(r.spend || 0)) / purchases : null;
    },
  },

  // Conversions
  {
    key: "purchases",
    label: "Purchases",
    group: "Conversions",
    format: "number",
    fields: ["actions"],
    extract: (r) => pickPurchaseCount(r.actions),
    aggregate: (rows) => sumBy(rows, (r) => pickPurchaseCount(r.actions)),
  },
  {
    key: "revenue",
    label: "Purchase Value",
    group: "Conversions",
    format: "currency",
    fields: ["action_values"],
    extract: (r) => pickPurchaseValue(r.action_values),
    aggregate: (rows) => sumBy(rows, (r) => pickPurchaseValue(r.action_values)),
  },
  {
    key: "roas",
    label: "ROAS",
    group: "Conversions",
    format: "decimal",
    fields: ["spend", "action_values", "purchase_roas"],
    extract: (r) => roasFromRow(r).roas,
    // Re-derived from summed revenue/spend rather than averaging each row's
    // own ROAS, same reasoning as every other rate metric here.
    aggregate: (rows) => {
      const spend = sumBy(rows, (r) => parseFloat(r.spend || 0));
      return spend > 0 ? sumBy(rows, (r) => pickPurchaseValue(r.action_values)) / spend : null;
    },
  },
  {
    key: "add_to_cart",
    label: "Add to Cart",
    group: "Conversions",
    format: "number",
    fields: ["actions"],
    extract: (r) => pickAnyActionValue(r.actions, ADD_TO_CART_TYPES),
    aggregate: (rows) => sumBy(rows, (r) => pickAnyActionValue(r.actions, ADD_TO_CART_TYPES)),
  },
  {
    key: "leads",
    label: "Leads",
    group: "Conversions",
    format: "number",
    fields: ["actions"],
    extract: (r) => pickAnyActionValue(r.actions, LEAD_TYPES),
    aggregate: (rows) => sumBy(rows, (r) => pickAnyActionValue(r.actions, LEAD_TYPES)),
  },
  {
    key: "landing_page_views",
    label: "Landing Page Views",
    group: "Conversions",
    format: "number",
    fields: ["actions"],
    extract: (r) => pickAnyActionValue(r.actions, ["landing_page_view"]),
    aggregate: (rows) => sumBy(rows, (r) => pickAnyActionValue(r.actions, ["landing_page_view"])),
  },
  {
    key: "initiate_checkout",
    label: "Initiate Checkout",
    group: "Conversions",
    format: "number",
    fields: ["actions"],
    extract: (r) => pickAnyActionValue(r.actions, INITIATE_CHECKOUT_TYPES),
    aggregate: (rows) => sumBy(rows, (r) => pickAnyActionValue(r.actions, INITIATE_CHECKOUT_TYPES)),
  },
  {
    key: "add_payment_info",
    label: "Add Payment Info",
    group: "Conversions",
    format: "number",
    fields: ["actions"],
    extract: (r) => pickAnyActionValue(r.actions, ADD_PAYMENT_INFO_TYPES),
    aggregate: (rows) => sumBy(rows, (r) => pickAnyActionValue(r.actions, ADD_PAYMENT_INFO_TYPES)),
  },

  // Funnel — step-over-step conversion rates, each a ratio of two of the
  // Conversions metrics above (re-derived from the same raw actions/
  // action_values arrays rather than referencing another catalog entry's
  // own `extract`, same self-contained-per-entry convention cost_per_purchase
  // already follows). Each `aggregate` mirrors its own `extract`'s formula,
  // just summing both sides across every row first.
  {
    key: "lpv_rate",
    label: "LPV %",
    group: "Funnel",
    format: "percent",
    fields: ["inline_link_clicks", "actions"],
    extract: (r) => safePercent(pickAnyActionValue(r.actions, ["landing_page_view"]), parseFloat(r.inline_link_clicks || 0)),
    aggregate: (rows) =>
      safePercent(
        sumBy(rows, (r) => pickAnyActionValue(r.actions, ["landing_page_view"])),
        sumBy(rows, (r) => parseFloat(r.inline_link_clicks || 0))
      ),
  },
  {
    key: "cart_rate",
    label: "Cart Rate %",
    group: "Funnel",
    format: "percent",
    fields: ["actions"],
    extract: (r) =>
      safePercent(pickAnyActionValue(r.actions, ADD_TO_CART_TYPES), pickAnyActionValue(r.actions, ["landing_page_view"])),
    aggregate: (rows) =>
      safePercent(
        sumBy(rows, (r) => pickAnyActionValue(r.actions, ADD_TO_CART_TYPES)),
        sumBy(rows, (r) => pickAnyActionValue(r.actions, ["landing_page_view"]))
      ),
  },
  {
    key: "click_to_atc_rate",
    label: "Click to ATC %",
    group: "Funnel",
    format: "percent",
    fields: ["inline_link_clicks", "actions"],
    extract: (r) => safePercent(pickAnyActionValue(r.actions, ADD_TO_CART_TYPES), parseFloat(r.inline_link_clicks || 0)),
    aggregate: (rows) =>
      safePercent(
        sumBy(rows, (r) => pickAnyActionValue(r.actions, ADD_TO_CART_TYPES)),
        sumBy(rows, (r) => parseFloat(r.inline_link_clicks || 0))
      ),
  },
  {
    key: "ic_rate",
    label: "IC %",
    group: "Funnel",
    format: "percent",
    fields: ["actions"],
    extract: (r) =>
      safePercent(pickAnyActionValue(r.actions, INITIATE_CHECKOUT_TYPES), pickAnyActionValue(r.actions, ["landing_page_view"])),
    aggregate: (rows) =>
      safePercent(
        sumBy(rows, (r) => pickAnyActionValue(r.actions, INITIATE_CHECKOUT_TYPES)),
        sumBy(rows, (r) => pickAnyActionValue(r.actions, ["landing_page_view"]))
      ),
  },
  {
    key: "ic_to_purchase_rate",
    label: "IC to Pur %",
    group: "Funnel",
    format: "percent",
    fields: ["actions"],
    extract: (r) => safePercent(pickPurchaseCount(r.actions), pickAnyActionValue(r.actions, INITIATE_CHECKOUT_TYPES)),
    aggregate: (rows) =>
      safePercent(
        sumBy(rows, (r) => pickPurchaseCount(r.actions)),
        sumBy(rows, (r) => pickAnyActionValue(r.actions, INITIATE_CHECKOUT_TYPES))
      ),
  },
  {
    key: "cvr_rate",
    label: "CVR %",
    group: "Funnel",
    format: "percent",
    fields: ["actions"],
    extract: (r) => safePercent(pickPurchaseCount(r.actions), pickAnyActionValue(r.actions, ["landing_page_view"])),
    aggregate: (rows) =>
      safePercent(
        sumBy(rows, (r) => pickPurchaseCount(r.actions)),
        sumBy(rows, (r) => pickAnyActionValue(r.actions, ["landing_page_view"]))
      ),
  },
  {
    key: "pi_rate",
    label: "PI %",
    group: "Funnel",
    format: "percent",
    fields: ["actions"],
    extract: (r) =>
      safePercent(pickAnyActionValue(r.actions, ADD_PAYMENT_INFO_TYPES), pickAnyActionValue(r.actions, ["landing_page_view"])),
    aggregate: (rows) =>
      safePercent(
        sumBy(rows, (r) => pickAnyActionValue(r.actions, ADD_PAYMENT_INFO_TYPES)),
        sumBy(rows, (r) => pickAnyActionValue(r.actions, ["landing_page_view"]))
      ),
  },
  {
    key: "pi_to_purchase_rate",
    label: "PI/Purchase %",
    group: "Funnel",
    format: "percent",
    fields: ["actions"],
    extract: (r) => safePercent(pickPurchaseCount(r.actions), pickAnyActionValue(r.actions, ADD_PAYMENT_INFO_TYPES)),
    aggregate: (rows) =>
      safePercent(
        sumBy(rows, (r) => pickPurchaseCount(r.actions)),
        sumBy(rows, (r) => pickAnyActionValue(r.actions, ADD_PAYMENT_INFO_TYPES))
      ),
  },
  {
    key: "aov",
    label: "AOV",
    group: "Funnel",
    format: "currency",
    fields: ["actions", "action_values"],
    extract: (r) => safeRatio(pickPurchaseValue(r.action_values), pickPurchaseCount(r.actions)),
    aggregate: (rows) =>
      safeRatio(
        sumBy(rows, (r) => pickPurchaseValue(r.action_values)),
        sumBy(rows, (r) => pickPurchaseCount(r.actions))
      ),
  },

  // Video
  {
    key: "video_p25",
    label: "Video 25% Watched",
    group: "Video",
    format: "number",
    fields: ["video_p25_watched_actions"],
    extract: (r) => firstActionValue(r.video_p25_watched_actions),
    aggregate: (rows) => sumBy(rows, (r) => firstActionValue(r.video_p25_watched_actions)),
  },
  {
    key: "video_p50",
    label: "Video 50% Watched",
    group: "Video",
    format: "number",
    fields: ["video_p50_watched_actions"],
    extract: (r) => firstActionValue(r.video_p50_watched_actions),
    aggregate: (rows) => sumBy(rows, (r) => firstActionValue(r.video_p50_watched_actions)),
  },
  {
    key: "video_p75",
    label: "Video 75% Watched",
    group: "Video",
    format: "number",
    fields: ["video_p75_watched_actions"],
    extract: (r) => firstActionValue(r.video_p75_watched_actions),
    aggregate: (rows) => sumBy(rows, (r) => firstActionValue(r.video_p75_watched_actions)),
  },
  {
    key: "video_p100",
    label: "Video 100% Watched",
    group: "Video",
    format: "number",
    fields: ["video_p100_watched_actions"],
    extract: (r) => firstActionValue(r.video_p100_watched_actions),
    aggregate: (rows) => sumBy(rows, (r) => firstActionValue(r.video_p100_watched_actions)),
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
    aggregate: (rows) =>
      safePercent(
        sumBy(rows, (r) => firstActionValue(r.video_play_actions)),
        sumBy(rows, (r) => parseFloat(r.impressions || 0))
      ),
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
    aggregate: (rows) => {
      const withThruplay = rows.filter((r) => r.video_thruplay_watched_actions);
      if (withThruplay.length === 0) return null;
      return safePercent(
        sumBy(withThruplay, (r) => firstActionValue(r.video_thruplay_watched_actions)),
        sumBy(withThruplay, (r) => firstActionValue(r.video_play_actions))
      );
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

  // Same out-of-band shape as `budget` above — the landing page isn't an
  // Insights-API field either (it lives on the ad's creative object), so
  // `extract` is a placeholder and the real value is injected onto each row
  // separately once it resolves. Only ever populated at Ad level: see
  // pages/api/fb/ad-landing-pages.js (the top-level, async, per-selected-
  // metric lookup pages/explore.js's own loadLandingPagesForView() fires) and
  // pages/api/fb/explore-insights.js's `includeCreative` block (the
  // synchronous drill-down/expand path, which already fetches ad creative
  // details for its thumbnail).
  { key: "landing_page", label: "Landing Page", group: "Creative", format: "text", fields: [], extract: () => null },
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

// The distinct `group` values present in a catalog, in first-seen order —
// shared by every metric picker (Explore, Copy Ads) instead of each one
// re-deriving `[...new Set(catalog.map(m => m.group))]` on its own.
export function catalogGroups(catalog) {
  return [...new Set(catalog.map((m) => m.group))];
}

// Shared number formatting for a metric's table cell/chart tooltip, driven
// by its catalog `format` tag — one place so the Explore table and chart
// always agree on how a given metric reads. `currency` is only used for
// `format: "currency"`; falls back to a plain number if omitted (matches
// the rest of this app's `money()`-less-currency fallback convention).
// `compact` (phone cards, where a cell is ~100px wide) abbreviates large
// currency/count values the Indian way — ₹1.2L, 3.4Cr — instead of
// "₹1,23,456.78", which would wrap or truncate.
export function formatMetricValue(value, format, currency, { compact = false } = {}) {
  if (value == null) return "—";
  if (format === "text") return String(value);
  if (typeof value !== "number" || isNaN(value)) return "—";
  switch (format) {
    case "currency":
      if (!currency) return value.toFixed(2);
      try {
        if (compact) {
          return new Intl.NumberFormat("en-IN", {
            style: "currency",
            currency,
            notation: "compact",
            maximumFractionDigits: 1,
          }).format(value);
        }
        return new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 2 }).format(value);
      } catch {
        return `${value.toFixed(2)} ${currency}`;
      }
    case "percent":
      return `${value.toFixed(2)}%`;
    case "decimal":
      return value.toFixed(2);
    case "number":
      if (compact) return new Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 1 }).format(value);
      return Math.round(value).toLocaleString("en-IN");
    default:
      return String(value);
  }
}

// Facebook's own `effective_status` values ("ACTIVE", "PAUSED",
// "CAMPAIGN_PAUSED", "PENDING_REVIEW", ...) title-cased for display — shared
// by Explore's results table and anywhere else a row carries a `status`
// field (pages/api/fb/explore-insights.js injects it onto every row at
// campaign/adset/ad level; pages/api/fb/recent-changes.js does the same for
// its own entities via a lighter-weight batched lookup).
export function humanizeStatus(status) {
  status = status === "IN_PROCESS" ? "ACTIVE" : status;
  return status
    ? status
        .toLowerCase()
        .split("_")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ")
    : "—";
}

// Only these formats are plottable as a numeric axis — "text" rankings
// (quality_ranking etc.) are table-only.
const CHARTABLE_FORMATS = new Set(["number", "currency", "percent", "decimal"]);

// `format: "currency"` mixes two different shapes: a genuine period total
// (Spend, Purchase Value — sums meaningfully across a longer window) and a
// per-unit rate (CPC/CPM/CPP, Cost Per Purchase, AOV — already "X ÷
// something," not something that should be divided again by how many days
// the window spans). Anything that needs to tell those apart — e.g. a view
// comparing windows of different lengths, where a total needs dividing by
// day-count to stay comparable but a rate must not be — should check this
// set rather than assuming every currency-format metric is additive.
export const RATE_METRIC_KEYS = new Set(["cpc", "cpm", "cpp", "cost_per_purchase", "aov"]);

// A "unit" metric (ROAS, CTR, Hook/Hold Rate, and every RATE_METRIC_KEYS
// entry) is already a per-unit rate — directly comparable across windows of
// different lengths, unlike an additive total (Spend, Purchases, …) which
// naturally grows with a longer window. Used to decide which metric rows get
// best/worst comparison coloring (see components/WindowComparisonTable.js) —
// only ever the genuinely comparable ones. A custom ratio metric (format
// "decimal") qualifies the same way a
// built-in decimal/percent metric does.
export function isUnitMetric(metric) {
  return metric.format === "percent" || metric.format === "decimal" || RATE_METRIC_KEYS.has(metric.key);
}

// Unit metrics where a numerically LOWER value is the better outcome (every
// cost-per-X metric) — every other unit metric (ROAS, CTR, Hook/Hold Rate,
// and any custom ratio metric, which has no declared direction of its own)
// defaults to higher-is-better.
export const LOWER_IS_BETTER_METRIC_KEYS = new Set(["cpc", "cpm", "cpp", "cost_per_purchase"]);

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
  const customKeys = (metricKeys || []).filter((k) => customById.has(k));
  const eventKeys = (metricKeys || []).filter((k) => eventById.has(k));
  // A selected custom ratio metric needs its numerator/denominator computed
  // below regardless of whether the user ALSO independently added them as
  // their own visible columns — without this, selecting only "AOV" (and not
  // separately selecting, say, Purchase Value and Purchases) always computed
  // `null` no matter the real numbers, since neither operand was ever
  // extracted from the raw row in the first place (the ratio pass further
  // down only reads `result[cm.numeratorKey]`, populated here).
  const customOperandKeys = customKeys.flatMap((key) => {
    const cm = customById.get(key);
    return [cm.numeratorKey, cm.denominatorKey];
  });
  const builtinKeys = [
    ...new Set([...(metricKeys || []).filter((k) => !customById.has(k) && !eventById.has(k)), ...customOperandKeys]),
  ];

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

// The Explore results table's "Total" row (only shown at a non-account
// level, where several rows exist to total up) — combines many raw rows
// into one `{ [metricKey]: value }` object the same shape deriveRowMetrics
// produces for a single row, so every existing column `render` function
// works on it unchanged. Deliberately NOT "run deriveRowMetrics on each row
// and sum/average the results" — a rate metric's own total has to be
// recomputed from its *summed* numerator and denominator (see each catalog
// entry's own `aggregate`), not summed or averaged itself, or a metric like
// LPV % would read as a meaningless, misleading number instead of this
// level's own true combined rate.
//
// `entries` is `[{ row, customEvents }]` rather than a plain row array
// because a custom conversion's action_type is only meaningful for the
// specific Facebook account that owns it — each entry carries whichever
// account's custom-event definitions its own `row` should be read against
// (see pages/api/fb/explore-insights.js, which builds this per account
// before combining every account's entries into one list here). Raw custom
// fields (the free-text "custom field" escape hatch) have no declared type
// this function could aggregate correctly, so — same as a rollup merging
// several entities' rows — they're left out of the total entirely rather
// than guessed at.
export function aggregateRowMetrics(entries, metricKeys, customMetrics = []) {
  const result = {};
  const rows = entries.map((e) => e.row);
  const customById = new Map(customMetrics.map((cm) => [cm.id, cm]));
  const eventIdsPresent = new Set(entries.flatMap((e) => (e.customEvents || []).map((ce) => ce.id)));
  const customKeys = (metricKeys || []).filter((k) => customById.has(k));
  const eventKeys = (metricKeys || []).filter((k) => eventIdsPresent.has(k));
  const customOperandKeys = customKeys.flatMap((key) => {
    const cm = customById.get(key);
    return [cm.numeratorKey, cm.denominatorKey];
  });
  const builtinKeys = [
    ...new Set([...(metricKeys || []).filter((k) => !customById.has(k) && !eventIdsPresent.has(k)), ...customOperandKeys]),
  ];

  for (const key of builtinKeys) {
    const metric = getMetric(key);
    if (metric?.aggregate) result[key] = metric.aggregate(rows);
  }
  for (const key of customKeys) {
    const cm = customById.get(key);
    const num = result[cm.numeratorKey];
    const den = result[cm.denominatorKey];
    result[key] = typeof num === "number" && typeof den === "number" && den !== 0 ? num / den : null;
  }
  for (const key of eventKeys) {
    let total = 0;
    for (const entry of entries) {
      const ce = (entry.customEvents || []).find((e) => e.id === key);
      if (ce) total += pickAnyActionValue(entry.row.actions, [ce.actionType]);
    }
    result[key] = total;
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
