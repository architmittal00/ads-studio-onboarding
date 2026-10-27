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
  if (isAbo) {
    // Meta now rejects a no-campaign-budget campaign unless this is set
    // explicitly (code 100, subcode 4834011) — `false` keeps today's actual
    // behavior (each ad set spends only its own budget) rather than opting
    // into Meta's 20%-cross-ad-set-sharing feature, which nothing here asks
    // for or accounts for.
    payload.is_adset_budget_sharing_enabled = false;
  } else {
    payload.daily_budget = dailyBudgetMinorUnits;
  }
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

// ── Generic Launch tab payload builders ──
// The strategy-flow builders above take a funnel/strategy-shaped input — the
// Launch tab lets the user set every field directly instead, so these take
// an already-assembled field object (this app's own form state) and are
// intentionally independent of the STRATEGIES model. Nothing above is
// changed or reused beyond toMinorUnits/HARDCODED_COUNTRY/BID_STRATEGY.

// Advantage+ Shopping Campaigns are flagged via `smart_promotion_type` as of
// the pinned v23.0 Graph API (see lib/facebookGraph.js's GRAPH_API_VERSION
// comment — this field is being phased out from v24, so this is a
// best-effort flag for the version this app currently targets). A rejection
// here surfaces Facebook's own error through the normal per-step error
// handling in pages/api/fb/launch-campaign.js rather than failing silently.
export function buildGenericCampaignPayload(fields) {
  const payload = {
    name: fields.name,
    objective: fields.objective,
    status: "PAUSED", // always created paused — flipped after, see launch-campaign.js
    special_ad_categories: [],
  };
  if (fields.advantagePlus) payload.smart_promotion_type = "AUTOMATED_SHOPPING_ADS";
  if (fields.budgetStrategy === "CBO" && fields.budgetAmountMinorUnits) {
    // A campaign-level bid strategy only exists with a campaign budget; on an
    // ABO campaign Meta rejects it ("No budget for campaign", subcode 1885737) —
    // there the strategy lives on each ad set instead.
    payload.bid_strategy = fields.bidStrategy || BID_STRATEGY;
    if (fields.budgetType === "LIFETIME") payload.lifetime_budget = fields.budgetAmountMinorUnits;
    else payload.daily_budget = fields.budgetAmountMinorUnits;
  } else {
    // Same Meta requirement as buildCampaignPayload above (code 100, subcode
    // 4834011): a campaign with no campaign-level budget must explicitly say
    // whether its ad sets share one shared budget pool. `false` preserves
    // this form's existing ABO behavior — each ad set spends only its own
    // budget, set separately in buildGenericAdsetPayload below.
    payload.is_adset_budget_sharing_enabled = false;
  }
  return payload;
}

// Converts a live Graph campaign object into this same flat form-fields
// shape, for Copy Ads' ad-set/campaign-level cross-account copy — sibling to
// pages/api/fb/adsets-list.js's own toFormFields(adset), same reasoning:
// pre-fill a real source object's settings into the form a brand-new object
// uses, rather than hardcoded defaults. Nothing in this app clones an actual
// source CAMPAIGN's own settings today — /launch's own "new campaign" path
// always starts from defaults the user fills in by hand.
//
// `budgetAmount` is a major-unit string (e.g. "500" for ₹500), same
// convention toFormFields already uses for an ad set's own budget — callers
// convert to minor units via toMinorUnits() right before actually building a
// payload, same as pages/api/fb/launch-campaign.js already does from its own
// form state. `budgetStrategy` is derived from whether the campaign itself
// carries a budget (CBO) or not (ABO) — this must travel with the campaign,
// not be re-guessed per ad set: every ad set created under one copied
// campaign has to share the same strategy, driven by the campaign's own
// shape, not each ad set's own independent budget fields.
export function campaignFormFieldsFromSource(campaign) {
  const hasOwnBudget = !!(campaign.daily_budget || campaign.lifetime_budget);
  return {
    fields: {
      name: `${campaign.name} - Copy`,
      objective: campaign.objective,
      bidStrategy: campaign.bid_strategy,
      advantagePlus: campaign.smart_promotion_type === "AUTOMATED_SHOPPING_ADS",
    },
    budgetStrategy: hasOwnBudget ? "CBO" : "ABO",
    budgetType: campaign.lifetime_budget ? "LIFETIME" : "DAILY",
    budgetAmount: campaign.daily_budget
      ? String(campaign.daily_budget / 100)
      : campaign.lifetime_budget
      ? String(campaign.lifetime_budget / 100)
      : "",
    // Not yet applied anywhere — buildGenericCampaignPayload always hardcodes
    // special_ad_categories to []. Exposed here so a caller can at least
    // detect a flagged source campaign (Housing/Employment/Credit/Social
    // Issues) and warn before cloning it as an unrestricted campaign, rather
    // than this being silently invisible.
    specialAdCategories: campaign.special_ad_categories || [],
  };
}

const GENDER_MAP = { all: [], male: [1], female: [2] };

// Assembles the `targeting` object from the Launch form's flat field set.
// Only one audience mechanism is set at a time (Advantage+ audience,
// interests, or a saved/custom/lookalike audience chosen via
// components/CustomAudiencePicker.js — Meta returns lookalikes as just
// another customaudiences subtype, so one picker covers both without a
// separate lookalike code path) — same one-targeting-mechanism-per-adset
// shape as buildAdsetPayload above, just driven by `fields.audienceType`
// instead of a fixed strategy adset type.
// `fields.locations` is whatever components/TargetingSearchPicker.js's
// `type=adgeolocation` search returned and the user picked from — a mix of
// country/region/city results, each shaped like `{key, name, type}`. Meta's
// `geo_locations` wants these split into separate sub-keys by granularity
// (`countries` as plain ISO codes, `regions`/`cities` as `{key}` objects) —
// NOT one array of picker objects, which Facebook rejects outright.
// Exported for lib/catalogAds/launch.js's "Broad audience" case (Catalog
// Ads' ad set can use either a catalog-retargeting spec this file knows
// nothing about, or a normal broad audience — identical to what this
// function already builds for the existing Launch tab). Purely additive:
// no existing caller's behavior changes.
export function buildGeoLocations(locations) {
  if (!locations?.length) return { countries: [HARDCODED_COUNTRY] };
  const geo = {};
  for (const loc of locations) {
    if (loc.type === "region") (geo.regions ??= []).push({ key: loc.key });
    else if (loc.type === "city") (geo.cities ??= []).push({ key: loc.key });
    else (geo.countries ??= []).push(loc.key);
  }
  return geo;
}

// Exported for lib/catalogAds/launch.js's "Broad audience" case — see
// buildGeoLocations' comment above, same reasoning.
export function buildTargeting(fields) {
  const targeting = {
    geo_locations: buildGeoLocations(fields.countries),
    age_min: fields.ageMin ?? 18,
    age_max: fields.ageMax ?? 65,
  };
  const genders = GENDER_MAP[fields.gender] ?? [];
  if (genders.length) targeting.genders = genders;
  if (fields.languages?.length) targeting.locales = fields.languages.map((l) => l.key);

  if (fields.audienceType === "advantage_plus") {
    targeting.targeting_automation = { advantage_audience: 1 };
  } else if (fields.audienceType === "interest" && fields.interests?.length) {
    targeting.flexible_spec = [{ interests: fields.interests.map((i) => ({ id: i.id })) }];
  } else if (fields.audienceType === "custom_audience" && fields.customAudiences?.length) {
    targeting.custom_audiences = fields.customAudiences.map((a) => ({ id: a.id }));
  }

  if (fields.placementType === "MANUAL") {
    targeting.publisher_platforms = fields.publisherPlatforms?.length ? fields.publisherPlatforms : ["facebook", "instagram"];
    if (fields.facebookPositions?.length) targeting.facebook_positions = fields.facebookPositions;
    if (fields.instagramPositions?.length) {
      targeting.instagram_positions = [...fields.instagramPositions];
      // Meta: "To place ads in Instagram Explore home, please also select Instagram
      // Explore" (code 100, subcode 2490392). A source ad set can carry only the
      // former, so add the latter when copying it.
      if (targeting.instagram_positions.includes("explore_home") && !targeting.instagram_positions.includes("explore")) {
        targeting.instagram_positions.push("explore");
      }
    }
  }
  // Omitting publisher_platforms/positions entirely (the Advantage+/
  // automatic-placements default) is itself how Meta enables Advantage+
  // Placements — there's no explicit "on" flag to set.

  return targeting;
}

// Common attribution-window choices exposed in the Ad Set form — mapped to
// Meta's `attribution_spec` shape. Best-effort: some ad accounts have this
// locked at the account-level Unified Attribution Setting instead, in which
// case Facebook rejects or ignores this field — same graceful-degradation
// handling as the Advantage+ flag above, not something worth blocking the
// rest of the launch over.
export const ATTRIBUTION_SPECS = {
  "7D_CLICK_1D_VIEW": [
    { event_type: "CLICK_THROUGH", window_days: 7 },
    { event_type: "VIEW_THROUGH", window_days: 1 },
  ],
  "1D_CLICK": [{ event_type: "CLICK_THROUGH", window_days: 1 }],
  "1D_CLICK_1D_VIEW": [
    { event_type: "CLICK_THROUGH", window_days: 1 },
    { event_type: "VIEW_THROUGH", window_days: 1 },
  ],
  "7D_CLICK": [{ event_type: "CLICK_THROUGH", window_days: 7 }],
};

export function buildGenericAdsetPayload(fields) {
  const payload = {
    name: fields.name,
    campaign_id: fields.campaignId,
    status: "PAUSED", // always created paused — flipped after, see launch-campaign.js
    billing_event: "IMPRESSIONS",
    optimization_goal: fields.optimizationGoal,
    destination_type: "WEBSITE",
    targeting: buildTargeting(fields),
    bid_strategy: fields.bidStrategy || BID_STRATEGY,
  };
  if (fields.pixelId && (fields.optimizationGoal === "OFFSITE_CONVERSIONS" || fields.optimizationGoal === "LANDING_PAGE_VIEWS")) {
    payload.promoted_object =
      fields.optimizationGoal === "LANDING_PAGE_VIEWS"
        ? { pixel_id: fields.pixelId }
        : { pixel_id: fields.pixelId, custom_event_type: fields.customEventType || "PURCHASE" };
  }
  if (fields.attributionSetting && ATTRIBUTION_SPECS[fields.attributionSetting]) {
    payload.attribution_spec = ATTRIBUTION_SPECS[fields.attributionSetting];
  }
  // Bid cap / cost cap need bid_amount; a ROAS goal needs
  // bid_constraints.roas_average_floor. Copied from the source ad set.
  if (fields.bidAmount) payload.bid_amount = fields.bidAmount;
  if (fields.bidConstraints && Object.keys(fields.bidConstraints).length) payload.bid_constraints = fields.bidConstraints;
  // Only set on ABO (ad-set-level budget) — a CBO campaign carries the
  // budget itself and rejects daily_budget/lifetime_budget on its ad sets.
  if (fields.budgetStrategy === "ABO" && fields.budgetAmountMinorUnits) {
    if (fields.budgetType === "LIFETIME") payload.lifetime_budget = fields.budgetAmountMinorUnits;
    else payload.daily_budget = fields.budgetAmountMinorUnits;
  }
  return payload;
}
