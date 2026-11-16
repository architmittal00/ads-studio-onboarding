import { graphGet } from "./facebookGraph";
import { searchTargeting } from "./metaInterestSearch";
import { titleCaseSnake } from "./reportShared";
import { deriveLanding, fetchPostLandingUrls } from "./adCreativeDetails";
import { normalizeStatus } from "./statusNormalize";
import { EDIT_AD_FIELDS, describeEditability } from "./adEdit";
import { fetchAdSetFull, BID_STRATEGIES } from "./adsetEdit";
import { fetchCampaignFull } from "./campaignEdit";

// Backs Explore's "View Details" row action (components/EntityDetailDrawer.js)
// — a read-only look at how a campaign/ad set/ad is actually configured on
// Facebook, not its performance. Three level-specific fetchers, one per
// entity type, each returning an already display-ready shape (names/labels
// resolved here, not left as raw Graph enums/ids) so the drawer component
// itself stays presentation-only.

// Mirrors components/CampaignFields.js's own CAMPAIGN_OBJECTIVES labels —
// duplicated rather than imported, since nothing under pages/api/ imports
// from components/ anywhere else in this codebase. titleCaseSnake() covers
// any objective value missing from this short, stable list.
const OBJECTIVE_LABELS = {
  OUTCOME_SALES: "Sales",
  OUTCOME_TRAFFIC: "Traffic",
  OUTCOME_LEADS: "Leads",
  OUTCOME_ENGAGEMENT: "Engagement",
  OUTCOME_AWARENESS: "Awareness",
  OUTCOME_APP_PROMOTION: "App Promotion",
};

function objectiveLabel(objective) {
  if (!objective) return null;
  return OBJECTIVE_LABELS[objective] || titleCaseSnake(objective.replace(/^OUTCOME_/, ""));
}

// Same value→label mapping as components/AdSetFields.js's own
// PUBLISHER_PLATFORMS/FACEBOOK_POSITIONS/INSTAGRAM_POSITIONS, duplicated for
// the same components/-vs-pages/api/ boundary reason as OBJECTIVE_LABELS
// above — these are small, stable display strings, not logic worth sharing
// across that boundary.
const PLATFORM_LABELS = { facebook: "Facebook", instagram: "Instagram", messenger: "Messenger", audience_network: "Audience Network" };
const FACEBOOK_POSITION_LABELS = { feed: "Feed", facebook_reels: "Reels", story: "Stories", video_feeds: "Video feeds", marketplace: "Marketplace", search: "Search results" };
const INSTAGRAM_POSITION_LABELS = { stream: "Feed", story: "Stories", reels: "Reels", explore: "Explore" };

function labelList(values, labels) {
  return (values || []).map((v) => labels[v] || titleCaseSnake(v));
}

let countryNamer = null;
// Facebook's `targeting.geo_locations.countries` is bare ISO-3166 codes
// ("IN", "US") with no name alongside — unlike regions/cities, which already
// come back with their own `name`. Intl.DisplayNames is a standard,
// zero-dependency JS API that resolves exactly this, no Graph call needed.
function countryName(code) {
  if (!code) return code;
  try {
    countryNamer = countryNamer || new Intl.DisplayNames(["en"], { type: "region" });
    return countryNamer.of(code) || code;
  } catch {
    return code;
  }
}

// Facebook's ad set `targeting.locales` is an array of Facebook's own
// numeric locale ids (e.g. 6 = "English (US)") — not ISO language codes, so
// Intl.DisplayNames can't resolve them. The only way to get their names is
// the same generic targeting-search endpoint the Launch tab's language
// picker already uses (lib/metaInterestSearch.js's searchTargeting), called
// with an empty query and a high limit — Meta's `adlocale` search returns
// its complete, small (~100-entry), fairly static list when `q` is blank,
// confirmed against Meta's own documented behavior for this endpoint.
// Soft-fails to `Locale <id>` if this lookup doesn't come back, same
// reasoning as every other secondary-enrichment lookup in this app (status,
// budget, creative thumbnails).
// The full locale list is the same for everyone and almost never changes: kept for the
// life of the warm instance instead of re-downloading ~1000 entries on every ad set.
let localeNamesCache = null;
async function resolveLocaleNames(token, localeIds) {
  if (!localeIds?.length) return {};
  if (localeNamesCache) return localeNamesCache;
  try {
    const all = await searchTargeting(token, "adlocale", "", { limit: 1000 });
    localeNamesCache = Object.fromEntries(all.map((l) => [String(l.key), l.name]));
    return localeNamesCache;
  } catch {
    return {};
  }
}

// Countries/regions/cities are three different shapes on Facebook's geo
// targeting object, but all just resolve to "a place name" for this
// read-only summary — flattened into one list rather than three, since the
// drawer shows them as a single "Locations" chip row, not three sub-rows.
function summarizeGeo(geo) {
  if (!geo) return null;
  const list = [
    ...(geo.countries || []).map(countryName),
    ...(geo.regions || []).map((r) => r.name || r.key),
    ...(geo.cities || []).map((c) => c.name || c.key),
  ];
  return list.length ? list : null;
}

export async function fetchCampaignDetails(id, token) {
  const full = await fetchCampaignFull(id, token);
  const c = full.campaign;
  return {
    name: c.name,
    objective: objectiveLabel(c.objective),
    status: c.status || null,
    effectiveStatus: normalizeStatus(c.effective_status) || null,
    accountId: full.accountId,
    budgetType: full.budgetType,
    startTime: full.startTime,
    form: full.form,
    info: full.info,
    bidStrategies: full.bidStrategies,
  };
}

export async function fetchAdSetDetails(id, token) {
  // One read of everything: the editable form state, the read-only properties, the budget type.
  const full = await fetchAdSetFull(id, token, resolveLocaleNames);
  return {
    name: full.adset.name,
    status: full.adset.status || null,
    effectiveStatus: normalizeStatus(full.adset.effective_status) || null,
    accountId: full.accountId,
    campaign: full.campaign,
    budgetType: full.budgetType,
    form: full.form,
    info: full.info,
    bidStrategies: BID_STRATEGIES,
    rawTargeting: full.adset.targeting || null,
  };
}

// Same resolution as Explore: the creative's own link, else (boosted posts) the link on the underlying Page post.
async function landingOf(creative, token) {
  const { url, source } = deriveLanding(creative);
  if (url) return { landingUrl: url, landingSource: source };
  if (creative.effective_object_story_id) {
    try {
      const posts = await fetchPostLandingUrls([creative.effective_object_story_id], token);
      const postUrl = posts[creative.effective_object_story_id];
      if (postUrl) return { landingUrl: postUrl, landingSource: "the link on the ad's Page post" };
    } catch {}
  }
  return { landingUrl: null, landingSource: null };
}

// An ad built from an existing Page post ("Use existing post") has no object_story_spec: its text, headline, description,
// button and link all live on the post itself, which is what Ads Manager shows. Soft-fails (e.g. no access to that Page).
async function fetchPostCopy(postId, token) {
  try {
    const post = await graphGet(`/${postId}`, token, { fields: "message,call_to_action,link,name,description,attachments{title,description,url,unshimmed_url,media_type,type}" });
    const att = post.attachments?.data?.[0] || {};
    return {
      text: post.message || null,
      headline: att.title || post.name || null,
      description: att.description || post.description || null,
      ctaType: post.call_to_action?.type || null,
      isVideo: /video/i.test(`${att.media_type || ""} ${att.type || ""}`),
    };
  } catch (err) {
    return { error: err?.message || "Could not read the post" };
  }
}

export async function fetchAdCopyDetails(id, token) {
  // Same field list the ad-edit flow reads (lib/adEdit.js), so what's shown
  // here and what an edit rebuilds from are the same data.
  // The edit field list has no creative-level call_to_action (where many ads keep their destination), so it is added
  // here — otherwise this screen and Explore's Landing Page column could resolve different links for the same ad.
  const data = await graphGet(`/${id}`, token, { fields: EDIT_AD_FIELDS.replace("creative{id,", "creative{id,call_to_action,video_id,effective_instagram_media_id,title,link_url,object_url,call_to_action_type,") });
  const creative = data.creative || {};
  const asset = creative.asset_feed_spec || {};
  const linkData = creative.object_story_spec?.link_data;
  const videoData = creative.object_story_spec?.video_data;

  // A standard ad has exactly one of each (checked via the object_story_spec/
  // body fallback chain); an Advantage+/dynamic-creative ad instead carries
  // several candidate variants Facebook rotates, under asset_feed_spec —
  // shown as a list of however many there actually are, 1 or many, rather
  // than arbitrarily picking just the first.
  const primaryTexts = asset.bodies?.length
    ? asset.bodies.map((b) => b.text).filter(Boolean)
    : [creative.body || linkData?.message || videoData?.message].filter(Boolean);
  const headlines = asset.titles?.length
    ? asset.titles.map((t) => t.text).filter(Boolean)
    : [linkData?.name || videoData?.title].filter(Boolean);
  const descriptions = asset.descriptions?.length
    ? asset.descriptions.map((d) => d.text).filter(Boolean)
    : [linkData?.description || videoData?.link_description].filter(Boolean);
  const ctaType = creative.call_to_action?.type || linkData?.call_to_action?.type || videoData?.call_to_action?.type || asset.call_to_action_types?.[0] || null;

  // Existing-post ad: whatever the creative itself didn't carry comes from the post.
  const needsPost = !primaryTexts.length && !headlines.length && !descriptions.length && !ctaType && !!creative.effective_object_story_id;
  let post = needsPost ? await fetchPostCopy(creative.effective_object_story_id, token) : null;
  // The Page post may be unreadable with this login; an Instagram-sourced ad still has its caption on the media.
  if (needsPost && !post?.text && creative.effective_instagram_media_id) {
    try {
      const media = await graphGet(`/${creative.effective_instagram_media_id}`, token, { fields: "caption" });
      if (media.caption) post = { ...(post || {}), text: media.caption };
    } catch {}
  }
  if (post?.text) primaryTexts.push(post.text);
  if (post?.headline) headlines.push(post.headline);
  if (post?.description) descriptions.push(post.description);
  // Creative-level fields Meta fills in for existing-post ads when the post itself can't be read.
  if (!headlines.length && creative.title) headlines.push(creative.title);
  const finalCtaType = ctaType || post?.ctaType || creative.call_to_action_type || null;

  return {
    name: data.name,
    status: data.status || null,
    effectiveStatus: normalizeStatus(data.effective_status) || null,
    accountId: data.account_id || null,
    creativeId: creative.id || null,
    thumbnailUrl: creative.thumbnail_url || null,
    isVideo: !!(videoData?.video_id || creative.video_id || post?.isVideo),
    campaign: data.campaign ? { id: data.campaign.id, name: data.campaign.name } : null,
    adset: data.adset ? { id: data.adset.id, name: data.adset.name } : null,
    primaryTexts,
    headlines,
    descriptions,
    ctaType: finalCtaType,
    ctaLabel: finalCtaType ? titleCaseSnake(finalCtaType.toLowerCase()) : null,
    ...(await landingOf(creative, token)),
    ...(post?.error ? { postReadError: post.error } : {}),
    editable: describeEditability(data),
  };
}
