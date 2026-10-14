import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import { graphGet, graphGetAllPages, graphGetInsights } from "@/lib/facebookGraph";
import { ATTRIBUTION_SPECS } from "@/lib/campaignLaunch";
import { lastNDaysRange } from "@/lib/adCreativeDetails";
import { roasFromRow, pickPurchaseCount } from "@/lib/metrics";

const DETAIL_FIELDS =
  "name,campaign_id,campaign{objective,name},optimization_goal,bid_strategy,daily_budget,lifetime_budget,targeting,promoted_object,status,attribution_spec";

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
      // "Duplicate an ad set" means the ads in it too, not just its
      // targeting settings — fetched alongside the ad set's own detail so
      // the duplicate path has both in one round trip. Each ad's existing
      // `creative.id` is reused as-is on the new ad (`{creative_id}` is all
      // a new Ad object needs to point at it) rather than re-creating the
      // creative itself — Meta creatives are standalone, reusable objects
      // referenced by id, not owned 1:1 by one ad, and re-deriving a
      // creative's full spec (image hashes, carousels, dynamic creative,
      // asset_feed_spec…) to clone it is a much larger, riskier surface than
      // this needs for "the new ad set shows the same ads".
      const [adset, adsResult] = await Promise.all([
        graphGet(`/${adsetId}`, token, { fields: DETAIL_FIELDS }),
        graphGetAllPages(`/${adsetId}/ads`, token, { fields: "id,name,status,creative{id}", limit: 200 }),
      ]);
      const ads = (adsResult.data || [])
        .filter((a) => a.creative?.id)
        .map((a) => ({ name: `${a.name} - Copy`, creativeId: a.creative.id }));
      res.status(200).json({
        // The ad set's own raw name, campaign id, and campaign name — kept
        // separate from `fields.name` (which already has " - Copy" appended
        // by toFormFields) so a caller that jumped straight here from
        // Explore's "Duplicate" row action (skipping the picker list, which
        // is where this info would otherwise come from) can still show
        // "Duplicating 'X' (in campaign Y)" for context, and default a
        // destination picker to the ad set's own current campaign.
        name: adset.name,
        campaignId: adset.campaign_id || null,
        campaignName: adset.campaign?.name || null,
        campaignObjective: adset.campaign?.objective || null,
        fields: toFormFields(adset),
        ads,
      });
      return;
    }
    if (accountId) {
      // Name + parent campaign alone isn't enough to decide which ad set to
      // duplicate (the screenshot that prompted this: a long list of
      // similarly-named ad sets with nothing to tell them apart) — status,
      // budget, and optimization goal come from the same list call; last-
      // 30-day spend/purchases/ROAS needs one extra account-wide insights
      // call (one call for every ad set's numbers, not one per ad set). A
      // failed insights call still returns the list, just without
      // performance data (Promise.allSettled).
      const [listResult, insightsResult] = await Promise.allSettled([
        graphGetAllPages(`/${accountId}/adsets`, token, {
          fields: "id,name,status,daily_budget,lifetime_budget,optimization_goal,campaign{id,name}",
          limit: 200,
        }),
        graphGetInsights(`/${accountId}/insights`, token, {
          level: "adset",
          fields: "adset_id,spend,actions,action_values,purchase_roas",
          time_range: lastNDaysRange(30, new Date()),
          limit: 500,
        }),
      ]);

      if (listResult.status !== "fulfilled") throw listResult.reason;

      const performanceByAdsetId = new Map();
      if (insightsResult.status === "fulfilled") {
        for (const row of insightsResult.value.data || []) {
          const { spend, roas } = roasFromRow(row);
          performanceByAdsetId.set(row.adset_id, { spend, purchases: pickPurchaseCount(row.actions), roas });
        }
      }

      const adsets = (listResult.value.data || []).map((a) => ({
        ...a,
        performance: performanceByAdsetId.get(a.id) || null,
      }));
      res.status(200).json({ adsets });
      return;
    }
    res.status(400).json({ error: "accountId or adsetId is required" });
  } catch (err) {
    res.status(err.graphResponse ? 400 : 500).json({ error: err.message });
  }
}
