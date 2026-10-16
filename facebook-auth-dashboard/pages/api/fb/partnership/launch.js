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
// Sourcing: every creative is built via the ad_code path
// (branded_content.instagram_boost_post_access_token) rather than
// source_instagram_media_id — ad_code is present on every item this app's
// own Content Discovery calls already request (see lib/partnershipAds.js's
// CONTENT_FIELDS), so it's always available and is the path the reference
// implementation treats as preferred when present. The video-registration
// step (registerVideoSource) still runs first for video content when a
// resolvable media id is available from the re-verification lookup below —
// **this one specific step (whether it's actually required on the ad_code
// path, vs. only ever needed for the alternate source_instagram_media_id
// path) is not clearly established by the reference material and needs
// live verification**; it's attempted best-effort and never blocks the
// creative/ad creation that follows even if it's skipped or fails.
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

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
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
      steps.push({ type: "item", name: item.name, success: false, error: err.message });
      continue;
    }

    if (item.mediaType === "VIDEO" && verified.source_instagram_media_id) {
      try {
        await registerVideoSource(token, accountId, { sourceInstagramMediaId: verified.source_instagram_media_id, adCode: item.adCode });
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
        testimonial: item.primaryText || undefined,
      });
      creativeId = creative.id;
      steps.push({ type: "creative", name: item.name, success: true, id: creativeId });
    } catch (err) {
      overallSuccess = false;
      steps.push({ type: "creative", name: item.name, success: false, error: err.message });
      continue;
    }

    for (let j = 0; j < adsetIds.length; j++) {
      const adsetId = adsetIds[j];
      progress(`Creating ad ${j + 1} of ${adsetIds.length} for "${item.name}"…`);
      try {
        const ad = await createAd(token, accountId, { name: item.name, adsetId, creativeId });
        allCreatedAdIds.push(ad.id);
        steps.push({ type: "ad", name: item.name, adsetId, success: true, id: ad.id });
      } catch (err) {
        overallSuccess = false;
        steps.push({ type: "ad", name: item.name, adsetId, success: false, error: err.message });
      }
    }
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

  finish({ success: overallSuccess, createdAdIds: allCreatedAdIds, steps });
}
