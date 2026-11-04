import { graphGet, graphPost } from "./facebookGraph";
import { toMinorUnits, ATTRIBUTION_SPECS, buildGeoLocations } from "./campaignLaunch";

// Everything the ad set "View details" drawer shows and lets you change. Reads one ad set with all of its
// own settings (and its campaign's, for context) and applies edits back. Targeting is edited by merging
// into the ad set's current targeting object, never rebuilt: Meta replaces the whole `targeting` on update,
// so anything this form doesn't cover (excluded interests, zip codes, custom pins, device and OS filters,
// connections…) has to be carried over untouched or it would be wiped by a save.

export const ADSET_FIELDS =
  "name,status,effective_status,account_id,campaign{id,name,objective,daily_budget,lifetime_budget,bid_strategy},daily_budget,lifetime_budget,budget_remaining," +
  "bid_strategy,bid_amount,bid_constraints,billing_event,optimization_goal,destination_type,promoted_object,attribution_spec,start_time,end_time," +
  "pacing_type,daily_min_spend_target,daily_spend_cap,lifetime_min_spend_target,lifetime_spend_cap,learning_stage_info,is_dynamic_creative,targeting,created_time,updated_time,issues_info";

export const BID_STRATEGIES = [
  { value: "LOWEST_COST_WITHOUT_CAP", label: "Highest volume (no cap)" },
  { value: "LOWEST_COST_WITH_BID_CAP", label: "Bid cap" },
  { value: "COST_CAP", label: "Cost per result goal (cost cap)" },
  { value: "LOWEST_COST_WITH_MIN_ROAS", label: "ROAS goal" },
];
const VALID_BID_STRATEGIES = BID_STRATEGIES.map((b) => b.value);

const major = (minor) => (minor == null || minor === "" ? null : Number(minor) / 100);

let countryNamer = null;
function countryName(code) {
  try {
    countryNamer = countryNamer || new Intl.DisplayNames(["en"], { type: "region" });
    return countryNamer.of(code) || code;
  } catch {
    return code;
  }
}

function reverseAttribution(spec) {
  if (!Array.isArray(spec)) return null;
  return Object.keys(ATTRIBUTION_SPECS).find((k) => JSON.stringify(ATTRIBUTION_SPECS[k]) === JSON.stringify(spec)) || null;
}

// Form-shaped location lists ({key, name, type}) for the countries / regions / cities of a geo object.
function geoList(geo) {
  if (!geo) return [];
  return [
    ...(geo.countries || []).map((c) => ({ key: c, name: countryName(c), type: "country" })),
    ...(geo.regions || []).map((r) => ({ key: r.key, name: r.name || String(r.key), type: "region" })),
    ...(geo.cities || []).map((c) => ({ key: c.key, name: c.name || String(c.key), type: "city" })),
  ];
}

// Geo parts the picker can't represent (pins, zip codes, location types…): shown read-only and kept on save.
function otherGeo(geo) {
  if (!geo) return [];
  const out = [];
  if (geo.custom_locations?.length) out.push(`${geo.custom_locations.length} custom location pin${geo.custom_locations.length === 1 ? "" : "s"}`);
  if (geo.zips?.length) out.push(`${geo.zips.length} zip code${geo.zips.length === 1 ? "" : "s"}`);
  if (geo.geo_markets?.length) out.push(`${geo.geo_markets.length} market${geo.geo_markets.length === 1 ? "" : "s"}`);
  if (geo.country_groups?.length) out.push(`Country groups: ${geo.country_groups.join(", ")}`);
  if (geo.location_types?.length) out.push(`People who: ${geo.location_types.join(", ")}`);
  return out;
}

export function adsetFormFrom(adset, localeNames) {
  const t = adset.targeting || {};
  const genders = t.genders || [];
  const interests = (t.flexible_spec || []).flatMap((s) => s.interests || []).map((i) => ({ id: i.id, name: i.name }));
  const manual = !!t.publisher_platforms?.length;
  const floor = adset.bid_constraints?.roas_average_floor;
  return {
    name: adset.name || "",
    status: adset.status === "ACTIVE" ? "ACTIVE" : "PAUSED",
    budget: major(adset.daily_budget ?? adset.lifetime_budget),
    bidStrategy: adset.bid_strategy || "LOWEST_COST_WITHOUT_CAP",
    bidAmount: major(adset.bid_amount),
    roasFloor: floor ? Number(floor) / 10000 : null,
    startTime: adset.start_time || null,
    endTime: adset.end_time || null,
    attributionSetting: reverseAttribution(adset.attribution_spec) || "",
    locations: geoList(t.geo_locations),
    excludedLocations: geoList(t.excluded_geo_locations),
    ageMin: t.age_min ?? 18,
    ageMax: t.age_max ?? 65,
    gender: genders.length === 1 ? (genders[0] === 1 ? "male" : "female") : "all",
    languages: (t.locales || []).map((l) => ({ key: l, name: localeNames[String(l)] || `Locale ${l}` })),
    interests,
    customAudiences: (t.custom_audiences || []).map((a) => ({ id: a.id, name: a.name || a.id })),
    excludedCustomAudiences: (t.excluded_custom_audiences || []).map((a) => ({ id: a.id, name: a.name || a.id })),
    advantageAudience: !!t.targeting_automation?.advantage_audience,
    placementType: manual ? "MANUAL" : "ADVANTAGE_PLUS",
    publisherPlatforms: t.publisher_platforms || [],
    facebookPositions: t.facebook_positions || [],
    instagramPositions: t.instagram_positions || [],
  };
}

// Read-only properties (not editable on an existing ad set, or not by this form), shown as label/value rows.
export function adsetInfoFrom(adset) {
  const t = adset.targeting || {};
  const po = adset.promoted_object || {};
  const rows = [];
  const add = (label, value) => {
    if (value !== null && value !== undefined && value !== "" && !(Array.isArray(value) && value.length === 0)) rows.push({ label, value: Array.isArray(value) ? value.join(", ") : String(value) });
  };
  add("Performance goal", adset.optimization_goal);
  add("Charged for (billing event)", adset.billing_event);
  add("Conversion location", adset.destination_type);
  add("Pixel / dataset", po.pixel_id);
  add("Conversion event", po.custom_event_type);
  add("Custom conversion", po.custom_conversion_id);
  add("Facebook Page", po.page_id);
  add("Delivery pacing", adset.pacing_type);
  add("Daily minimum spend", adset.daily_min_spend_target ? major(adset.daily_min_spend_target) : null);
  add("Daily spend cap", adset.daily_spend_cap ? major(adset.daily_spend_cap) : null);
  add("Lifetime minimum spend", adset.lifetime_min_spend_target ? major(adset.lifetime_min_spend_target) : null);
  add("Lifetime spend cap", adset.lifetime_spend_cap ? major(adset.lifetime_spend_cap) : null);
  add("Budget remaining", adset.budget_remaining ? major(adset.budget_remaining) : null);
  add("Learning phase", adset.learning_stage_info?.status);
  add("Dynamic creative", adset.is_dynamic_creative ? "On" : null);
  add("Excluded interests", (t.exclusions?.interests || []).map((i) => i.name));
  add("Behaviors", (t.flexible_spec || []).flatMap((s) => s.behaviors || []).map((b) => b.name));
  add("Other location rules", [...otherGeo(t.geo_locations), ...otherGeo(t.excluded_geo_locations).map((x) => `Excluded: ${x}`)]);
  add("Devices", t.device_platforms);
  add("Mobile operating systems", t.user_os);
  add("Messenger placements", t.messenger_positions);
  add("Audience Network placements", t.audience_network_positions);
  add("Created", adset.created_time);
  add("Last updated", adset.updated_time);
  if (adset.issues_info?.length) add("Issues", adset.issues_info.map((i) => i.error_summary || i.error_message));
  return rows;
}

// `resolveLocaleNames(token, ids)` turns Meta's numeric language ids into names (see lib/entityDetails.js).
export async function fetchAdSetFull(id, token, resolveLocaleNames = async () => ({})) {
  const adset = await graphGet(`/${id}`, token, { fields: ADSET_FIELDS });
  const localeNames = await resolveLocaleNames(token, adset.targeting?.locales);
  return {
    adset,
    form: adsetFormFrom(adset, localeNames),
    info: adsetInfoFrom(adset),
    budgetType: adset.daily_budget ? "daily" : adset.lifetime_budget ? "lifetime" : null,
    campaign: adset.campaign ? { id: adset.campaign.id, name: adset.campaign.name, objective: adset.campaign.objective, cbo: !!(adset.campaign.daily_budget || adset.campaign.lifetime_budget) } : null,
    accountId: adset.account_id ? `act_${adset.account_id}` : null,
  };
}

const GENDER_CODES = { male: [1], female: [2] };

function mergeGeo(currentGeo, list) {
  const next = { ...(currentGeo || {}) };
  delete next.countries;
  delete next.regions;
  delete next.cities;
  const built = list?.length ? buildGeoLocations(list) : {};
  return { ...next, ...built };
}

// Applies only the targeting groups present in `edits` onto the ad set's current targeting.
export function mergeTargeting(current, edits) {
  const t = { ...(current || {}) };
  if ("locations" in edits) {
    if (!edits.locations?.length && !(t.geo_locations && Object.keys(t.geo_locations).some((k) => !["countries", "regions", "cities"].includes(k)))) {
      throw new Error("Add at least one location to target.");
    }
    t.geo_locations = mergeGeo(t.geo_locations, edits.locations);
  }
  if ("excludedLocations" in edits) {
    const geo = mergeGeo(t.excluded_geo_locations, edits.excludedLocations);
    if (Object.keys(geo).length) t.excluded_geo_locations = geo;
    else delete t.excluded_geo_locations;
  }
  if ("ageMin" in edits) t.age_min = Number(edits.ageMin);
  if ("ageMax" in edits) t.age_max = Number(edits.ageMax);
  if ("gender" in edits) {
    if (GENDER_CODES[edits.gender]) t.genders = GENDER_CODES[edits.gender];
    else delete t.genders;
  }
  if ("languages" in edits) {
    if (edits.languages?.length) t.locales = edits.languages.map((l) => Number(l.key));
    else delete t.locales;
  }
  if ("interests" in edits) {
    const ints = (edits.interests || []).map((i) => ({ id: i.id, name: i.name }));
    const spec = [...(t.flexible_spec || [])];
    if (spec.length) {
      const first = { ...spec[0] };
      if (ints.length) first.interests = ints;
      else delete first.interests;
      if (Object.keys(first).length) spec[0] = first;
      else spec.shift();
    } else if (ints.length) spec.push({ interests: ints });
    if (spec.length) t.flexible_spec = spec;
    else delete t.flexible_spec;
  }
  if ("customAudiences" in edits) {
    if (edits.customAudiences?.length) t.custom_audiences = edits.customAudiences.map((a) => ({ id: a.id }));
    else delete t.custom_audiences;
  }
  if ("excludedCustomAudiences" in edits) {
    if (edits.excludedCustomAudiences?.length) t.excluded_custom_audiences = edits.excludedCustomAudiences.map((a) => ({ id: a.id }));
    else delete t.excluded_custom_audiences;
  }
  if ("advantageAudience" in edits) {
    t.targeting_automation = { ...(t.targeting_automation || {}), advantage_audience: edits.advantageAudience ? 1 : 0 };
  }
  if ("placementType" in edits || "publisherPlatforms" in edits || "facebookPositions" in edits || "instagramPositions" in edits) {
    if (edits.placementType === "ADVANTAGE_PLUS") {
      for (const k of ["publisher_platforms", "facebook_positions", "instagram_positions", "messenger_positions", "audience_network_positions"]) delete t[k];
    } else {
      const platforms = edits.publisherPlatforms ?? t.publisher_platforms ?? [];
      if (!platforms.length) throw new Error("Pick at least one platform for manual placements.");
      t.publisher_platforms = platforms;
      const fb = edits.facebookPositions ?? t.facebook_positions ?? [];
      const ig = edits.instagramPositions ?? t.instagram_positions ?? [];
      if (platforms.includes("facebook") && fb.length) t.facebook_positions = fb;
      else delete t.facebook_positions;
      if (platforms.includes("instagram") && ig.length) {
        t.instagram_positions = [...ig];
        // Meta: "To place ads in Instagram Explore home, please also select Instagram Explore".
        if (t.instagram_positions.includes("explore_home") && !t.instagram_positions.includes("explore")) t.instagram_positions.push("explore");
      } else delete t.instagram_positions;
      if (!platforms.includes("messenger")) delete t.messenger_positions;
      if (!platforms.includes("audience_network")) delete t.audience_network_positions;
    }
  }
  return t;
}

const TARGETING_KEYS = [
  "locations", "excludedLocations", "ageMin", "ageMax", "gender", "languages", "interests", "customAudiences",
  "excludedCustomAudiences", "advantageAudience", "placementType", "publisherPlatforms", "facebookPositions", "instagramPositions",
];

// `edits` holds only the fields the user changed. Returns the list of what was saved.
export async function updateAdSet(token, id, edits) {
  const current = await graphGet(`/${id}`, token, { fields: "daily_budget,lifetime_budget,targeting" });
  const payload = {};
  const changed = [];
  const mark = (label) => changed.push(label);

  if ("name" in edits) {
    const name = String(edits.name || "").trim();
    if (!name) throw new Error("The ad set needs a name.");
    payload.name = name;
    mark("name");
  }
  if ("status" in edits) {
    if (!["ACTIVE", "PAUSED"].includes(edits.status)) throw new Error("Status must be Active or Paused.");
    payload.status = edits.status;
    mark("status");
  }
  if ("budget" in edits) {
    const amount = Number(edits.budget);
    if (!(amount > 0)) throw new Error("Budget must be more than 0.");
    if (current.daily_budget) payload.daily_budget = toMinorUnits(amount);
    else if (current.lifetime_budget) payload.lifetime_budget = toMinorUnits(amount);
    else throw new Error("This ad set has no budget of its own: its budget is set on the campaign.");
    mark("budget");
  }
  if ("bidStrategy" in edits) {
    if (!VALID_BID_STRATEGIES.includes(edits.bidStrategy)) throw new Error("Unknown bid strategy.");
    payload.bid_strategy = edits.bidStrategy;
    mark("bid strategy");
  }
  if ("bidAmount" in edits) {
    const amount = Number(edits.bidAmount);
    if (!(amount > 0)) throw new Error("Bid amount must be more than 0.");
    payload.bid_amount = toMinorUnits(amount);
    mark("bid amount");
  }
  if ("roasFloor" in edits) {
    const floor = Number(edits.roasFloor);
    if (!(floor > 0)) throw new Error("ROAS goal must be more than 0.");
    payload.bid_constraints = { roas_average_floor: Math.round(floor * 10000) };
    mark("ROAS goal");
  }
  if ("startTime" in edits && edits.startTime) {
    payload.start_time = edits.startTime;
    mark("start time");
  }
  if ("endTime" in edits) {
    payload.end_time = edits.endTime || 0;
    mark("end time");
  }
  if ("attributionSetting" in edits) {
    if (!ATTRIBUTION_SPECS[edits.attributionSetting]) throw new Error("Unknown attribution setting.");
    payload.attribution_spec = ATTRIBUTION_SPECS[edits.attributionSetting];
    mark("attribution");
  }
  const targetingEdits = Object.fromEntries(Object.entries(edits).filter(([k]) => TARGETING_KEYS.includes(k)));
  if (Object.keys(targetingEdits).length) {
    payload.targeting = mergeTargeting(current.targeting, targetingEdits);
    mark("targeting");
  }
  if (!Object.keys(payload).length) return { changed: [] };
  await graphPost(`/${id}`, token, payload);
  return { changed };
}
