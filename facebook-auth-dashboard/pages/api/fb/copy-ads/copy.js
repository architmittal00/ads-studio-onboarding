import { getServerSession } from "next-auth/next";
import { authOptions } from "../../auth/[...nextauth]";
import { graphPost } from "@/lib/facebookGraph";
import {
  fetchAdForCopy,
  classifyAd,
  collectImageHashes,
  collectVideoIds,
  hasAssetFeedContent,
  createAssetCopyCoordinator,
  rebuildObjectStorySpec,
  rebuildAssetFeedSpec,
  createCopiedCreative,
  createCopiedAd,
} from "@/lib/adCopy";
import { mapWithConcurrency } from "@/lib/metaInterestSearch";

// How many ads this route copies at once. Each ad is itself several
// sequential Graph calls (re-fetch, asset copy/video poll, creative create,
// ad create) — ads used to be copied fully one at a time, so an N-ad batch
// took roughly N times one ad's own (already multi-call) latency. A modest
// concurrency cap — rather than firing every ad at once — trades some of
// that latency back without flooding Meta's per-app/per-user rate limiting
// (X-App-Usage/X-Business-Use-Case-Usage headers) on a route that already
// issues several write calls per item; same reasoning and the same
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
const COPY_CONCURRENCY = 5;

// Clones a batch of ads from one ad account's creative into an existing ad
// set in a different ad account — the first place this app builds a
// standard (object_story_spec) creative from raw assets instead of reusing
// an existing creative_id, because a creative_id can't be referenced across
// ad accounts (see pages/api/fb/duplicate-ad.js's own comment on why it
// deliberately avoids this even for its same-account case). Page and
// Instagram actor pass through unchanged — this feature's own premise is
// that the Page is identical across the two accounts.
//
// Image/video assets are copied at most once per request even when several
// selected ads share the same creative asset (common for an account's own
// variants of one base creative) — lib/adCopy.js's createAssetCopyCoordinator
// is shared across the whole batch and de-dupes by caching the in-flight
// copy *promise*, not just the eventual result, which is what makes this
// safe now that ads are copied concurrently rather than one at a time.
//
// Same two-phase safety pattern as every other launch flow in this app
// (launch-campaign.js, partnership/launch.js): every created ad is PAUSED
// first, only flipped to ACTIVE in one final step, and only if every ad in
// the batch copied successfully.
//
// Not every ad goes through the "build a creative from raw assets" path
// above — see lib/adCopy.js's classifyAd for the other two copyable kinds:
// "catalog" (Catalog/Dynamic Product ads, reuses the same product_set_id +
// template instead of any per-product asset) and "existing_post" (ads with
// no inline object_story_spec at all — including every Partnership/
// branded-content ad — reuses the exact same existing post via
// object_story_id instead of a spec or asset copy).
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session?.accessToken) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  const { sourceAccountId, destAccountId, destAdsetId, items, finalStatus: rawFinalStatus } = req.body || {};
  if (!sourceAccountId || !destAccountId || !destAdsetId || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "sourceAccountId, destAccountId, destAdsetId, and a non-empty items array are required" });
  }
  if (sourceAccountId === destAccountId) {
    return res.status(400).json({ error: "Source and destination ad accounts must be different." });
  }

  const token = session.accessToken;
  const finalStatus = rawFinalStatus === "ACTIVE" ? "ACTIVE" : "PAUSED";

  res.writeHead(200, { "Content-Type": "application/x-ndjson", "Cache-Control": "no-cache" });
  function progress(message) {
    res.write(`${JSON.stringify({ type: "progress", message })}\n`);
  }
  // Per-ad lifecycle events, in addition to `progress` above — added once
  // ads started copying concurrently (COPY_CONCURRENCY): the single rolling
  // `progress` message is now written by up to 5 ads interleaved at once
  // ("Copying ad 2 of 6…" can print after "ad 4 of 6…"), which stopped being
  // a meaningful way to show per-ad status. These let the client track each
  // selected ad's own state by id instead of parsing an out-of-order log
  // line. `res.write` from concurrent callbacks is safe here — each call
  // writes one complete, self-contained line.
  function adStart(adId) {
    res.write(`${JSON.stringify({ type: "ad_start", adId })}\n`);
  }
  function adDone(adId, result) {
    res.write(`${JSON.stringify({ type: "ad_done", adId, ...result })}\n`);
  }
  function finish(body) {
    res.write(`${JSON.stringify({ type: "done", ...body })}\n`);
    res.end();
  }

  const createdAdIds = [];
  let overallSuccess = true;
  // Shared across the whole batch so two concurrently-processed ads that
  // reference the same source image/video copy it exactly once (see
  // lib/adCopy.js's createAssetCopyCoordinator for why this is safe under
  // concurrency, unlike a plain Map checked-then-set per ad).
  const assets = createAssetCopyCoordinator(token, destAccountId, sourceAccountId, progress);

  // One entry per item, each itself an array of 1-2 step objects. Filled in
  // by mapWithConcurrency at each item's own index (not pushed in completion
  // order), then flattened below — so the result list always reads in the
  // user's own selection order regardless of which ad actually finished
  // copying first.
  const stepsByItem = await mapWithConcurrency(items, COPY_CONCURRENCY, async (item, i) => {
    const { adId, name: customName } = item;
    progress(`Copying ad ${i + 1} of ${items.length}…`);
    adStart(adId);

    // Re-fetched fresh rather than trusted from the client's earlier
    // picker load — the creative can change between browsing and
    // confirming, same reasoning as partnership/launch.js's own
    // re-verification step. fetchAdForCopy itself falls back to dropping
    // the Instagram field on Meta's "(#12) Old Instagram ID is deprecated"
    // error (a real one hit in production) — see lib/adCopy.js for why.
    let ad;
    let instagramOmitted = false;
    try {
      ({ ad, instagramOmitted } = await fetchAdForCopy(token, adId));
    } catch (err) {
      overallSuccess = false;
      const error = `Could not re-fetch ad: ${err.message}`;
      adDone(adId, { success: false, error });
      return [{ type: "ad", label: "Ad", name: customName || adId, adId, success: false, error }];
    }

    const { copyable, reason, kind, isBrandedContent } = classifyAd(ad);
    if (!copyable) {
      overallSuccess = false;
      adDone(adId, { success: false, skipped: true, error: reason });
      return [{ type: "ad", label: "Ad", name: ad.name || adId, adId, success: false, skipped: true, error: reason }];
    }

    const spec = ad.creative.object_story_spec;
    // Carry the asset_feed_spec through too when the source ad has one with
    // real content — see lib/adCopy.js's bug note near COPY_AD_FIELDS: an
    // ad built with Meta's Multiple Text Options stores its actual Primary
    // Text/Headline/Description there, not in object_story_spec.link_data,
    // so skipping it is exactly what shipped the "copied ad looks right but
    // all its copy is blank" bug on the first real-account run.
    const assetFeedSpec = ad.creative.asset_feed_spec;
    const hasAssetFeed = hasAssetFeedContent(assetFeedSpec);
    try {
      // Both empty for "existing_post" (no object_story_spec to look at) and
      // normally empty for "catalog" (a template's images come from the
      // product set, not an image_hash on this ad's own creative) — real
      // asset copying only actually happens for "standard" ads and the rare
      // catalog template that does set its own fallback image.
      const hashEntries = await Promise.all(
        collectImageHashes(ad.creative).map(async (hash) => [hash, await assets.copyHash(hash, ad.name)])
      );
      const videoEntries = await Promise.all(
        collectVideoIds(ad.creative).map(async (videoId) => [videoId, await assets.copyVideo(videoId, ad.name)])
      );
      const hashMap = new Map(hashEntries);
      const videoIdMap = new Map(videoEntries);

      // "existing_post" has no object_story_spec at all — Meta's
      // object_story_id and object_story_spec are mutually exclusive, so the
      // new creative just points at the exact same already-existing post
      // instead. "catalog" keeps the normal rebuilt-spec path (its
      // template_data is a sibling of link_data/video_data) plus the same
      // product_set_id, which is a Business-level asset the destination
      // account already needs access to anyway (see classifyAd's comment).
      const creativeId =
        kind === "existing_post"
          ? await createCopiedCreative(token, destAccountId, { objectStoryId: ad.creative.effective_object_story_id })
          : await createCopiedCreative(token, destAccountId, {
              objectStorySpec: rebuildObjectStorySpec(spec, hashMap, videoIdMap),
              assetFeedSpec: hasAssetFeed ? rebuildAssetFeedSpec(assetFeedSpec, hashMap, videoIdMap) : null,
              productSetId: kind === "catalog" ? ad.creative.product_set_id : null,
            });

      const newAdId = await createCopiedAd(token, destAccountId, {
        name: (customName && customName.trim()) || `${ad.name} - Copy`,
        adsetId: destAdsetId,
        creativeId,
      });
      createdAdIds.push(newAdId);
      // Non-blocking warnings — the ad was still created successfully.
      // instagramOmitted: no explicit Instagram actor, so it'll default to
      // the destination Page's own connected Instagram account rather than
      // necessarily matching whichever one the source ad used. Partnership
      // ads reference the original post directly (see classifyAd) rather
      // than re-declaring sponsor permissions this feature isn't
      // re-requesting, so the paid-partnership label/sponsor tag may not
      // carry over to the new ad the way it does on the original.
      const warning = instagramOmitted
        ? "Copied without its Instagram account (old-format ID) — will use the destination Page's default."
        : kind === "existing_post" && isBrandedContent
          ? "Copied by referencing the original post — this was a Partnership (branded content) ad, and its paid-partnership label/sponsor tag may not carry over to the new ad."
          : null;
      adDone(adId, { success: true, newAdId, creativeId, warning });
      return [
        { type: "creative", label: "Creative", name: ad.name, adId, success: true, id: creativeId },
        { type: "ad", label: "Ad", name: ad.name, adId, success: true, id: newAdId, warning },
      ];
    } catch (err) {
      overallSuccess = false;
      adDone(adId, { success: false, error: err.message });
      return [{ type: "ad", label: "Ad", name: ad.name || adId, adId, success: false, error: err.message }];
    }
  });

  const steps = stepsByItem.flat();

  if (finalStatus === "ACTIVE" && overallSuccess && createdAdIds.length > 0) {
    progress("Activating…");
    try {
      await Promise.all(createdAdIds.map((id) => graphPost(`/${id}`, token, { status: "ACTIVE" })));
      steps.push({ type: "activation", label: "Activated", success: true });
    } catch (err) {
      overallSuccess = false;
      steps.push({
        type: "activation",
        label: "Activation",
        success: false,
        error: `Ads created successfully but failed to activate: ${err.message}. Everything is sitting paused in Ads Manager — activate manually when ready.`,
      });
    }
  }

  finish({ success: overallSuccess, createdAdIds, steps });
}
