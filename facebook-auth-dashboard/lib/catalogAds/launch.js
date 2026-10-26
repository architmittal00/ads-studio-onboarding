import { ATTRIBUTION_SPECS, buildGeoLocations, buildTargeting, toMinorUnits } from "@/lib/campaignLaunch";
import { catalogAudienceSpec } from "./retargetSpec";

// Catalog ad payload builders — ported from sr-ads-launch's src/lib/launch.ts
// (buildTargeting/campaignParams/adsetParams/creativeParams), adapted onto
// this app's own AdSetFields-shaped field names and reusing
// lib/campaignLaunch.js's existing, already-proven broad-audience targeting
// builder for the non-retargeting case rather than a second copy of it.
// Scoped to catalog ads only (phase 4) — standard image/video/post ads stay
// on lib/campaignLaunch.js's own builders untouched.

// Performance goals valid for a catalog ad set (Meta rejects any other
// optimization_goal paired with a catalog ad set's promoted_object shape).
export const CATALOG_GOALS = [
  { value: "OFFSITE_CONVERSIONS", label: "Maximize number of conversions" },
  { value: "VALUE", label: "Maximize value of conversions" },
  { value: "LINK_CLICKS", label: "Maximize number of link clicks" },
];

const DAY_SECONDS = 86400;

// Retargeting audience: product_audience_specs built from the chosen preset,
// plus the same geo/age/gender/language/placement/device fields a broad
// audience would carry (Meta still wants these alongside a product audience
// spec, unlike a normal custom-audience targeting shape).
function buildCatalogRetargetTargeting(adset) {
  const spec = catalogAudienceSpec(adset);
  const productAudienceSpec = {
    product_set_id: spec.sourceSetId,
    inclusions: spec.events.map((event) => ({ retention_seconds: adset.retargetDays * DAY_SECONDS, rule: { event: { eq: event } } })),
  };
  if (spec.exclude) {
    productAudienceSpec.exclusions = [{ retention_seconds: spec.excludeDays * DAY_SECONDS, rule: { event: { eq: "Purchase" } } }];
  }

  const targeting = {
    geo_locations: buildGeoLocations(adset.countries),
    age_min: adset.ageMin,
    age_max: adset.ageMax,
    product_audience_specs: [productAudienceSpec],
    targeting_automation: { advantage_audience: 0 },
  };
  if (adset.gender !== "all") targeting.genders = adset.gender === "male" ? [1] : [2];
  if (adset.languages?.length) targeting.locales = adset.languages.map((l) => l.key);

  // Same placement/device shape as lib/campaignLaunch.js's own buildTargeting
  // — duplicated rather than imported so that file's existing, already-
  // trusted logic stays completely untouched by this feature.
  if (adset.placementType === "MANUAL") {
    targeting.publisher_platforms = adset.publisherPlatforms?.length ? adset.publisherPlatforms : ["facebook", "instagram"];
    if (adset.facebookPositions?.length) targeting.facebook_positions = adset.facebookPositions;
    if (adset.instagramPositions?.length) targeting.instagram_positions = adset.instagramPositions;
  }
  return targeting;
}

export function buildCatalogAdsetTargeting(adset) {
  // A standard (non-catalog) ad set has no retargeting concept at all — only
  // a catalog ad set's own audience-mode toggle can select it.
  return adset.isCatalog && adset.catalogAudienceMode === "RETARGET" ? buildCatalogRetargetTargeting(adset) : buildTargeting(adset);
}

export function buildCatalogCampaignPayload({ name, bidStrategy, catalogId, budgetStrategy, budgetType, budgetAmountMinorUnits }) {
  const payload = {
    name,
    objective: "OUTCOME_SALES",
    status: "PAUSED",
    special_ad_categories: [],
  };
  // Only a catalog campaign carries a catalog id — a standard (image/
  // existing-post) Sales campaign from this same wizard has none.
  if (catalogId) payload.promoted_object = { product_catalog_id: catalogId };
  if (budgetStrategy === "CBO" && budgetAmountMinorUnits) {
    payload.bid_strategy = bidStrategy || "LOWEST_COST_WITHOUT_CAP";
    if (budgetType === "LIFETIME") payload.lifetime_budget = budgetAmountMinorUnits;
    else payload.daily_budget = budgetAmountMinorUnits;
  } else {
    // Same Meta requirement lib/campaignLaunch.js's own builder documents
    // (code 100, subcode 4834011): a campaign with no campaign-level budget
    // must explicitly say its ad sets don't share one.
    payload.is_adset_budget_sharing_enabled = false;
  }
  return payload;
}

// `fields.isCatalog` picks the promoted_object shape: a catalog ad set's
// conversion tracking comes from the catalog's own linked dataset (phase 2's
// link-pixel), not a per-ad-set pixel field, so it carries product_set_id
// instead of pixel_id — the same distinction lib/campaignLaunch.js's own
// buildGenericAdsetPayload never had to make since it only ever builds
// non-catalog ad sets.
export function buildCatalogAdsetPayload(fields) {
  const targeting = buildCatalogAdsetTargeting(fields);
  const payload = {
    name: fields.name,
    campaign_id: fields.campaignId,
    status: "PAUSED",
    billing_event: "IMPRESSIONS",
    optimization_goal: fields.optimizationGoal,
    // Both catalog and standard ad sets here send people to the website
    // explicitly — left empty, Meta may default to the app.
    destination_type: "WEBSITE",
    targeting,
    bid_strategy: fields.bidStrategy || "LOWEST_COST_WITHOUT_CAP",
    promoted_object: fields.isCatalog
      ? fields.optimizationGoal === "LINK_CLICKS"
        ? { product_set_id: fields.productSetId }
        : { product_set_id: fields.productSetId, custom_event_type: fields.customEventType || "PURCHASE" }
      : { pixel_id: fields.pixelId, custom_event_type: fields.customEventType || "PURCHASE" },
    start_time: new Date(Date.now() + 60_000).toISOString(),
  };
  if (fields.attributionSetting && ATTRIBUTION_SPECS[fields.attributionSetting]) {
    payload.attribution_spec = ATTRIBUTION_SPECS[fields.attributionSetting];
  }
  if (fields.budgetStrategy === "ABO" && fields.budgetAmountMinorUnits) {
    if (fields.budgetType === "LIFETIME") payload.lifetime_budget = fields.budgetAmountMinorUnits;
    else payload.daily_budget = fields.budgetAmountMinorUnits;
  }
  return payload;
}

// Catalog ad creative: a template Meta fills in per shopper from the
// product set, not a fixed image/video. `{{product.*}}` tokens in
// message/headline/description are resolved by Meta at delivery.
export function buildCatalogCreativeParams({ ad, productSetId }) {
  const template = {
    message: ad.message,
    name: ad.headline,
    description: ad.description || undefined,
    link: ad.link.trim(),
    call_to_action: { type: ad.cta },
  };
  if (ad.format === "SINGLE") template.force_single_link = true;
  else template.multi_share_end_card = true;

  const story = { page_id: ad.pageId, template_data: template };
  if (ad.instagramUserId) story.instagram_user_id = ad.instagramUserId;

  return {
    name: `${ad.name.trim() || "Catalog ad"} - Catalog creative`,
    product_set_id: productSetId,
    object_story_spec: story,
    applink_treatment: "web_only",
  };
}

// Standard (non-catalog) ad creative: an uploaded image, or an existing
// Facebook/Instagram post — ported from sr-ads-launch's own
// standardCreativeParams, trimmed to drop its videoId branch (video upload
// is a later phase; see components/catalogads/StandardAdFields.js).
export function buildStandardCreativeParams({ ad }) {
  const name = `${ad.name.trim() || "Ad"} - Creative`;
  if (ad.kind === "POST" && ad.postSource === "FACEBOOK") {
    return { name, object_story_id: ad.postId };
  }
  if (ad.kind === "POST") {
    return { name, object_id: ad.pageId, instagram_user_id: ad.instagramUserId, source_instagram_media_id: ad.postId };
  }
  if (ad.videoId) {
    // Video ad: Meta needs a thumbnail (a frame of the video, uploaded as a
    // regular image — see components/catalogads/videoUpload.js's frameOf()).
    const video = {
      video_id: ad.videoId,
      image_hash: ad.imageHash,
      message: ad.message,
      call_to_action: { type: ad.cta, value: { link: ad.link.trim() } },
    };
    if (ad.headline.trim()) video.title = ad.headline;
    if (ad.description.trim()) video.link_description = ad.description;
    const story = { page_id: ad.pageId, video_data: video };
    if (ad.instagramUserId) story.instagram_user_id = ad.instagramUserId;
    return { name, object_story_spec: story };
  }
  const link = {
    image_hash: ad.imageHash,
    link: ad.link.trim(),
    message: ad.message,
    call_to_action: { type: ad.cta, value: { link: ad.link.trim() } },
  };
  if (ad.headline.trim()) link.name = ad.headline;
  if (ad.description.trim()) link.description = ad.description;
  const story = { page_id: ad.pageId, link_data: link };
  if (ad.instagramUserId) story.instagram_user_id = ad.instagramUserId;
  return { name, object_story_spec: story };
}

export { toMinorUnits };
