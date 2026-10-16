import { getServerSession } from "next-auth/next";
import { authOptions } from "../../auth/[...nextauth]";
import { graphGet, graphPost } from "@/lib/facebookGraph";
import {
  COPY_AD_FIELDS,
  classifyAd,
  collectImageHashes,
  collectVideoIds,
  copyImageAcrossAccounts,
  copyVideoAcrossAccounts,
  fetchVideoSourceUrl,
  rebuildObjectStorySpec,
  createCopiedCreative,
  createCopiedAd,
} from "@/lib/adCopy";

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
// variants of one base creative) — hashMap/videoIdMap are shared across the
// whole loop, not reset per ad.
//
// Same two-phase safety pattern as every other launch flow in this app
// (launch-campaign.js, partnership/launch.js): every created ad is PAUSED
// first, only flipped to ACTIVE in one final step, and only if every ad in
// the batch copied successfully.
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
  function finish(body) {
    res.write(`${JSON.stringify({ type: "done", ...body })}\n`);
    res.end();
  }

  const steps = [];
  const createdAdIds = [];
  let overallSuccess = true;
  const hashMap = new Map(); // source image_hash -> dest image_hash
  const videoIdMap = new Map(); // source video_id -> dest video_id

  for (let i = 0; i < items.length; i++) {
    const { adId, name: customName } = items[i];
    progress(`Copying ad ${i + 1} of ${items.length}…`);

    // Re-fetched fresh rather than trusted from the client's earlier
    // picker load — the creative can change between browsing and
    // confirming, same reasoning as partnership/launch.js's own
    // re-verification step.
    let ad;
    try {
      ad = await graphGet(`/${adId}`, token, { fields: COPY_AD_FIELDS });
    } catch (err) {
      overallSuccess = false;
      steps.push({ type: "ad", label: "Ad", name: customName || adId, success: false, error: `Could not re-fetch ad: ${err.message}` });
      continue;
    }

    const { copyable, reason } = classifyAd(ad);
    if (!copyable) {
      overallSuccess = false;
      steps.push({ type: "ad", label: "Ad", name: ad.name || adId, success: false, skipped: true, error: reason });
      continue;
    }

    const spec = ad.creative.object_story_spec;
    try {
      for (const hash of collectImageHashes(spec)) {
        if (!hashMap.has(hash)) {
          progress(`Copying creative image for "${ad.name}"…`);
          const newHash = await copyImageAcrossAccounts(token, destAccountId, { sourceAccountId, hash });
          hashMap.set(hash, newHash);
        }
      }
      for (const videoId of collectVideoIds(spec)) {
        if (!videoIdMap.has(videoId)) {
          progress(`Copying creative video for "${ad.name}"…`);
          const sourceUrl = await fetchVideoSourceUrl(token, videoId);
          const newVideoId = await copyVideoAcrossAccounts(token, destAccountId, { sourceUrl, title: ad.name });
          videoIdMap.set(videoId, newVideoId);
        }
      }

      const rebuiltSpec = rebuildObjectStorySpec(spec, hashMap, videoIdMap);
      const creativeId = await createCopiedCreative(token, destAccountId, rebuiltSpec);
      steps.push({ type: "creative", label: "Creative", name: ad.name, success: true, id: creativeId });

      const newAdId = await createCopiedAd(token, destAccountId, {
        name: (customName && customName.trim()) || `${ad.name} - Copy`,
        adsetId: destAdsetId,
        creativeId,
      });
      createdAdIds.push(newAdId);
      steps.push({ type: "ad", label: "Ad", name: ad.name, success: true, id: newAdId });
    } catch (err) {
      overallSuccess = false;
      steps.push({ type: "ad", label: "Ad", name: ad.name || adId, success: false, error: err.message });
    }
  }

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
