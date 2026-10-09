import { searchAdInterests, pickBestMatch } from "./metaInterestSearch";

// ── Naming convention ──
// Campaign: TEST-{Funnel}-{Objective}-S{StrategyId}-{YYYYMMDD}
// Ad set:   TEST-{Funnel}-{AudienceTag}
// Centralized here so it's consistent and so pages/api/fb/report/core.js's
// RTG_PATTERN regex (matches "rtg"/"retarget", case-insensitive) keeps
// recognizing retargeting ad sets created this way.
//
// TEST_PREFIX: this launch flow is still being verified against real
// accounts (see README) — every created object is clearly marked as a test
// in Ads Manager until it's trusted, rather than blending in with real
// production campaigns. Drop this (set to "") once the flow is confirmed
// solid and this stops being needed.
const TEST_PREFIX = "TEST-";

function pad2(n) {
  return String(n).padStart(2, "0");
}

function dateTag(date) {
  return `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}`;
}

const FUNNEL_OBJECTIVE_TAG = { TOF: "Traffic", MOF: "ATC", BOF: "Purchase" };

export function buildCampaignName(funnel, strategyId, date = new Date()) {
  return `${TEST_PREFIX}${funnel}-${FUNNEL_OBJECTIVE_TAG[funnel]}-S${strategyId}-${dateTag(date)}`;
}

const ADSET_TYPE_TAG = { retargeting: "RTG-VisitorsEngagers", lookalike: "LAL-Buyers", advantage: "Advantage" };

// Facebook ad set names tolerate most characters, but keep this predictable
// and readable in Ads Manager: strip anything that isn't alphanumeric/space/
// hyphen/plus, collapse whitespace, and cap length so a long interest name
// (or several, joined with "+" when an ad set targets more than one) doesn't
// blow out the whole "TEST-BOF-<name>-2" naming convention.
function sanitizeForName(str, maxLen = 30) {
  return str
    .replace(/[^a-zA-Z0-9 +-]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLen);
}

// `interestName` is the real, resolved Meta interest name (from a client-
// chosen interest or a live search match) — previously this branch always
// said "Beauty" regardless of `adset.interestQuery`, a leftover from when
// every interest ad set in Strategy 8 was the same hardcoded placeholder.
export function buildAdsetName(funnel, adset, index, { interestName } = {}) {
  if (adset.nameTag) return `${TEST_PREFIX}${funnel}-${adset.nameTag}`;
  if (adset.type === "interest") {
    const label = interestName ? sanitizeForName(interestName) : `Interest-${index + 1}`;
    return `${TEST_PREFIX}${funnel}-${label}`;
  }
  return `${TEST_PREFIX}${funnel}-${ADSET_TYPE_TAG[adset.type] || "Adset"}`;
}

// ── Objective / optimization goal per funnel stage ──
// TOF is genuinely a Traffic objective (optimized for site visits) — it
// can't carry Advantage+ Sales semantics no matter how the strategy copy
// labels it "ASC". MOF/BOF are Sales-objective, optimizing for a different
// pixel event (Add to Cart vs Purchase) — see the plan notes for why.
export const FUNNEL_CAMPAIGN_OBJECTIVE = { TOF: "OUTCOME_TRAFFIC", MOF: "OUTCOME_SALES", BOF: "OUTCOME_SALES" };
// TOF optimizes for Landing Page Views, not Link Clicks — LPV only counts a
// click that actually results in the page loading (pixel-confirmed), so it
// buys real site visits rather than just clicks that bounce before loading.
const FUNNEL_OPTIMIZATION_GOAL = { TOF: "LANDING_PAGE_VIEWS", MOF: "OFFSITE_CONVERSIONS", BOF: "OFFSITE_CONVERSIONS" };
const FUNNEL_CUSTOM_EVENT = { MOF: "ADD_TO_CART", BOF: "PURCHASE" };

const HARDCODED_COUNTRY = "IN"; // per the user — always India for now
const BID_STRATEGY = "LOWEST_COST_WITHOUT_CAP"; // qualifies for budget automation

// Builds the campaign-level payload. CBO (budget lives here) for every
// strategy except Strategy 7, which is ABO (budget lives on its ad sets
// instead) — `dailyBudgetMinorUnits` is omitted for ABO campaigns.
export function buildCampaignPayload({ funnel, strategyId, dailyBudgetMinorUnits, isAbo }) {
  const payload = {
    name: buildCampaignName(funnel, strategyId),
    objective: FUNNEL_CAMPAIGN_OBJECTIVE[funnel],
    status: "PAUSED", // always created paused — see lib/campaignLaunch.js callers for the activate-after step
    special_ad_categories: [],
    bid_strategy: BID_STRATEGY,
  };
  if (!isAbo) payload.daily_budget = dailyBudgetMinorUnits;
  return payload;
}

// Builds one ad set's payload. `audienceIds` carries resolved Custom
// Audience IDs for retargeting/lookalike types (looked up by
// lib/audienceManager.js before this is called); `interestIds`/`interestName`
// carry the resolved Meta interest(s) for the "interest" type — for
// Strategy 8 these come from the user's own choice
// (components/InterestPicker.js, which allows choosing more than one
// interest per ad set), not a live query resolved from a static string.
export function buildAdsetPayload({
  funnel,
  campaignId,
  pageId,
  pixelId,
  adset,
  index,
  audienceIds,
  interestIds,
  interestName,
  dailyBudgetMinorUnits, // only set for ABO ad sets (Strategy 7)
}) {
  const targeting = { geo_locations: { countries: [HARDCODED_COUNTRY] } };

  if (adset.type === "advantage") {
    targeting.targeting_automation = { advantage_audience: 1 };
  } else if (adset.type === "retargeting") {
    // "Your website visitors & ad engagers" — two separate Meta audience
    // objects (WEBSITE pixel vs Page engagement) unioned via two entries
    // here, not one combined audience; both resolved by
    // lib/audienceManager.js before this is called.
    targeting.custom_audiences = [{ id: audienceIds.visitors }, { id: audienceIds.engagers }];
  } else if (adset.type === "lookalike") {
    targeting.custom_audiences = [{ id: audienceIds.lookalike }];
  } else if (adset.type === "interest") {
    // Multiple interests inside ONE flexible_spec entry's `interests` array
    // are ORed together by Meta (reach anyone matching ANY of them) — this
    // is the correct shape for "target several interests in one ad set",
    // as opposed to multiple flexible_spec entries, which would be ANDed.
    targeting.flexible_spec = [{ interests: interestIds.map((id) => ({ id })) }];
  }

  const payload = {
    name: buildAdsetName(funnel, adset, index, { interestName }),
    campaign_id: campaignId,
    status: "PAUSED",
    billing_event: "IMPRESSIONS",
    optimization_goal: FUNNEL_OPTIMIZATION_GOAL[funnel],
    destination_type: "WEBSITE",
    targeting,
    bid_strategy: BID_STRATEGY,
    // LANDING_PAGE_VIEWS needs promoted_object.pixel_id (it's measuring a
    // pixel-confirmed page load, not a Page-level signal) — same as MOF/BOF,
    // just without a custom_event_type since LPV is its own optimization
    // goal rather than a specific pixel event to match.
    promoted_object:
      funnel === "TOF" ? { pixel_id: pixelId } : { pixel_id: pixelId, custom_event_type: FUNNEL_CUSTOM_EVENT[funnel] },
  };
  if (dailyBudgetMinorUnits) payload.daily_budget = dailyBudgetMinorUnits;
  return payload;
}

// Legacy single-query interest resolution — superseded by the user-driven
// picker (components/InterestPicker.js, backed by lib/metaInterestSearch.js)
// for Strategy 8, which now requires a client-chosen {id, name} pair instead
// of resolving one live from a static query string. Kept as a thin wrapper
// over the shared search helper for any future one-off lookup need.
export async function resolveInterestId(token, query) {
  const results = await searchAdInterests(token, query);
  const match = pickBestMatch(results, query);
  if (!match) throw new Error(`No targeting interest found for "${query}"`);
  return match.id;
}

// Facebook budgets are in the account currency's minor unit (cents/paise) —
// same convention as toMajorUnits()'s inverse in lib/reportShared.js.
export function toMinorUnits(amount) {
  return Math.round(amount * 100);
}
