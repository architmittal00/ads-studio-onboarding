import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import { graphGet, graphGetAllPages } from "@/lib/facebookGraph";
import { ATTRIBUTION_SPECS } from "@/lib/campaignLaunch";

const DETAIL_FIELDS =
  "name,campaign_id,campaign{objective},optimization_goal,bid_strategy,daily_budget,lifetime_budget,targeting,promoted_object,status,attribution_spec";

const GENDERS_TO_FIELD = { "": "all", "1": "male", "2": "female" };

function reverseAttributionSpec(spec) {
  if (!Array.isArray(spec)) return null;
  const key = Object.keys(ATTRIBUTION_SPECS).find((k) => JSON.stringify(ATTRIBUTION_SPECS[k]) === JSON.stringify(spec));
  return key || null;
}

// Converts one ad set's live Graph API shape into the Launch tab's flat
// form-field shape (components/AdSetFields.js) — used only by the duplicate
// path, so a chosen source ad set's real settings pre-fill the same form a
// brand-new ad set uses, rather than the Indian-D2C defaults.
function toFormFields(adset) {
  const targeting = adset.targeting || {};
  const genders = (targeting.genders || []).join(",");
  const audienceType = targeting.targeting_automation?.advantage_audience
    ? "advantage_plus"
    : targeting.flexible_spec?.[0]?.interests?.length
    ? "interest"
    : targeting.custom_audiences?.length
    ? "custom_audience"
    : "advantage_plus";

  return {
    name: `${adset.name} - Copy`,
    optimizationGoal: adset.optimization_goal,
    pixelId: adset.promoted_object?.pixel_id || "",
    customEventType: adset.promoted_object?.custom_event_type || "PURCHASE",
    bidStrategy: adset.bid_strategy,
    budgetType: adset.lifetime_budget ? "LIFETIME" : "DAILY",
    budgetAmount: adset.daily_budget ? String(adset.daily_budget / 100) : adset.lifetime_budget ? String(adset.lifetime_budget / 100) : "",
    audienceType,
    interests: targeting.flexible_spec?.[0]?.interests?.map((i) => ({ id: i.id, name: i.name })) || [],
    customAudiences: targeting.custom_audiences?.map((a) => ({ id: a.id, name: a.name })) || [],
    // Reconstructed into the same flat {key, name, type} shape
    // components/TargetingSearchPicker.js produces — lib/campaignLaunch.js's
    // buildGeoLocations splits back out by `type` when this is re-launched,
    // so a duplicated ad set's region/city targeting survives the round
    // trip, not just country-level.
    countries: [
      ...(targeting.geo_locations?.countries || []).map((key) => ({ key, name: key, type: "country" })),
      ...(targeting.geo_locations?.regions || []).map((r) => ({ key: r.key, name: r.name || r.key, type: "region" })),
      ...(targeting.geo_locations?.cities || []).map((c) => ({ key: c.key, name: c.name || c.key, type: "city" })),
    ],
    ageMin: targeting.age_min || 18,
    ageMax: targeting.age_max || 65,
    gender: GENDERS_TO_FIELD[genders] || "all",
    languages: (targeting.locales || []).map((l) => ({ key: l, name: `Locale ${l}` })),
    placementType: targeting.publisher_platforms?.length ? "MANUAL" : "ADVANTAGE_PLUS",
    publisherPlatforms: targeting.publisher_platforms || [],
    facebookPositions: targeting.facebook_positions || [],
    instagramPositions: targeting.instagram_positions || [],
    attributionSetting: reverseAttributionSpec(adset.attribution_spec) || "7D_CLICK_1D_VIEW",
    status: "PAUSED", // a duplicate is always offered paused first, same as every other creation path here
  };
}

// Two modes: `?accountId=` lists an account's ad sets (light fields, for the
// "duplicate an existing ad set" picker — searched client-side, same reason
// as campaigns-list.js); `?adsetId=` fetches one ad set's full targeting and
// returns it pre-converted to the Launch form's field shape.
export default async function handler(req, res) {
  const session = await getServerSession(req, res, authOptions);
  if (!session?.accessToken) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  const { accountId, adsetId } = req.query;
  const token = session.accessToken;

  try {
    if (adsetId) {
      const adset = await graphGet(`/${adsetId}`, token, { fields: DETAIL_FIELDS });
      res.status(200).json({ campaignObjective: adset.campaign?.objective || null, fields: toFormFields(adset) });
      return;
    }
    if (accountId) {
      const json = await graphGetAllPages(`/${accountId}/adsets`, token, {
        fields: "id,name,status,campaign{id,name}",
        limit: 200,
      });
      res.status(200).json({ adsets: json.data || [] });
      return;
    }
    res.status(400).json({ error: "accountId or adsetId is required" });
  } catch (err) {
    res.status(err.graphResponse ? 400 : 500).json({ error: err.message });
  }
}
