import { getServerSession } from "next-auth/next";
import { authOptions } from "../../auth/[...nextauth]";
import { graphPost } from "@/lib/facebookGraph";
import { lookupContent, registerVideoSource, createBrandedCreative, createAd } from "@/lib/partnershipAds";

// Creates real Ads from the launch queue — the first endpoint in this app
// that creates an Ad/AdCreative (every prior launch flow here stops at the
// ad set). Same non-negotiable safety pattern as pages/api/fb/launch-campaign.js:
// everything is created PAUSED first regardless of the requested final
// status, only flipped to ACTIVE in a last step and only if every create
// succeeded. Streams newline-delimited JSON for live progress, same reason.
//
// Cardinality: every queued item is launched into every selected ad set
// (N items × M ad sets = N×M ads created) — confirmed with the user rather
// than assumed, since the mockup this was built from never actually shows
// what happens with a multi-select ad set + multi-item queue. One creative
// is created per item (not per item×adset — a creative is a standalone,
// reusable object, the same way pages/api/fb/launch-campaign.js's own
// "duplicate an ad set's ads" path reuses an existing creative by id rather
// than recreating it per ad), referenced by every ad built from that item.
//
// Sourcing: `ad_code` is preferred when the queued item has one (true
// branded-content partnership posts always do), but it's genuinely optional
// — a brand's own post surfaced by Content Discovery carries partnership_info
// with no ad_code at all, and createBrandedCreative only throws if BOTH
// adCode and sourceInstagramMediaId are missing. The fallback id is the
// re-verification lookup's own `content_id` field — confirmed against the
// reference implementation (Facebook Curls/partnership_ads_booster.py's
// `fetch_branded_content_advertisable_medias` maps its Content Discovery
// response's `content_id` straight into what it calls `source_instagram_
// media_id` everywhere downstream; Graph's Content Discovery API has no field
// literally named that). Previously this file read a nonexistent
// `verified.source_instagram_media_id` for both the video-registration step
// and the creative call, which was always undefined — silently skipping
// video registration for every single video and leaving ad_code-less items
// (like a brand's own post) with neither id available at creative-creation
// time, surfacing as "createBrandedCreative needs adCode or
// sourceInstagramMediaId" on a real launch attempt.
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session?.accessToken) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  const { accountId, businessId, igUserId, facebookPageId, items, adsetIds, finalStatus: rawFinalStatus } = req.body || {};
  if (!accountId || !businessId || !igUserId || !facebookPageId) {
    return res.status(400).json({ error: "accountId, businessId, igUserId, and facebookPageId are required" });
  }
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "items must be a non-empty array" });
  }
  if (!Array.isArray(adsetIds) || adsetIds.length === 0) {
    return res.status(400).json({ error: "adsetIds must be a non-empty array" });
  }
  const finalStatus = rawFinalStatus === "ACTIVE" ? "ACTIVE" : "PAUSED";

  res.writeHead(200, { "Content-Type": "application/x-ndjson", "Cache-Control": "no-cache" });
  function progress(message) {
    res.write(`${JSON.stringify({ type: "progress", message })}\n`);
  }
  function finish(body) {
    res.write(`${JSON.stringify({ type: "done", ...body })}\n`);
    res.end();
  }

  const token = session.accessToken;
  const steps = [];
  let overallSuccess = true;
  const allCreatedAdIds = [];
  // Which queue items actually produced at least one live ad — used by the
  // client (pages/partnership-ads/queue.js) to remove only the items that
  // truly launched when a batch finishes with some failures, instead of the
  // previous all-or-nothing gate that left even a fully-succeeded item sitting
  // in the queue just because a different item in the same batch failed.
  const succeededItemIds = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    let itemSucceeded = true;
    progress(`Verifying "${item.name}" (${i + 1} of ${items.length})…`);

    let verified;
    try {
      const lookups = await lookupContent(token, businessId, {
        igUserId,
        adCodes: item.adCode ? [item.adCode] : undefined,
        permalinks: !item.adCode && item.permalink ? [item.permalink] : undefined,
      });
      verified = lookups[0];
      if (!verified) throw new Error("Content is no longer available or eligible — it may have been removed or had its permission revoked.");
    } catch (err) {
      overallSuccess = false;
      steps.push({ type: "item", itemId: item.id, name: item.name, success: false, error: err.message });
      continue;
    }

    // See this file's header comment — `content_id` doubles as the
    // Instagram media id both the video-registration and creative-creation
    // calls need as a fallback when the item has no ad_code.
    const sourceInstagramMediaId = verified.content_id;

    if (item.mediaType === "VIDEO" && sourceInstagramMediaId) {
      try {
        await registerVideoSource(token, accountId, { sourceInstagramMediaId, adCode: item.adCode });
      } catch {
        // Best-effort — see this file's own header comment on why this step's
        // necessity on the ad_code path isn't fully confirmed; a real failure
        // here surfaces soon enough anyway, via the creative-creation call
        // right below, if it turns out to actually be required.
      }
    }

    progress(`Creating ad creative for "${item.name}"…`);
    let creativeId;
    try {
      const creative = await createBrandedCreative(token, accountId, {
        objectId: facebookPageId,
        facebookPageId,
        igUserId,
        callToActionType: item.cta,
        link: item.redirectionLink,
        adCode: item.adCode,
        sourceInstagramMediaId,
        testimonial: item.primaryText || undefined,
      });
      creativeId = creative.id;
      steps.push({ type: "creative", itemId: item.id, name: item.name, success: true, id: creativeId });
    } catch (err) {
      overallSuccess = false;
      steps.push({ type: "creative", itemId: item.id, name: item.name, success: false, error: err.message });
      continue;
    }

    for (let j = 0; j < adsetIds.length; j++) {
      const adsetId = adsetIds[j];
      progress(`Creating ad ${j + 1} of ${adsetIds.length} for "${item.name}"…`);
      try {
        const ad = await createAd(token, accountId, { name: item.name, adsetId, creativeId });
        allCreatedAdIds.push(ad.id);
        steps.push({ type: "ad", itemId: item.id, name: item.name, adsetId, success: true, id: ad.id });
      } catch (err) {
        overallSuccess = false;
        itemSucceeded = false;
        steps.push({ type: "ad", itemId: item.id, name: item.name, adsetId, success: false, error: err.message });
      }
    }

    if (itemSucceeded) succeededItemIds.push(item.id);
  }

  if (finalStatus === "ACTIVE" && overallSuccess && allCreatedAdIds.length > 0) {
    progress("Activating…");
    try {
      await Promise.all(allCreatedAdIds.map((id) => graphPost(`/${id}`, token, { status: "ACTIVE" })));
      steps.push({ type: "activation", success: true });
    } catch (err) {
      overallSuccess = false;
      steps.push({
        type: "activation",
        success: false,
        error: `Created successfully but failed to activate: ${err.message}. Everything is sitting paused in Ads Manager — activate it manually when ready.`,
      });
    }
  }

  finish({ success: overallSuccess, createdAdIds: allCreatedAdIds, succeededItemIds, steps });
}
