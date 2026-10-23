import { getServerSession } from "next-auth/next";
import { authOptions } from "../../auth/[...nextauth]";
import { graphPost } from "@/lib/facebookGraph";
import { createAssetCopyCoordinator, copyAdsIntoAdset, COPY_CONCURRENCY } from "@/lib/adCopy";

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

  // Shared across the whole batch so two concurrently-processed ads that
  // reference the same source image/video copy it exactly once (see
  // lib/adCopy.js's createAssetCopyCoordinator for why this is safe under
  // concurrency, unlike a plain Map checked-then-set per ad).
  const assets = createAssetCopyCoordinator(token, destAccountId, sourceAccountId, progress);

  // The actual per-ad copy loop lives in lib/adCopy.js's copyAdsIntoAdset now
  // — shared with pages/api/fb/copy-ads/copy-adset.js and copy-campaign.js,
  // which run the exact same loop against an ad set they just created rather
  // than one that already existed. This route's own NDJSON writer functions
  // (adStart/adDone/progress, defined above) are passed straight through as
  // its callbacks.
  const { createdAdIds, steps, overallSuccess: adsSucceeded } = await copyAdsIntoAdset(token, {
    destAccountId,
    destAdsetId,
    items,
    assets,
    concurrency: COPY_CONCURRENCY,
    onProgress: progress,
    onAdStart: adStart,
    onAdDone: adDone,
  });
  let overallSuccess = adsSucceeded;

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
