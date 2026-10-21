import { graphGet, graphPost, graphGetAllPages } from "./facebookGraph";

// Every Partnership Ads (branded content ads) Graph call this app makes,
// centralized here — same convention as lib/campaignLaunch.js for the
// Strategy/Launch flows. Field/param names below are taken from Meta's own
// reference implementation (a Python script using raw `requests`, not the
// `facebook_business` SDK — see Facebook Curls/partnership_ads_booster.py),
// not guessed from general Marketing API familiarity, since this corner of
// the API (Content Discovery, Branded Content Ad Permissions) is newer and
// less documented than the rest of what this app already calls.
//
// `adAccountId` everywhere below is this app's own account id as already
// returned by /me/adaccounts and threaded through every page/API route —
// i.e. it already carries its own "act_" prefix ("act_12345", not "12345").
// Every path is built as `/${adAccountId}/...`, never `/act_${adAccountId}/...`
// — the latter produces a real, confirmed "act_act_12345" 400 from Graph.

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

// Resolves an actual renderable preview for a piece of Content Discovery
// content, which otherwise carries no media/image/video URL at all —
// CONTENT_FIELDS above has no such field, and Meta's reference
// implementation for this endpoint (the Python script this feature was
// built from, Facebook Curls/partnership_ads_booster.py) never requests one
// either. Reported by the user: Explore Ads and Partnership Code both show
// no actual preview of the content, which was blocking real use of the
// launch flow ("not able to see ad is impacting the ability to push the
// creative").
//
// Two mechanisms, tried in order:
// 1. Direct media-object lookup — same principle PR #256 already proved for
//    an ad's own `effective_instagram_media_id` (a plain `GET /{id}?fields=...`
//    needs no Business/Content-Discovery scoping at all once you have the
//    right id). This app's own reference script hints a discovery item's own
//    `id` (what this app calls `content_id`) is itself a usable Instagram
//    media id, not just an opaque discovery-API identifier — see
//    partnership_ads_booster.py's `fetch_media_insights`, which reads a
//    discovery item's `id` straight into a `media_id` param for exactly this
//    kind of plain object GET (there, for `like_count`/`comments_count`; here,
//    for `media_url`/`thumbnail_url`). UNCONFIRMED against a real account —
//    attempted first and simply falls through to oEmbed below on any
//    failure, so a wrong guess here costs nothing.
// 2. Instagram's public oEmbed endpoint (permalink-based, always available —
//    every piece of content has one). Returns a static `thumbnail_url` and a
//    native, embeddable `html` widget with its own real play controls, but
//    never a raw video file — Instagram's own embed script owns playback
//    entirely, there is no `muted`/`autoplay`/`loop` we could set ourselves
//    on it the way a plain `<video>` tag allows.
export async function fetchContentPreview(token, { contentId, permalink } = {}) {
  if (contentId) {
    try {
      const media = await graphGet(`/${contentId}`, token, { fields: "media_url,thumbnail_url,media_type" });
      if (media?.media_url) {
        return { kind: "direct", mediaUrl: media.media_url, thumbnailUrl: media.thumbnail_url || null, mediaType: media.media_type || null };
      }
    } catch {
      // Falls through to oEmbed — see this function's own header comment.
    }
  }
  if (!permalink) return null;
  const oembed = await graphGet("/instagram_oembed", token, { url: permalink, omitscript: true });
  return { kind: "oembed", thumbnailUrl: oembed.thumbnail_url || null, html: oembed.html || null };
}

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

// POST /{ad_account_id}/advideos — registers an Instagram-hosted video
// as a prerequisite to creative creation for video content. `adCode` is only
// sent (with `is_partnership_ad: true`) when sourcing by Partnership Code.
export async function registerVideoSource(token, adAccountId, { sourceInstagramMediaId, adCode } = {}) {
  const params = { source_instagram_media_id: sourceInstagramMediaId };
  if (adCode) {
    params.partnership_ad_ad_code = adCode;
    params.is_partnership_ad = true;
  }
  return graphPost(`/${adAccountId}/advideos`, token, params);
}

const AD_FORMAT_CODES = { BOTH: 1, FIRST: 2, DYNAMIC: 3 };

// POST /{ad_account_id}/adcreatives — the branded-content creative.
// Sourcing is mutually exclusive: EITHER `adCode` (sets
// branded_content.instagram_boost_post_access_token) OR
// `sourceInstagramMediaId` (sent as its own top-level param) — never both.
//
// `object_id` is the PRIMARY identity — this app always runs the ad as the
// advertiser/brand (the connected Page), never flips to "creator as primary"
// (Meta supports both, see the identity note below) — so `object_id` is
// always the brand's own Facebook Page id.
//
// `facebook_branded_content.sponsor_page_id` / `instagram_branded_content.
// sponsor_id` are the SECONDARY identity — and, confirmed the hard way, that
// is the tagged PARTNER's (the creator's) Facebook Page / Instagram id, NOT
// the advertiser's own. This function used to receive the advertiser's own
// `facebookPageId`/`igUserId` for these two fields (the same values already
// used for `object_id` elsewhere), which made every real launch attempt read
// to Graph as "the brand is claiming to be its own tagged partner" — exactly
// the "@sheshaayurveda isn't a partner of @sheshaayurveda" (code 100,
// subcode 3867018) error chased across several prior rounds. PR #280 had
// already explained *half* of that error (a brand's own authored post is
// structurally never eligible, no fix possible) — but that same error was
// ALSO firing for genuinely eligible, creator-authored collab content, for
// this completely different and actually-fixable reason: this function was
// never told who the real tagged partner was.
//
// Confirmed two ways: (1) the user's own live retry — swapping these two
// fields from the brand's own ids to the actual creator's (from Content
// Discovery's own `partnership_info.tagged_partner`) is what made a real
// collab reel launch successfully; (2) Meta's own docs, "Instagram
// Partnership Ads with a New Ad Creative" — the "yourself as primary
// identity" example sets `sponsor_page_id`/`sponsor_id` to literal
// Creator-Page-ID/Creator-IG-ID values, with `object_story_spec.page_id` (the
// equivalent of this function's `objectId` for the other creative-
// construction method) set to the Advertiser's own Page ID. (Meta's sibling
// "Boost Existing Instagram Media" doc page uses placeholder names that read
// the opposite way with no actual example values behind them — inconsistent
// with the annotated, real-ID example on the other page, and directly
// contradicted by this app's own real Graph error; treated as a docs
// inconsistency, not followed.)
export async function createBrandedCreative(
  token,
  adAccountId,
  { objectId, sponsorFacebookPageId, sponsorIgUserId, callToActionType, link, adCode, sourceInstagramMediaId, adFormat, testimonial } = {}
) {
  if (!adCode && !sourceInstagramMediaId) {
    throw new Error("createBrandedCreative needs adCode or sourceInstagramMediaId");
  }
  if (!sponsorFacebookPageId && !sponsorIgUserId) {
    throw new Error("createBrandedCreative needs the tagged partner's sponsorFacebookPageId and/or sponsorIgUserId");
  }
  const brandedContent = {};
  if (adCode) brandedContent.instagram_boost_post_access_token = adCode;
  if (testimonial) brandedContent.testimonial = testimonial;
  if (adFormat && AD_FORMAT_CODES[adFormat]) brandedContent.ad_format = AD_FORMAT_CODES[adFormat];

  const params = {
    object_id: objectId,
    call_to_action: { type: callToActionType, value: { link } },
  };
  // Meta auto-links the counterpart identity when only one of the two is
  // given (its own docs' note), so either alone is enough — only send what
  // Content Discovery actually gave us for this partner.
  if (sponsorFacebookPageId) params.facebook_branded_content = { sponsor_page_id: sponsorFacebookPageId };
  if (sponsorIgUserId) params.instagram_branded_content = { sponsor_id: sponsorIgUserId };
  if (Object.keys(brandedContent).length > 0) params.branded_content = brandedContent;
  if (!adCode && sourceInstagramMediaId) params.source_instagram_media_id = sourceInstagramMediaId;

  return graphPost(`/${adAccountId}/adcreatives`, token, params);
}

// POST /{ad_account_id}/ads — always created PAUSED first, same safety
// pattern as pages/api/fb/launch-campaign.js; callers flip to ACTIVE in a
// separate, later call only once every object in the batch has succeeded.
export async function createAd(token, adAccountId, { name, adsetId, creativeId }) {
  return graphPost(`/${adAccountId}/ads`, token, {
    name,
    adset_id: adsetId,
    creative: { creative_id: creativeId },
    status: "PAUSED",
  });
}
