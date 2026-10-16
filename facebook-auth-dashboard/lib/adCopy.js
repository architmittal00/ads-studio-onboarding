import { graphGet, graphPost, graphGetInsights } from "./facebookGraph";
import { chunk } from "./adCreativeDetails";

// Fields needed to fully rebuild a standard ad's creative in a different ad
// account — a new, purpose-built fields string, NOT lib/adCreativeDetails.js's
// fetchAdDetails (that one is tuned for the Report tab's read-only display;
// changing it risks regressing that page). object_story_spec here carries
// everything a link/video/carousel ad needs to be reconstructed: the Page +
// (optional) Instagram actor, the on-image/video asset references
// (image_hash / video_id, including per-carousel-card), and the copy/CTA
// fields, which pass through to the new creative completely untouched.
export const COPY_AD_FIELDS =
  "id,name,status,effective_status," +
  "adset{id,name},campaign{id,name}," +
  "creative{id,object_type,product_set_id,thumbnail_url," +
  "object_story_spec{page_id,instagram_actor_id," +
  "link_data{link,message,name,description,call_to_action,image_hash," +
  "child_attachments{link,name,description,image_hash}}," +
  "video_data{video_id,message,image_url,call_to_action}}," +
  "asset_feed_spec{bodies{text}}}";

// CORRECTION (this function's second rewrite): `time_range`/`date_preset`
// on `GET /{accountId}/ads` do NOT filter which ad rows come back — they
// only scope nested insights-shaped sub-fields requested in the same call.
// An earlier version of this function passed `time_range` straight to
// `/ads` believing it bounded the result set (Meta's own `/ads` reference
// page lists the param with no such caveat); that happened to dodge one
// "Please reduce the amount of data you're asking for" error on one account
// — probably by changing the declared query's estimated cost, not its
// actual row count — but a busier account then timed out outright
// (FUNCTION_INVOCATION_TIMEOUT) walking its full, unfiltered ad list with
// this fields string's depth (nested object_story_spec, carousel
// child_attachments) regardless of the date range picked in the UI.
//
// `/insights` genuinely does respect `time_range` (this is the
// well-established, correct way to scope by date on this API — the same
// mechanism pages/api/fb/adsets-list.js already relies on for its own
// ad-set performance numbers). So this now asks `/insights` which ad ids
// actually had delivery in the window (cheap: `level: "ad"`, just the id,
// no real metrics), then fetches this picker's heavy per-ad creative
// fields only for that bounded candidate set, via the exact chunked
// `?ids=` batch pattern lib/adCreativeDetails.js's fetchAdDetails already
// uses for the identical reason (avoid ever listing the account's full ad
// set when only specific ids are actually needed).
//
// Trade-off, stated plainly: an ad that exists but has zero delivery in the
// window (e.g. brand new, launched minutes ago with no impressions yet)
// won't show up here even though it's real — there is no other way to get
// a genuinely server-side-bounded "ads active in X" on this API. For this
// feature's purpose (pick a proven, already-running ad to replicate
// elsewhere), that's an acceptable, arguably correct reading of "active."
export async function fetchCopyableAds(token, accountId, { since, until }) {
  if (!since || !until) {
    throw new Error("A date range is required to list ads for this account.");
  }
  const insights = await graphGetInsights(`/${accountId}/insights`, token, {
    level: "ad",
    fields: "ad_id",
    time_range: { since, until },
    limit: 500,
  });
  const adIds = [...new Set((insights.data || []).map((row) => row.ad_id).filter(Boolean))];
  if (adIds.length === 0) return [];

  const batches = chunk(adIds, 50);
  const results = await Promise.allSettled(
    batches.map((batch) => graphGet("", token, { ids: batch.join(","), fields: COPY_AD_FIELDS }))
  );
  const ads = [];
  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    ads.push(...Object.values(result.value || {}));
  }
  return ads;
}

// An ad is copyable by this feature only if it has a standard
// object_story_spec-based creative. Catalog/Dynamic Product ads
// (product_set_id) have no fixed creative to clone — Facebook generates
// per-product creative at serve time, so there's nothing stable to copy.
// Dynamic Creative ads (asset_feed_spec only, no object_story_spec) permute
// many bodies/titles/images/videos at once; rebuilding that correctly is a
// materially bigger surface than a single fixed creative and is explicitly
// out of scope for this feature's first version — shown as unsupported
// rather than silently attempted and failed.
export function classifyAd(ad) {
  const creative = ad.creative || {};
  if (!creative.id) return { copyable: false, reason: "No creative on this ad." };
  if (creative.product_set_id) return { copyable: false, reason: "Catalog/Dynamic Product ad — not supported yet." };
  if (!creative.object_story_spec) {
    if (creative.asset_feed_spec) return { copyable: false, reason: "Dynamic Creative ad — not supported yet." };
    return { copyable: false, reason: "Unrecognized creative type." };
  }
  return { copyable: true, reason: null };
}

// Every image_hash an ad's object_story_spec references — the top-level
// link_data image plus each carousel child_attachment's own image, if any.
// De-duplicated since a carousel can repeat the same image across cards.
export function collectImageHashes(spec) {
  const hashes = new Set();
  if (spec?.link_data?.image_hash) hashes.add(spec.link_data.image_hash);
  for (const child of spec?.link_data?.child_attachments || []) {
    if (child.image_hash) hashes.add(child.image_hash);
  }
  return [...hashes];
}

export function collectVideoIds(spec) {
  return spec?.video_data?.video_id ? [spec.video_data.video_id] : [];
}

function extractNewHash(json, originalHash) {
  // adimages create calls return either {images: {<name>: {hash}}} (bytes
  // upload) or a flatter shape depending on the exact call — handle both
  // rather than assuming one.
  if (json.images) {
    const first = Object.values(json.images)[0];
    if (first?.hash) return first.hash;
  }
  if (json.hash) return json.hash;
  throw new Error(`Image copy for ${originalHash} returned no hash`);
}

// Fallback when copy_from is rejected for any reason (plan's flagged
// uncertainty #4 — Meta's own docs only state a read-access requirement,
// not a guaranteed-to-always-work contract): fetch the image's temporary
// direct URL from the source account and re-upload it as raw bytes to the
// destination. Only reached if the primary copy_from path throws.
async function copyImageByDownload(token, destAccountId, { sourceAccountId, hash, originalError }) {
  let sourceInfo;
  try {
    sourceInfo = await graphGet(`/${sourceAccountId}/adimages`, token, { hashes: [hash] });
  } catch {
    throw originalError;
  }
  const url = sourceInfo?.data?.[0]?.url;
  if (!url) throw originalError;
  const imageRes = await fetch(url);
  if (!imageRes.ok) throw originalError;
  const buffer = Buffer.from(await imageRes.arrayBuffer());
  const json = await graphPost(`/${destAccountId}/adimages`, token, { bytes: buffer.toString("base64") });
  return extractNewHash(json, hash);
}

// Copies one ad image's hash into the destination ad account via Meta's own
// cross-account copy mechanism (POST /act_X/adimages, copy_from) — confirmed
// against Meta's ad-image reference docs. `sourceAccountId` is passed
// through exactly as this app already carries account ids everywhere (with
// the "act_" prefix — see the PR #199 double-act_ bug fix in
// lib/partnershipAds.js for why that convention matters); flagged as a
// to-verify assumption since Meta's own example shows a bare numeric string.
export async function copyImageAcrossAccounts(token, destAccountId, { sourceAccountId, hash }) {
  try {
    const json = await graphPost(`/${destAccountId}/adimages`, token, {
      copy_from: { source_account_id: sourceAccountId, hash },
    });
    return extractNewHash(json, hash);
  } catch (err) {
    return copyImageByDownload(token, destAccountId, { sourceAccountId, hash, originalError: err });
  }
}

export async function fetchVideoSourceUrl(token, videoId) {
  const json = await graphGet(`/${videoId}`, token, { fields: "source" });
  if (!json.source) throw new Error("Source video has no downloadable source URL.");
  return json.source;
}

const VIDEO_POLL_INTERVAL_MS = 2000;
const VIDEO_POLL_TIMEOUT_MS = 20000;

// A freshly re-ingested video processes asynchronously in the destination
// account — referencing it in a creative too early can fail outright. Polls
// briefly and gives up with a clear, actionable error rather than hanging or
// letting the creative call fail with an opaque message. `video_status`'s
// exact value set is a to-verify assumption against a real account (Meta's
// docs on this specific field are thin) — treated as "still processing"
// (keep polling) for anything other than an explicit ready/error.
export async function copyVideoAcrossAccounts(token, destAccountId, { sourceUrl, title }) {
  const created = await graphPost(`/${destAccountId}/advideos`, token, { file_url: sourceUrl, title });
  const videoId = created.id;
  const deadline = Date.now() + VIDEO_POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const statusJson = await graphGet(`/${videoId}`, token, { fields: "status" });
    const state = statusJson.status?.video_status;
    if (state === "ready") return videoId;
    if (state === "error") throw new Error("Video failed to process in the destination account.");
    await new Promise((resolve) => setTimeout(resolve, VIDEO_POLL_INTERVAL_MS));
  }
  throw new Error("Video is still processing in the destination account — try copying this ad again shortly.");
}

// Deep-clones an object_story_spec, swapping every image_hash / video_id
// reference for its destination-account equivalent via the maps built while
// copying assets. Everything else — page_id, instagram_actor_id, link,
// message, call_to_action, carousel copy — passes through completely
// untouched. This is the "page details remain same" half of the feature.
export function rebuildObjectStorySpec(spec, hashMap, videoIdMap) {
  const rebuilt = JSON.parse(JSON.stringify(spec));
  if (rebuilt.link_data?.image_hash) {
    rebuilt.link_data.image_hash = hashMap.get(rebuilt.link_data.image_hash) || rebuilt.link_data.image_hash;
  }
  for (const child of rebuilt.link_data?.child_attachments || []) {
    if (child.image_hash) child.image_hash = hashMap.get(child.image_hash) || child.image_hash;
  }
  if (rebuilt.video_data?.video_id) {
    rebuilt.video_data.video_id = videoIdMap.get(rebuilt.video_data.video_id) || rebuilt.video_data.video_id;
  }
  return rebuilt;
}

export async function createCopiedCreative(token, destAccountId, objectStorySpec) {
  const json = await graphPost(`/${destAccountId}/adcreatives`, token, { object_story_spec: objectStorySpec });
  return json.id;
}

// Identical shape to the existing calls in pages/api/fb/launch-campaign.js
// and pages/api/fb/duplicate-ad.js — always PAUSED first, same safety
// pattern as every object this app creates.
export async function createCopiedAd(token, destAccountId, { name, adsetId, creativeId }) {
  const json = await graphPost(`/${destAccountId}/ads`, token, {
    name,
    adset_id: adsetId,
    creative: { creative_id: creativeId },
    status: "PAUSED",
  });
  return json.id;
}
