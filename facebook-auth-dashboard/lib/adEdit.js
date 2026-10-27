import { graphGet, graphPost } from "./facebookGraph";
import { COPY_AD_FIELDS, classifyAd, hasAssetFeedContent } from "./adCopy";

// Editing an ad from "View details" (pages/api/fb/ad-update.js).
//
// Meta cannot edit a creative in place: changing any copy means creating a NEW
// creative with the new text and pointing the ad at it, which sends the ad back
// into review and can reset its learning. This file builds that new creative
// from the ad's current one (same page/Instagram/media references, only the
// text/CTA/link replaced) and is deliberately conservative about which ads it
// will touch — see `describeEditability`.

// COPY_AD_FIELDS (lib/adCopy.js) is the proven "read an ad's whole creative"
// field list; editing additionally needs the video title/link description,
// the ad's account, and the creative-level extras a rebuilt creative should keep.
export const EDIT_AD_FIELDS = COPY_AD_FIELDS.replace(
  "video_data{video_id,message,image_url,call_to_action}",
  "video_data{video_id,message,title,link_description,image_url,call_to_action}"
)
  .replace("id,name,status,effective_status,", "id,name,status,effective_status,account_id,")
  .replace("creative{id,object_type,", "creative{id,name,url_tags,degrees_of_freedom_spec,object_type,");

// Why/whether this ad's copy can be edited, and in what shape. `multiText` =
// the ad carries a pool of texts (Meta's "Multiple Text Options"), so several
// primary texts/headlines/descriptions are real; otherwise exactly one of each.
export function describeEditability(ad) {
  const kind = classifyAd(ad);
  const creative = ad.creative || {};
  if (!kind.copyable) return { copy: false, reason: kind.reason, multiText: false };
  if (kind.kind === "existing_post") {
    return {
      copy: false,
      reason: kind.isBrandedContent
        ? "This is a partnership (branded content) ad built from an existing post — its text lives on the post, not the ad."
        : "This ad uses an existing Page/Instagram post — its text lives on the post, not the ad.",
      multiText: false,
    };
  }
  if (kind.kind === "catalog") return { copy: false, reason: "Catalog ads use a template filled from the product set.", multiText: false };
  const spec = creative.object_story_spec || {};
  if (spec.link_data?.child_attachments?.length) return { copy: false, reason: "Carousel ads can't be edited here yet.", multiText: false };
  if (!spec.link_data && !spec.video_data) return { copy: false, reason: "This creative type can't be edited here.", multiText: false };
  const feed = creative.asset_feed_spec;
  const multiText = hasAssetFeedContent(feed) && !!(feed.bodies?.length || feed.titles?.length || feed.descriptions?.length);
  return { copy: true, reason: null, multiText };
}

const clean = (list) => (Array.isArray(list) ? list.map((t) => String(t ?? "").trim()).filter(Boolean) : []);

// Returns { objectStorySpec, assetFeedSpec } = the ad's current creative with
// `edits` ({ primaryTexts, headlines, descriptions, ctaType, landingUrl })
// applied. Throws a readable Error for anything not allowed.
export function buildEditedCreativeSpecs(ad, edits) {
  const editability = describeEditability(ad);
  if (!editability.copy) throw new Error(editability.reason || "This ad's copy can't be edited.");
  const creative = ad.creative;
  const spec = JSON.parse(JSON.stringify(creative.object_story_spec));
  const feed = editability.multiText ? JSON.parse(JSON.stringify(creative.asset_feed_spec)) : null;

  const primaryTexts = clean(edits.primaryTexts);
  const headlines = clean(edits.headlines);
  const descriptions = clean(edits.descriptions);
  const landingUrl = String(edits.landingUrl || "").trim();
  const ctaType = String(edits.ctaType || "").trim();

  if (primaryTexts.length === 0) throw new Error("A primary text is required.");
  if (landingUrl && !/^https?:\/\//i.test(landingUrl)) throw new Error("The website URL must start with http:// or https://");
  if (!editability.multiText && (primaryTexts.length > 1 || headlines.length > 1 || descriptions.length > 1)) {
    throw new Error("This ad has a single text of each kind — remove the extra variants.");
  }

  const cta = ctaType ? { type: ctaType, ...(landingUrl ? { value: { link: landingUrl } } : {}) } : undefined;

  if (spec.link_data) {
    spec.link_data.message = primaryTexts[0];
    if (headlines.length) spec.link_data.name = headlines[0];
    else delete spec.link_data.name;
    if (descriptions.length) spec.link_data.description = descriptions[0];
    else delete spec.link_data.description;
    if (landingUrl) spec.link_data.link = landingUrl;
    if (cta) spec.link_data.call_to_action = cta;
  } else if (spec.video_data) {
    spec.video_data.message = primaryTexts[0];
    if (headlines.length) spec.video_data.title = headlines[0];
    else delete spec.video_data.title;
    if (descriptions.length) spec.video_data.link_description = descriptions[0];
    else delete spec.video_data.link_description;
    if (cta) spec.video_data.call_to_action = cta;
  }

  if (feed) {
    feed.bodies = primaryTexts.map((text) => ({ text }));
    if (headlines.length) feed.titles = headlines.map((text) => ({ text }));
    else delete feed.titles;
    if (descriptions.length) feed.descriptions = descriptions.map((text) => ({ text }));
    else delete feed.descriptions;
    if (landingUrl) feed.link_urls = [{ ...(feed.link_urls?.[0] || {}), website_url: landingUrl }];
    if (ctaType) feed.call_to_action_types = [ctaType];
  }

  return { objectStorySpec: spec, assetFeedSpec: feed };
}

// Applies an edit to one ad. Returns { changed: [...], newCreativeId? }.
// name/status are plain field updates; `creativeId` swaps in an existing
// creative; `copy` builds and attaches a new one. Copy and creativeId are
// mutually exclusive (a swapped-in creative brings its own copy).
export async function updateAd(token, adId, { name, status, copy, creativeId }) {
  if (copy && creativeId) throw new Error("Change the creative and the copy in separate saves.");
  if (status && !["ACTIVE", "PAUSED"].includes(status)) throw new Error("status must be ACTIVE or PAUSED");

  const { ad, instagramOmitted } = await fetchAdForEdit(token, adId);
  const params = {};
  const changed = [];
  let newCreativeId = null;

  if (typeof name === "string" && name.trim() && name.trim() !== ad.name) {
    params.name = name.trim();
    changed.push("name");
  }
  if (status && status !== ad.status) {
    params.status = status;
    changed.push("status");
  }

  if (creativeId) {
    if (!/^\d+$/.test(String(creativeId))) throw new Error("creativeId must be a numeric id");
    if (String(creativeId) !== String(ad.creative?.id)) {
      params.creative = { creative_id: String(creativeId) };
      changed.push("creative");
    }
  } else if (copy) {
    const { objectStorySpec, assetFeedSpec } = buildEditedCreativeSpecs(ad, copy);
    const payload = { object_story_spec: objectStorySpec };
    if (assetFeedSpec) payload.asset_feed_spec = assetFeedSpec;
    if (ad.creative.url_tags) payload.url_tags = ad.creative.url_tags;
    if (ad.creative.degrees_of_freedom_spec) payload.degrees_of_freedom_spec = ad.creative.degrees_of_freedom_spec;
    const created = await graphPost(`/act_${ad.account_id}/adcreatives`, token, payload);
    newCreativeId = created.id;
    params.creative = { creative_id: newCreativeId };
    changed.push("copy");
  }

  if (changed.length === 0) return { changed, newCreativeId: null, instagramOmitted };
  await graphPost(`/${adId}`, token, params);
  // name/status echoed so the caller can patch its own copy of the row.
  return { changed, newCreativeId, instagramOmitted, name: params.name, status: params.status };
}

// Same old-Instagram-id fallback fetchAdForCopy has, with the edit field list.
async function fetchAdForEdit(token, adId) {
  try {
    return { ad: await graphGet(`/${adId}`, token, { fields: EDIT_AD_FIELDS }), instagramOmitted: false };
  } catch (err) {
    if (!/Old Instagram ID/i.test(err?.message || "") && err?.graphResponse?.error?.code !== 12) throw err;
    return { ad: await graphGet(`/${adId}`, token, { fields: EDIT_AD_FIELDS.replace(",instagram_user_id", "") }), instagramOmitted: true };
  }
}
