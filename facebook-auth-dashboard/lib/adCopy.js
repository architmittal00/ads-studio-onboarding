import { graphGet, graphPost, graphGetAllPages, graphGetInsights } from "./facebookGraph";
import { chunk } from "./adCreativeDetails";
import { resolveGraphFields } from "./insightsMetrics";
import { mapWithConcurrency } from "./metaInterestSearch";
import { buildGenericAdsetPayload, toMinorUnits } from "./campaignLaunch";

// How many ads one copyAdsIntoAdset call copies at once. Each ad is itself
// several sequential Graph calls (re-fetch, asset copy/video poll, creative
// create, ad create) — ads used to be copied fully one at a time, so an N-ad
// batch took roughly N times one ad's own (already multi-call) latency. A
// modest concurrency cap — rather than firing every ad at once — trades some
// of that latency back without flooding Meta's per-app/per-user rate
// limiting (X-App-Usage/X-Business-Use-Case-Usage headers) on a route that
// already issues several write calls per item; same reasoning and the same
// mapWithConcurrency runner pages/api/fb/interest-recommendations.js already
// uses for its own bulk Graph calls.
//
// Raised 3 -> 5 at the user's request for more speed on larger batches.
// Meta's rate limiting is a rolling usage-score (cumulative call time in a
// window), not a hard concurrent-connection cap, so the total number of
// calls this route makes is unchanged either way — only how clustered in
// time they are. If a real multi-ad batch ever surfaces a visible rate-limit
// error (Meta's "(#4)"/"(#17)" family, or an explicit "rate limit" message),
// that's the signal to dial this back down — not yet seen, unverified
// against a real account at this value. See PROJECT_STATUS.md.
//
// Moved here (from pages/api/fb/copy-ads/copy.js) alongside copyAdsIntoAdset
// itself — the ad-set/campaign-level copy routes need the same default.
export const COPY_CONCURRENCY = 5;

// How many ad sets copyAdsetsIntoCampaign (below) creates — and copies ads
// into — at once. Kept deliberately lower than COPY_CONCURRENCY (which
// already runs up to 5 concurrent ad-copies *within* one ad set) — several
// ad sets, each copying several ads, compounds into far more simultaneous
// write-heavy Graph calls than this app has ever exercised at the plain
// ad-set level. Unverified against a real multi-ad-set account at this
// value; the first signal to dial it down is the same one COPY_CONCURRENCY
// already watches for (a visible Meta rate-limit error). See PROJECT_STATUS.md.
export const ADSET_CONCURRENCY = 2;

// Default picker-table metrics, shared between the client (initial column
// selection) and the server (fallback when the `metrics` query param is
// omitted) so the two can't drift apart.
export const DEFAULT_COPY_METRIC_KEYS = ["spend", "purchases", "revenue", "ctr", "roas", "cost_per_purchase"];

// Fields needed to fully rebuild a standard ad's creative in a different ad
// account — a new, purpose-built fields string, NOT lib/adCreativeDetails.js's
// fetchAdDetails (that one is tuned for the Report tab's read-only display;
// changing it risks regressing that page). object_story_spec here carries
// everything a link/video/carousel ad needs to be reconstructed: the Page +
// (optional) Instagram actor, the on-image/video asset references
// (image_hash / video_id, including per-carousel-card), and the copy/CTA
// fields, which pass through to the new creative completely untouched.
//
// `instagram_actor_id` was Meta's field name for this pre-v22.0; it's been
// replaced by `instagram_user_id` (confirmed via Meta's v22.0 changelog —
// querying the old field name now throws outright: "(#12) Old Instagram ID
// is deprecated for versions v22.0 and higher", which is exactly what hit a
// real ad during copying before this was caught). `withInstagram` toggles
// whether that field is requested at all — see fetchAdForCopy below for why
// a second, Instagram-field-free variant exists: the error's own wording
// ("Old Instagram ID", not "unsupported field") suggests at least some
// ads' creative may still carry a never-migrated legacy-format id that
// fails even under the new field name, not just the old one.
//
// `template_data` (sibling of `link_data`/`video_data` under
// object_story_spec) is a Catalog/Dynamic Product ad's spec — Facebook fills
// its macros ({{product.name}}, etc.) in per-product from the product set at
// serve time. `effective_object_story_id`, `facebook_branded_content`,
// `instagram_branded_content`, and `branded_content` are what an ad built
// from an *already-existing* Page/Instagram post (Ads Manager's "Use
// Existing Post," and how every Partnership/branded-content ad in this app
// works) carries instead of an inline object_story_spec at all — same field
// list lib/partnershipDetection.js already proves safe to fetch on an
// arbitrary ad. See classifyAd below for how both get turned into something
// copyable instead of "not supported yet."
function copyAdFields(withInstagram) {
  return (
    "id,name,status,effective_status," +
    "adset{id,name},campaign{id,name}," +
    "creative{id,object_type,product_set_id,thumbnail_url,effective_object_story_id," +
    "facebook_branded_content,instagram_branded_content,branded_content," +
    `object_story_spec{page_id${withInstagram ? ",instagram_user_id" : ""},` +
    "link_data{link,message,name,description,call_to_action,image_hash," +
    "child_attachments{link,name,description,image_hash}}," +
    "video_data{video_id,message,image_url,call_to_action}," +
    "template_data{link,message,name,description,call_to_action,image_hash," +
    "child_attachments{link,name,description,image_hash}}}," +
    "asset_feed_spec{bodies{text},titles{text},descriptions{text}," +
    "link_urls{website_url,display_url,deeplink_url},call_to_action_types," +
    "images{hash},videos{video_id,thumbnail_url},ad_formats,optimization_type}}"
  );
}

export const COPY_AD_FIELDS = copyAdFields(true);
const COPY_AD_FIELDS_NO_INSTAGRAM = copyAdFields(false);

// BUG FOUND POST-SHIP (first real cross-account copy): the copied ad's
// Primary Text/Headline/Description came through blank even though the
// image/creative itself copied fine. Root cause — any ad built with Meta's
// "Multiple Text Options" (a.k.a. Advantage+ creative text enhancements,
// on by default in Ads Manager's ad composer) stores its actual text pool
// in `creative.asset_feed_spec.bodies/titles/descriptions`, NOT in
// `object_story_spec.link_data.message/name/description` — those often
// come back empty or absent on this API for such ads, since Meta renders
// the live ad from the asset feed, not the story spec's own text fields.
// Previously this file fetched only `asset_feed_spec{bodies{text}}` (just
// enough for classifyAd's Dynamic-Creative-only check below) and then
// discarded it entirely when building the new creative — so an ad that
// had both an object_story_spec (passing as "copyable") AND a real
// asset_feed_spec text pool copied its image/page/link but silently
// dropped all its copy. Fixed by fetching the full asset_feed_spec and
// carrying it through to the new creative (see hasAssetFeedContent,
// rebuildAssetFeedSpec, createCopiedCreative below) — Meta's adcreatives
// endpoint accepts object_story_spec and asset_feed_spec together, which
// is exactly how Ads Manager itself builds these ads.

function isOldInstagramIdError(err) {
  return err?.graphResponse?.error?.code === 12 || /Old Instagram ID is deprecated/i.test(err?.message || "");
}

// Re-fetches one ad for the actual copy step (pages/api/fb/copy-ads/copy.js)
// with a fallback: if the full fields string throws the old-Instagram-id
// error above, retry once without `instagram_user_id` at all and proceed
// without an explicit Instagram actor on the copied creative — Meta
// generally defaults an omitted one to the destination Page's own connected
// Instagram account, so the copy still succeeds, just without necessarily
// preserving a *different* Instagram account the original ad may have used.
// Returns `{ad, instagramOmitted}` so the caller can surface that as a
// visible (non-blocking) note rather than silently dropping it.
export async function fetchAdForCopy(token, adId) {
  try {
    const ad = await graphGet(`/${adId}`, token, { fields: COPY_AD_FIELDS });
    return { ad, instagramOmitted: false };
  } catch (err) {
    if (!isOldInstagramIdError(err)) throw err;
    const ad = await graphGet(`/${adId}`, token, { fields: COPY_AD_FIELDS_NO_INSTAGRAM });
    return { ad, instagramOmitted: true };
  }
}

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
// `metricKeys` (picker-table columns, see lib/insightsMetrics.js's catalog)
// widen this same /insights call's `fields` — `resolveGraphFields` at the
// "ad" level already includes `ad_id`, so no extra Graph call is needed to
// get both ad discovery and the metrics the picker table shows. The raw
// insight row per ad id is returned alongside the ad list so the caller
// (pages/api/fb/copy-ads/source-ads.js) can derive display values via
// lib/insightsMetrics.js's deriveRowMetrics without re-fetching anything.
// `onBatch(batchAds, insightsByAdId)`, if given, fires as soon as each
// 50-id batch below resolves (not only once every batch has) — lets a
// streaming caller (pages/api/fb/copy-ads/source-ads.js) forward ads to the
// client incrementally instead of buffering the whole account before
// sending anything. The function's own return value is unchanged (still the
// full `{ads, insightsByAdId}` once everything settles), so any future
// non-streaming caller keeps working exactly as before.
export async function fetchCopyableAds(token, accountId, { since, until, metricKeys = DEFAULT_COPY_METRIC_KEYS, onBatch }) {
  if (!since || !until) {
    throw new Error("A date range is required to list ads for this account.");
  }
  const insights = await graphGetInsights(`/${accountId}/insights`, token, {
    level: "ad",
    fields: resolveGraphFields(metricKeys, [], "ad").join(","),
    time_range: { since, until },
    limit: 500,
  });
  const insightsByAdId = new Map();
  for (const row of insights.data || []) {
    if (row.ad_id) insightsByAdId.set(row.ad_id, row);
  }
  const adIds = [...insightsByAdId.keys()];
  if (adIds.length === 0) return { ads: [], insightsByAdId };

  const { ads } = await fetchAdsForCopyByIds(token, adIds, {
    errorContext: "this account's ads",
    onBatch: onBatch ? (batchAds) => onBatch(batchAds, insightsByAdId) : undefined,
  });
  return { ads, insightsByAdId };
}

// Extracted from fetchCopyableAds's own batch-fetch internals (same chunked
// `?ids=` batching, `onBatch` streaming, and "don't silently swallow every
// failed batch" error handling — see fetchCopyableAds's own history/comment
// for why that last part matters) so it can be called directly with an
// arbitrary id list, not only ids resolved via /insights. Used by
// fetchAdsInAdsetForCopy below for Copy Ads' ad-set/campaign-level copy,
// where "which ads to copy" is "every ad currently in this ad set," not
// "ads with recent delivery in a date range" — there's no /insights call to
// derive the id list from at all in that case.
export async function fetchAdsForCopyByIds(token, adIds, { onBatch, errorContext = "these ads" } = {}) {
  if (adIds.length === 0) return { ads: [] };
  const batches = chunk(adIds, 50);
  const results = await Promise.allSettled(
    batches.map((batch) =>
      fetchAdsBatchForListing(token, batch).then((result) => {
        if (onBatch) {
          const batchAds = Object.values(result || {}).filter((entry) => entry?.id);
          if (batchAds.length > 0) onBatch(batchAds);
        }
        return result;
      })
    )
  );
  // Defensive filter in case a batch call ever returns an error-shaped
  // entry instead of a real ad object for one id: anything without its own
  // `id` is dropped rather than rendered as a broken, nameless row in the
  // picker.
  const ads = [];
  let failedBatches = 0;
  for (const result of results) {
    if (result.status !== "fulfilled") {
      failedBatches += 1;
      continue;
    }
    for (const entry of Object.values(result.value || {})) {
      if (entry?.id) ads.push(entry);
    }
  }
  // CORRECTION (from this function's original, fetchCopyableAds-inlined
  // form): an earlier version of this loop used plain `Promise.allSettled` +
  // silently `continue`d past every rejected batch with no trace at all —
  // which turned "every batch failed" into an indistinguishable, misleading
  // "No ads found" empty state instead of a real, visible error. That's
  // exactly what happened for real: PR #212's instagram_user_id rename
  // (correct per Meta's own reference — the old field's own deprecation
  // error literally instructs using this one) still broke every batch here,
  // for reasons this couldn't be diagnosed from without seeing the real
  // Graph error text, because it was being thrown away.
  // fetchAdsBatchForListing now retries once without the Instagram field on
  // that same error (mirroring fetchAdForCopy's already-proven fallback),
  // and if every batch still fails even after that, this throws a real error
  // instead of returning an empty array — so the next time something here
  // breaks, it's visible instead of indistinguishable from "there's genuinely
  // nothing here."
  if (ads.length === 0 && failedBatches > 0) {
    throw new Error(`Could not load ${errorContext} (${failedBatches} batch${failedBatches === 1 ? "" : "es"} failed) — see /logs for the underlying Graph error.`);
  }
  return { ads };
}

// Every ad currently in one ad set — the source list for Copy Ads'
// ad-set-level (and, per ad set, campaign-level) cross-account copy.
// Deliberately no date/insights filtering at all, unlike fetchCopyableAds:
// "copy this ad set" means every ad actually in it right now, not just ones
// with recent delivery.
export async function fetchAdsInAdsetForCopy(token, adsetId, { onBatch } = {}) {
  const result = await graphGetAllPages(`/${adsetId}/ads`, token, { fields: "id", limit: 200 });
  const adIds = (result.data || []).map((a) => a.id).filter(Boolean);
  return fetchAdsForCopyByIds(token, adIds, { onBatch, errorContext: "this ad set's ads" });
}

// Same old-Instagram-id fallback as fetchAdForCopy, applied per-batch here:
// if even one id in a batch of up to 50 has an Instagram field that fails
// under the current field name/permission, this retries the WHOLE batch
// without it rather than silently losing every ad in that batch — safer
// than trying to isolate which one id was the problem.
async function fetchAdsBatchForListing(token, ids) {
  try {
    return await graphGet("", token, { ids: ids.join(","), fields: COPY_AD_FIELDS });
  } catch (err) {
    if (!isOldInstagramIdError(err)) throw err;
    return await graphGet("", token, { ids: ids.join(","), fields: COPY_AD_FIELDS_NO_INSTAGRAM });
  }
}

// Three copyable shapes, by `kind`:
//
// - "standard": a normal object_story_spec-based creative (link/video/
//   carousel, with or without Multiple Text Options' asset_feed_spec) —
//   the original, unchanged path.
// - "catalog": a Catalog/Dynamic Product ad (`product_set_id` + a
//   `template_data` spec). There's no per-product creative to clone —
//   Facebook fills the template's macros ({{product.name}}, etc.) in from
//   the product set at serve time — but the product set itself is a
//   Business-level asset, not an ad-account-scoped one. This feature's
//   whole premise is "same Page, different ad account in the same agency
//   setup," so as long as that Business has also shared the catalog with
//   the destination account (the same condition that already has to hold
//   for the Page/Pixel), the *same* product_set_id plus the same template
//   can just be reused directly in the new creative — nothing to copy.
// - "existing_post": no inline object_story_spec at all — an ad built from
//   an *already-existing* Page/Instagram post (Ads Manager's "Use Existing
//   Post," and how every Partnership/branded-content ad in this app works,
//   see lib/partnershipDetection.js's identical field list). Since the post
//   already belongs to the same shared Page, the new creative can just
//   reference it directly via `object_story_id` instead of needing any
//   spec or asset copy. `isBrandedContent` flags the Partnership-ad case
//   specifically, for the picker's own "Partnership ad — from existing
//   post" badge — the paid-partnership label/sponsor tag itself is a
//   property of the referenced *post*, already applied when that post was
//   originally published, so it carries over to the new ad automatically
//   (confirmed against a real copy) with nothing extra to re-declare.
//
// Dynamic Creative ads (asset_feed_spec only, no object_story_spec and no
// existing post to reference) permute many bodies/titles/images/videos at
// once; rebuilding that correctly is a materially bigger surface than any
// of the above and stays explicitly out of scope — shown as unsupported
// rather than silently attempted and failed.
export function classifyAd(ad) {
  const creative = ad.creative || {};
  if (!creative.id) return { copyable: false, reason: "No creative on this ad." };

  if (creative.product_set_id) {
    if (creative.object_story_spec?.template_data) return { copyable: true, reason: null, kind: "catalog" };
    return { copyable: false, reason: "Catalog/Dynamic Product ad — missing its template, can't rebuild." };
  }

  if (creative.object_story_spec) return { copyable: true, reason: null, kind: "standard" };

  if (creative.effective_object_story_id) {
    const isBrandedContent = !!(creative.facebook_branded_content || creative.instagram_branded_content || creative.branded_content);
    return { copyable: true, reason: null, kind: "existing_post", isBrandedContent };
  }

  if (creative.asset_feed_spec) return { copyable: false, reason: "Dynamic Creative ad — not supported yet." };
  return { copyable: false, reason: "Unrecognized creative type." };
}

// Every image_hash an ad's creative references — the top-level link_data
// image, each carousel child_attachment's own image, and (see the
// asset_feed_spec bug note above) any images in the Multiple-Text-Options
// asset feed. De-duplicated since a carousel/asset feed can repeat the same
// image across cards/variants. Takes the whole `creative` object, not just
// object_story_spec, since asset_feed_spec is a sibling field on it.
export function collectImageHashes(creative) {
  const hashes = new Set();
  const spec = creative?.object_story_spec;
  if (spec?.link_data?.image_hash) hashes.add(spec.link_data.image_hash);
  for (const child of spec?.link_data?.child_attachments || []) {
    if (child.image_hash) hashes.add(child.image_hash);
  }
  // A catalog ad's template_data is normally image-free (Meta fills images
  // in per-product from the catalog itself at serve time), but a template
  // can carry its own fallback image_hash/child_attachments — handled the
  // same as link_data's in case one is ever set.
  if (spec?.template_data?.image_hash) hashes.add(spec.template_data.image_hash);
  for (const child of spec?.template_data?.child_attachments || []) {
    if (child.image_hash) hashes.add(child.image_hash);
  }
  for (const img of creative?.asset_feed_spec?.images || []) {
    if (img.hash) hashes.add(img.hash);
  }
  return [...hashes];
}

export function collectVideoIds(creative) {
  const ids = new Set();
  if (creative?.object_story_spec?.video_data?.video_id) {
    ids.add(creative.object_story_spec.video_data.video_id);
  }
  for (const vid of creative?.asset_feed_spec?.videos || []) {
    if (vid.video_id) ids.add(vid.video_id);
  }
  return [...ids];
}

// An ad's asset_feed_spec is considered "real" only if it actually carries
// a text/image/video pool — not just an empty object some creatives come
// back with. Guards createCopiedCreative from sending a pointless empty
// asset_feed_spec on ordinary single-text ads.
export function hasAssetFeedContent(assetFeedSpec) {
  return !!(
    assetFeedSpec &&
    (assetFeedSpec.bodies?.length ||
      assetFeedSpec.titles?.length ||
      assetFeedSpec.descriptions?.length ||
      assetFeedSpec.images?.length ||
      assetFeedSpec.videos?.length)
  );
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
// against Meta's ad-image reference docs. RESOLVED (was flagged as a
// to-verify assumption): unlike every other account id in this app (which
// carries "act_" in URL paths — see the PR #199 double-act_ bug fix in
// lib/partnershipAds.js), `copy_from.source_account_id` specifically wants
// the bare numeric id — confirmed live via a real
// "(#100) Param copy_from[source_account_id] must be a valid ID string"
// error when the "act_"-prefixed form was sent.
export async function copyImageAcrossAccounts(token, destAccountId, { sourceAccountId, hash }) {
  try {
    const json = await graphPost(`/${destAccountId}/adimages`, token, {
      copy_from: { source_account_id: sourceAccountId.replace(/^act_/, ""), hash },
    });
    return extractNewHash(json, hash);
  } catch (err) {
    return copyImageByDownload(token, destAccountId, { sourceAccountId, hash, originalError: err });
  }
}

export async function fetchVideoSourceUrl(token, videoId) {
  const json = await graphGet(`/${videoId}`, token, { fields: "source" });
  if (!json.source) throw new Error("Source video has no downloadable source URL (Meta does not expose the file, e.g. a partner/branded-content or very old video) — re-upload it to the destination account and attach it manually.");
  return json.source;
}

const VIDEO_POLL_INTERVAL_MS = 3000;
const VIDEO_POLL_TIMEOUT_MS = 150000; // many videos process at once on bigger copies; 20s was too short

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

// Coordinates image/video asset copies across one whole copy-ads request so
// that two ads sharing the same source asset — common for an account's own
// variants of one base creative — copy it exactly once, even when those ads
// are processed concurrently (pages/api/fb/copy-ads/copy.js runs several ads
// at once via mapWithConcurrency). A plain `Map<hash, newHash>` checked then
// set by each ad in turn would race: two ads could both see a miss before
// either has finished writing the result, double-copying the same asset.
// Caching the in-flight PROMISE instead of the eventual value fixes that —
// every concurrent caller for the same hash/video id awaits the exact same
// copy. The check-then-set below is safe without a lock because it's all
// synchronous (no `await` between the `has` check and the `set`), so two
// concurrent callers can never interleave between them.
export function createAssetCopyCoordinator(token, destAccountId, sourceAccountId, onCopyStart) {
  const hashJobs = new Map(); // source hash -> Promise<dest hash>
  const videoJobs = new Map(); // source video id -> Promise<dest video id>
  return {
    copyHash(hash, label) {
      if (!hashJobs.has(hash)) {
        onCopyStart?.(`Copying creative image for "${label}"…`);
        hashJobs.set(hash, copyImageAcrossAccounts(token, destAccountId, { sourceAccountId, hash }));
      }
      return hashJobs.get(hash);
    },
    copyVideo(videoId, label) {
      if (!videoJobs.has(videoId)) {
        onCopyStart?.(`Copying creative video for "${label}"…`);
        videoJobs.set(
          videoId,
          fetchVideoSourceUrl(token, videoId).then((sourceUrl) => copyVideoAcrossAccounts(token, destAccountId, { sourceUrl, title: label }))
        );
      }
      return videoJobs.get(videoId);
    },
  };
}

// Deep-clones an object_story_spec, swapping every image_hash / video_id
// reference for its destination-account equivalent via the maps built while
// copying assets. Everything else — page_id, instagram_user_id, link,
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
  if (rebuilt.template_data?.image_hash) {
    rebuilt.template_data.image_hash = hashMap.get(rebuilt.template_data.image_hash) || rebuilt.template_data.image_hash;
  }
  for (const child of rebuilt.template_data?.child_attachments || []) {
    if (child.image_hash) child.image_hash = hashMap.get(child.image_hash) || child.image_hash;
  }
  return rebuilt;
}

// Same image_hash/video_id remapping as rebuildObjectStorySpec, applied to
// an asset_feed_spec's own images[]/videos[] instead. Every text field
// (bodies, titles, descriptions, link_urls, call_to_action_types,
// ad_formats, optimization_type) passes through untouched — only the asset
// references need to point at the destination account's copies.
export function rebuildAssetFeedSpec(assetFeedSpec, hashMap, videoIdMap) {
  if (!assetFeedSpec) return null;
  const rebuilt = JSON.parse(JSON.stringify(assetFeedSpec));
  for (const img of rebuilt.images || []) {
    if (img.hash) img.hash = hashMap.get(img.hash) || img.hash;
  }
  for (const vid of rebuilt.videos || []) {
    if (vid.video_id) vid.video_id = videoIdMap.get(vid.video_id) || vid.video_id;
  }
  // Meta rejects repeated asset values (code 100, subcode 1815629), and two
  // source assets can resolve to one destination asset — keep the first.
  const uniqBy = (arr, keyOf) => {
    const seen = new Set();
    return arr.filter((x) => {
      const k = keyOf(x);
      if (k == null) return true;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  };
  if (rebuilt.images) rebuilt.images = uniqBy(rebuilt.images, (i) => i.hash);
  if (rebuilt.videos) rebuilt.videos = uniqBy(rebuilt.videos, (v) => v.video_id);
  for (const key of ["bodies", "titles", "descriptions"]) {
    if (rebuilt[key]) rebuilt[key] = uniqBy(rebuilt[key], (t) => t.text);
  }
  if (rebuilt.link_urls) rebuilt.link_urls = uniqBy(rebuilt.link_urls, (l) => l.website_url);
  return rebuilt;
}

// assetFeedSpec is optional — only sent when the source ad actually used
// Multiple Text Options (see the bug note near COPY_AD_FIELDS above). Meta's
// adcreatives endpoint accepts object_story_spec and asset_feed_spec
// together; this is how Ads Manager itself builds such ads. `objectStoryId`
// is the "existing_post" classifyAd kind's own creative shape — Meta's
// object_story_spec and object_story_id are mutually exclusive ways to say
// what an ad's creative shows, so objectStoryId (when given) is sent alone,
// no spec at all. `productSetId` is the "catalog" kind's own extra field,
// sent alongside the (still object_story_spec-based, just template_data
// instead of link_data) rebuilt spec.
export async function createCopiedCreative(token, destAccountId, { objectStorySpec, objectStoryId, assetFeedSpec, productSetId } = {}) {
  const payload = objectStoryId ? { object_story_id: objectStoryId } : { object_story_spec: objectStorySpec };
  if (assetFeedSpec) payload.asset_feed_spec = assetFeedSpec;
  if (productSetId) payload.product_set_id = productSetId;
  const json = await graphPost(`/${destAccountId}/adcreatives`, token, payload);
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

// Copies a batch of ads' creative into one destination ad set — extracted
// verbatim from pages/api/fb/copy-ads/copy.js (a pure extraction, no
// behavior change for that route's own ad-level path) so
// pages/api/fb/copy-ads/copy-adset.js and copy-campaign.js can run the exact
// same per-ad copy loop against an ad set they just created, not only one
// that already existed. See copy.js's own top-of-file comment for the full
// design reasoning this loop embodies (concurrency, PAUSED-first safety,
// per-kind classify branching).
//
// `assets` is an already-constructed createAssetCopyCoordinator, shared by
// the CALLER across as much of its own request as should dedupe copies —
// within one ad set's own items for copy.js/copy-adset.js, or across every
// ad set under one copied campaign for copy-campaign.js, so an asset reused
// across two ad sets is still only ever copied once. `onProgress`/`onAdStart`/
// `onAdDone` are the caller's own NDJSON-writing callbacks (all optional, so
// this can be called without a live response stream, e.g. from a test).
export async function copyAdsIntoAdset(token, { destAccountId, destAdsetId, items, assets, concurrency = COPY_CONCURRENCY, onProgress, onAdStart, onAdDone }) {
  const createdAdIds = [];
  let overallSuccess = true;

  const stepsByItem = await mapWithConcurrency(items, concurrency, async (item, i) => {
    const { adId, name: customName } = item;
    onProgress?.(`Copying ad ${i + 1} of ${items.length}…`);
    onAdStart?.(adId);

    // Re-fetched fresh rather than trusted from the client's earlier picker
    // load — the creative can change between browsing and confirming, same
    // reasoning as partnership/launch.js's own re-verification step.
    let ad;
    let instagramOmitted = false;
    try {
      ({ ad, instagramOmitted } = await fetchAdForCopy(token, adId));
    } catch (err) {
      overallSuccess = false;
      const error = `Could not re-fetch ad: ${err.message}`;
      onAdDone?.(adId, { success: false, error });
      return [{ type: "ad", label: "Ad", name: customName || adId, adId, success: false, error }];
    }

    const { copyable, reason, kind } = classifyAd(ad);
    if (!copyable) {
      overallSuccess = false;
      onAdDone?.(adId, { success: false, skipped: true, error: reason });
      return [{ type: "ad", label: "Ad", name: ad.name || adId, adId, success: false, skipped: true, error: reason }];
    }

    const spec = ad.creative.object_story_spec;
    const assetFeedSpec = ad.creative.asset_feed_spec;
    const hasAssetFeed = hasAssetFeedContent(assetFeedSpec);
    try {
      const hashEntries = await Promise.all(
        collectImageHashes(ad.creative).map(async (hash) => [hash, await assets.copyHash(hash, ad.name)])
      );
      const videoEntries = await Promise.all(
        collectVideoIds(ad.creative).map(async (videoId) => [videoId, await assets.copyVideo(videoId, ad.name)])
      );
      const hashMap = new Map(hashEntries);
      const videoIdMap = new Map(videoEntries);

      const rebuiltSpec = kind === "existing_post" ? null : rebuildObjectStorySpec(spec, hashMap, videoIdMap);
      const rebuiltFeed = hasAssetFeed && kind !== "existing_post" ? rebuildAssetFeedSpec(assetFeedSpec, hashMap, videoIdMap) : null;
      const makeCreative = (feed) =>
        kind === "existing_post"
          ? createCopiedCreative(token, destAccountId, { objectStoryId: ad.creative.effective_object_story_id })
          : createCopiedCreative(token, destAccountId, {
              objectStorySpec: rebuiltSpec,
              assetFeedSpec: feed,
              productSetId: kind === "catalog" ? ad.creative.product_set_id : null,
            });
      let creativeId;
      try {
        creativeId = await makeCreative(rebuiltFeed);
      } catch (err) {
        // Still "duplicate asset values" after de-duping the feed: the feed's
        // image/video pool repeats the asset the story spec already carries.
        // Retry once with the pool's media dropped (text options stay).
        if (err.subcode !== 1815629 && !/Duplicates of ad asset values/.test(err.message || "")) throw err;
        if (!rebuiltFeed || (!rebuiltFeed.images && !rebuiltFeed.videos)) throw err;
        const { images, videos, ...textOnly } = rebuiltFeed;
        creativeId = await makeCreative(hasAssetFeedContent(textOnly) ? textOnly : null);
      }

      const newAdId = await createCopiedAd(token, destAccountId, {
        name: (customName && customName.trim()) || `${ad.name} - Copy`,
        adsetId: destAdsetId,
        creativeId,
      });
      createdAdIds.push(newAdId);
      const warning = instagramOmitted
        ? "Copied without its Instagram account (old-format ID) — will use the destination Page's default."
        : null;
      onAdDone?.(adId, { success: true, newAdId, creativeId, warning });
      return [
        { type: "creative", label: "Creative", name: ad.name, adId, success: true, id: creativeId },
        { type: "ad", label: "Ad", name: ad.name, adId, success: true, id: newAdId, warning },
      ];
    } catch (err) {
      overallSuccess = false;
      onAdDone?.(adId, { success: false, error: err.message });
      return [{ type: "ad", label: "Ad", name: ad.name || adId, adId, success: false, error: err.message }];
    }
  });

  return { createdAdIds, steps: stepsByItem.flat(), overallSuccess };
}

// Creates N ad sets under one already-resolved destination campaign id, then
// copies each one's own selected ads into it — the shared "several ad sets,
// one campaign" loop extracted from pages/api/fb/copy-ads/copy-campaign.js so
// pages/api/fb/copy-ads/copy-adset.js's own multi-select case (several source
// ad sets landing in one EXISTING campaign, never a new one — see that
// route's own comment) can reuse the exact same mechanics instead of a
// second, easily-divergent copy of this logic. (This is exactly how the
// ABO-budget-amount bug in an earlier version of copy-campaign.js got fixed
// once and not the second time around.)
//
// One asset-copy coordinator shared across every ad set in `adsets` — not
// per ad set — so a creative asset reused across two of them (a common case:
// several ad sets testing different audiences against the same base
// creative, or several hand-picked ad sets that happen to share one) is
// still only ever copied once. Partial-failure semantics match every other
// creation flow in this app: one ad set failing to create doesn't abort the
// rest (mapWithConcurrency keeps going), but the caller decides what to do
// about overall activation based on the returned `overallSuccess`.
export async function copyAdsetsIntoCampaign(
  token,
  {
    destAccountId,
    sourceAccountId,
    campaignId,
    adsets,
    campaignBidStrategy,
    budgetStrategy,
    budgetType,
    budgetAmountMinorUnits,
    concurrency = ADSET_CONCURRENCY,
    adConcurrency = COPY_CONCURRENCY,
    onProgress,
    onAdsetStart,
    onAdsetDone,
    onAdStart,
    onAdDone,
  }
) {
  const assets = createAssetCopyCoordinator(token, destAccountId, sourceAccountId, onProgress);

  const createdAdsetIds = [];
  const allCreatedAdIds = [];
  const allSteps = [];
  let overallSuccess = true;

  const adsetResults = await mapWithConcurrency(adsets, concurrency, async (entry, i) => {
    const { sourceAdsetId, adsetFields, items } = entry;
    onProgress?.(`Creating ad set ${i + 1} of ${adsets.length}: ${adsetFields.name}…`);

    // Budget STRATEGY is shared by every ad set under the campaign (it has
    // to match the campaign's own CBO/ABO shape) but the AMOUNT is not:
    // under ABO, each source ad set can carry its own distinct budget, so
    // the amount has to come from THIS ad set's own adsetFields (already
    // resolved to the source's real value by adsets-list.js's toFormFields),
    // not the one shared campaign-level amount, which only ever applies to a
    // CBO campaign's own budget (a single, genuinely shared number) and is
    // irrelevant here otherwise.
    const ownBudget = parseFloat(adsetFields.budgetAmount);
    const adsetBudgetAmountMinorUnits = budgetStrategy === "ABO" && ownBudget > 0 ? toMinorUnits(ownBudget) : budgetAmountMinorUnits;
    const adsetPayload = buildGenericAdsetPayload({
      ...adsetFields,
      campaignId,
      // When a new campaign was just created to match a real source
      // (copy-campaign.js, or copy-adset.js's own new_campaign mode),
      // `campaignBidStrategy` is given and every ad set matches it — Meta
      // expects this consistent, especially under CBO. When ad sets are
      // instead landing in an EXISTING campaign this function never created
      // (copy-adset.js's existing_campaign mode, including its multi-select
      // case), there's no campaign-level choice to enforce, so each ad set
      // keeps its own real bid strategy instead of being silently
      // homogenized to buildGenericAdsetPayload's generic default.
      // ABO: the campaign has no bid strategy of its own, so each ad set keeps its own.
      bidStrategy: budgetStrategy === "CBO" ? campaignBidStrategy || adsetFields.bidStrategy : adsetFields.bidStrategy,
      budgetStrategy,
      budgetType,
      budgetAmountMinorUnits: adsetBudgetAmountMinorUnits,
    });
    onAdsetStart?.(sourceAdsetId, adsetPayload.name);
    let adsetId;
    let adsetWarning = null;
    try {
      let json;
      try {
        json = await graphPost(`/${destAccountId}/adsets`, token, adsetPayload);
      } catch (firstErr) {
        // Custom/lookalike audiences from the source account are often not shared
        // with the destination account (code 100, subcode 1359207). Rather than
        // lose the whole ad set (and its ads), create it without those audiences
        // and say so — it is created paused, so targeting can be fixed before it runs.
        const hasAudiences = adsetPayload.targeting?.custom_audiences?.length > 0;
        if (!hasAudiences || !/Custom audience not available|subcode 1359207/.test(firstErr.message || "")) throw firstErr;
        const { custom_audiences, ...targetingWithout } = adsetPayload.targeting;
        json = await graphPost(`/${destAccountId}/adsets`, token, { ...adsetPayload, targeting: targetingWithout });
        adsetWarning = `Created WITHOUT its custom/lookalike audience${custom_audiences.length === 1 ? "" : "s"} (not available in the destination account) — add targeting before activating.`;
      }
      adsetId = json.id;
      onAdsetDone?.(sourceAdsetId, { success: true, id: adsetId, warning: adsetWarning });
    } catch (err) {
      onAdsetDone?.(sourceAdsetId, { success: false, error: err.message });
      return {
        adsetStep: { type: "adset", label: "Ad set", name: adsetPayload.name, sourceAdsetId, success: false, error: err.message },
        adSteps: [],
        createdAdIds: [],
        success: false,
      };
    }

    const {
      createdAdIds,
      steps: adSteps,
      overallSuccess: adsSucceeded,
    } = await copyAdsIntoAdset(token, {
      destAccountId,
      destAdsetId: adsetId,
      items,
      assets,
      concurrency: adConcurrency,
      onProgress,
      onAdStart,
      onAdDone: (adId, result) => onAdDone?.(adId, { ...result, sourceAdsetId }),
    });

    return {
      adsetStep: { type: "adset", label: "Ad set", name: adsetPayload.name, sourceAdsetId, success: true, id: adsetId, warning: adsetWarning },
      adSteps: adSteps.map((s) => ({ ...s, sourceAdsetId })),
      createdAdIds,
      success: adsSucceeded,
    };
  });

  for (const r of adsetResults) {
    allSteps.push(r.adsetStep);
    allSteps.push(...r.adSteps);
    if (r.adsetStep.id) createdAdsetIds.push(r.adsetStep.id);
    allCreatedAdIds.push(...r.createdAdIds);
    if (!r.success) overallSuccess = false;
  }

  return { createdAdsetIds, createdAdIds: allCreatedAdIds, steps: allSteps, overallSuccess };
}
