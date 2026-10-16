import { graphGet, graphPost, graphGetAllPages } from "./facebookGraph";

// Every Partnership Ads (branded content ads) Graph call this app makes,
// centralized here — same convention as lib/campaignLaunch.js for the
// Strategy/Launch flows. Field/param names below are taken from Meta's own
// reference implementation (a Python script using raw `requests`, not the
// `facebook_business` SDK — see Facebook Curls/partnership_ads_booster.py),
// not guessed from general Marketing API familiarity, since this corner of
// the API (Content Discovery, Branded Content Ad Permissions) is newer and
// less documented than the rest of what this app already calls.

// The full field set the Content Discovery API returns per content item —
// centralized as one constant so the Explore grid, the Partnership Code
// tab's lookup, and the pre-launch re-verification step (a later PR) all ask
// for the identical shape and never silently drift apart.
export const CONTENT_FIELDS =
  "content_id,platform,media_type,post_type,caption,permalink,creation_time," +
  "author{display_name,ig_user_id,fb_page_id,profile_picture_url}," +
  "is_recommended,ad_usage," +
  "partnership_info{ad_eligibility,tagged_partner{display_name,ig_user_id,fb_page_id},permission_status,permission_type,ad_code,content_types}," +
  "organic_insights{likes,comments,views,reach,shares,interaction,saves}";

// GET /{ig_user_id}/branded_content_ad_permissions — account-level
// permission per creator (not per post: once a creator grants this, every
// future post of theirs becomes usable, see the "My Requests" API route's
// own comment for why that shapes its UI). Paginates via the standard
// `paging.next` cursor, so graphGetAllPages handles it as-is.
export async function listPermissions(token, igUserId) {
  const result = await graphGetAllPages(`/${igUserId}/branded_content_ad_permissions`, token, {
    fields: "creator_ig_id,creator_username,permission_status",
  });
  return result.data || [];
}

// POST /{ig_user_id}/branded_content_ad_permissions — requests permission
// from one creator. Exactly one of creatorInstagramAccount (their IG user
// id) / creatorInstagramUsername is required by the API.
export async function requestPermission(token, igUserId, { creatorInstagramAccount, creatorInstagramUsername } = {}) {
  if (!creatorInstagramAccount && !creatorInstagramUsername) {
    throw new Error("requestPermission needs creatorInstagramAccount or creatorInstagramUsername");
  }
  const params = creatorInstagramAccount
    ? { creator_instagram_account: creatorInstagramAccount }
    : { creator_instagram_username: creatorInstagramUsername };
  return graphPost(`/${igUserId}/branded_content_ad_permissions`, token, params);
}

// GET /{business_id}/partnership-ads-advertisable-content — the Content
// Discovery API, cursor-paginated mode (one page at a time, unlike
// graphGetAllPages' own "follow every page" helper — the Explore grid drives
// its own "load more" rather than fetching the whole business's content
// eligibility in one request). Needs the Business's `pa_content_discovery_api`
// gatekeeper flag enabled; a 4xx here most likely means that flag is off for
// this Business, not a malformed request — surface Facebook's own error
// message rather than a generic one.
export async function discoverContent(
  token,
  businessId,
  { igUserId, after, postTypes, adEligibilities, adUsages, startDate, endDate, searchKey, limit = 25 } = {}
) {
  const params = {
    ig_user_id: igUserId,
    fields: CONTENT_FIELDS,
    limit: Math.min(limit, 50),
  };
  if (after) params.after = after;
  if (postTypes?.length) params.post_types = postTypes.map((t) => t.toLowerCase());
  if (adEligibilities?.length) params.ad_eligibilities = adEligibilities.map((t) => t.toLowerCase());
  if (adUsages?.length) params.ad_usages = adUsages.map((t) => t.toLowerCase());
  if (startDate) params.start_date = startDate;
  if (endDate) params.end_date = endDate;
  if (searchKey) params.search_key = searchKey;

  const json = await graphGet(`/${businessId}/partnership-ads-advertisable-content`, token, params);
  return { items: json.data || [], nextCursor: json.paging?.cursors?.after || null };
}

// Same endpoint, direct-lookup mode: resolves specific content by code,
// permalink, or id instead of paginating through everything — used by the
// Partnership Code tab and by a pre-launch re-verification step (content can
// go stale between being queued and actually launched). Exactly one of the
// three lookup arrays should be given; the API caps each at 50 entries.
export async function lookupContent(token, businessId, { igUserId, adCodes, permalinks, contentIds } = {}) {
  const params = { ig_user_id: igUserId, fields: CONTENT_FIELDS };
  if (adCodes?.length) params.ad_codes = adCodes;
  else if (permalinks?.length) params.permalinks = permalinks;
  else if (contentIds?.length) params.content_ids = contentIds;
  else throw new Error("lookupContent needs adCodes, permalinks, or contentIds");

  const json = await graphGet(`/${businessId}/partnership-ads-advertisable-content`, token, params);
  return json.data || [];
}

// POST /act_{ad_account_id}/advideos — registers an Instagram-hosted video
// as a prerequisite to creative creation for video content. `adCode` is only
// sent (with `is_partnership_ad: true`) when sourcing by Partnership Code.
export async function registerVideoSource(token, adAccountId, { sourceInstagramMediaId, adCode } = {}) {
  const params = { source_instagram_media_id: sourceInstagramMediaId };
  if (adCode) {
    params.partnership_ad_ad_code = adCode;
    params.is_partnership_ad = true;
  }
  return graphPost(`/act_${adAccountId}/advideos`, token, params);
}

const AD_FORMAT_CODES = { BOTH: 1, FIRST: 2, DYNAMIC: 3 };

// POST /act_{ad_account_id}/adcreatives — the branded-content creative.
// Sourcing is mutually exclusive: EITHER `adCode` (sets
// branded_content.instagram_boost_post_access_token) OR
// `sourceInstagramMediaId` (sent as its own top-level param) — never both.
export async function createBrandedCreative(
  token,
  adAccountId,
  { objectId, facebookPageId, igUserId, callToActionType, link, adCode, sourceInstagramMediaId, adFormat, testimonial } = {}
) {
  if (!adCode && !sourceInstagramMediaId) {
    throw new Error("createBrandedCreative needs adCode or sourceInstagramMediaId");
  }
  const brandedContent = {};
  if (adCode) brandedContent.instagram_boost_post_access_token = adCode;
  if (testimonial) brandedContent.testimonial = testimonial;
  if (adFormat && AD_FORMAT_CODES[adFormat]) brandedContent.ad_format = AD_FORMAT_CODES[adFormat];

  const params = {
    object_id: objectId,
    facebook_branded_content: { sponsor_page_id: facebookPageId },
    instagram_branded_content: { sponsor_id: igUserId },
    call_to_action: { type: callToActionType, value: { link } },
  };
  if (Object.keys(brandedContent).length > 0) params.branded_content = brandedContent;
  if (!adCode && sourceInstagramMediaId) params.source_instagram_media_id = sourceInstagramMediaId;

  return graphPost(`/act_${adAccountId}/adcreatives`, token, params);
}

// POST /act_{ad_account_id}/ads — always created PAUSED first, same safety
// pattern as pages/api/fb/launch-campaign.js; callers flip to ACTIVE in a
// separate, later call only once every object in the batch has succeeded.
export async function createAd(token, adAccountId, { name, adsetId, creativeId }) {
  return graphPost(`/act_${adAccountId}/ads`, token, {
    name,
    adset_id: adsetId,
    creative: { creative_id: creativeId },
    status: "PAUSED",
  });
}
