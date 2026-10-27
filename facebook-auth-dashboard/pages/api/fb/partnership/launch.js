import { getServerSession } from "next-auth/next";
import { authOptions } from "../../auth/[...nextauth]";
import { graphPost } from "@/lib/facebookGraph";
import { lookupContent, registerVideoSource, createBrandedCreative, createAd } from "@/lib/partnershipAds";
import { firstPartnershipInfo } from "@/lib/partnershipContent";

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
//
// `ad_code` itself is re-read from the re-verification lookup each time
// (see the `firstPartnershipInfo(verified).ad_code` line below), not frozen
// at whatever moment the content was originally queued — reported by the
// user: the identical queued content launched fine under one ad account but
// failed under a second one, which pointed at the `ad_code` ("boost post
// access token") not being the stable, indefinitely-reusable value it looks
// like; using the freshest one available avoids launching against one
// that's gone stale since it was first captured into the queue.
//
// The video-registration step's own `item.mediaType === "VIDEO"` check was
// an exact, case-sensitive match against an uppercase literal — a real
// queued item's `mediaType` was observed as lowercase, so this step was
// silently skipped for real video content with no ad_code (nothing else
// resolves `source_instagram_media_id` into something Graph will accept at
// creative-creation time), surfacing only as a generic "Invalid parameter"
// much later. Now compared case-insensitively, and its own outcome is
// recorded as a step either way instead of being silently discarded.
//
// Items (and, within an item, every ad set it's launched into) now run
// CONCURRENTLY instead of one Graph call at a time — reported by the user as
// launches going completely silent partway through, with no error or result
// ever reaching the UI. Root cause: this route runs with `maxDuration: 60`
// (vercel.json) and used to process every item fully sequentially — verify,
// optionally register a video, create a creative, then create one ad per ad
// set, one item after another. A queue of more than a couple of items (or
// one item launched into several ad sets) could take longer than 60s in
// total even though each individual Graph call is fast, and once Vercel
// kills the function mid-stream the connection just closes with no final
// `{type:"done"}` ever written — see components/partnership/LaunchWizardModal.js's
// own comment on what that silent closure used to do to the UI. Running
// items in parallel (and each item's own ad-set creates in parallel) doesn't
// remove the 60s ceiling, but it turns "sum of every Graph call" into
// "slowest single item," which is the actual fix for real-world queue sizes.
// No concurrency cap is applied — this is a user-driven manual launch queue
// (a handful of items at a time, not a bulk import), the same assumption
// pages/api/fb/copy-ads/source-ads.js already makes for its own concurrent
// per-ad fetches.
//
// Progress messages are best-effort and can now interleave across items
// (two items verifying "at once" may both post a progress line close
// together) — acceptable for a single status line that's always just
// showing the most recent update, not a structured per-item progress list.
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
  // Which queue items actually produced at least one live ad — used by the
  // client (pages/partnership-ads/queue.js) to remove only the items that
  // truly launched when a batch finishes with some failures, instead of the
  // previous all-or-nothing gate that left even a fully-succeeded item sitting
  // in the queue just because a different item in the same batch failed.

  // One item's full pipeline — verify, optionally register a video, create a
  // creative, then create one ad per ad set (that last step itself fanned
  // out in parallel, see this file's header comment). Returns rather than
  // mutates shared state so every item can run concurrently via
  // `Promise.all` below with no risk of interleaving writes.
  async function runItem(item) {
    const itemSteps = [];
    progress(`Verifying "${item.name}"…`);

    let verified;
    try {
      const lookups = await lookupContent(token, businessId, {
        igUserId,
        adCodes: item.adCode ? [item.adCode] : undefined,
        permalinks: !item.adCode && item.permalink ? [item.permalink] : undefined,
      });
      verified = lookups[0];
      if (!verified && item.adCode) {
        // Content Discovery returns nothing for some codes (e.g. ones bound to the
        // brand as second identity), yet the creative call works with just the
        // code and the brand's own identity as sponsor. Verify-less launch.
        progress(`"${item.name}" is not listed in Content Discovery — launching directly with its code…`);
        verified = {
          content_id: undefined,
          author: {},
          partnership_info: [{ ad_code: item.adCode, tagged_partner: { ig_user_id: igUserId, fb_page_id: facebookPageId } }],
        };
      }
      if (!verified) throw new Error("Content is no longer available or eligible — it may have been removed or had its permission revoked.");
    } catch (err) {
      itemSteps.push({ type: "item", itemId: item.id, name: item.name, success: false, error: err.message });
      return { itemId: item.id, steps: itemSteps, succeeded: false, createdAdIds: [] };
    }

    // See this file's header comment — `content_id` doubles as the
    // Instagram media id both the video-registration and creative-creation
    // calls need as a fallback when the item has no ad_code.
    const sourceInstagramMediaId = verified.content_id;

    // Re-verification already re-fetches this content's own partnership_info
    // fresh from Graph (same CONTENT_FIELDS, includes ad_code) — use THAT
    // ad_code here, not `item.adCode` frozen into the queue at whatever
    // moment this content was originally discovered/queued (hours or days
    // earlier, from a different ad account's own session). Reported by the
    // user: the exact same queued content launched successfully under one
    // ad account but failed under a second one — Meta's branded-content
    // `ad_code` ("boost post access token") isn't a stable, infinitely
    // reusable identifier, so launching against a stale one can fail even
    // though the content itself is still perfectly eligible. Still falls
    // back to `item.adCode` if the fresh lookup somehow didn't return one
    // (shouldn't normally happen, since the lookup above was keyed by that
    // same ad_code when present).
    const adCode = firstPartnershipInfo(verified).ad_code || item.adCode;

    // The tagged partner (the creator) — see lib/partnershipAds.js's own
    // header comment on createBrandedCreative for the full story. This was
    // fetched by CONTENT_FIELDS from the very first version of this feature
    // but never actually used anywhere: `createBrandedCreative` used to be
    // called with this ad account's OWN identity for the branded_content
    // sponsor fields instead, which Graph correctly rejected as "you can't
    // be your own tagged partner" — the same error code/subcode as PR #280's
    // (genuinely ineligible) own-post case, but firing here for a completely
    // different, fixable reason: the real partner's identity was simply
    // never read out of a field this app had been fetching the whole time.
    // For a code Ads Manager marks "only valid for @brand as the second identity",
    // the brand itself IS the sponsor — a hand-made creative with the brand's own
    // Page/Instagram ids as sponsor_page_id/sponsor_id succeeds — so the reported
    // tagged partner is used exactly as returned, never swapped for the author.
    const taggedPartner = firstPartnershipInfo(verified).tagged_partner || {};

    // Case-insensitive: a real queued item's `mediaType` has been observed
    // as lowercase ("video") rather than the uppercase "VIDEO" this exact-
    // match check assumed — meaning this step was silently never running for
    // at least some real video content, no error, no sign anything was
    // skipped. Without it, `createBrandedCreative`'s `source_instagram_
    // media_id` points at an Instagram video that was never registered as a
    // usable source for this ad account, which Graph then rejects at
    // creative-creation time with nothing more specific than "Invalid
    // parameter" — exactly the error reported for two real video items that
    // both lacked an ad_code (so had no fallback but this path).
    const isVideo = String(item.mediaType || "").toUpperCase() === "VIDEO";

    if (isVideo && sourceInstagramMediaId) {
      try {
        await registerVideoSource(token, accountId, { sourceInstagramMediaId, adCode });
        itemSteps.push({ type: "video", itemId: item.id, name: item.name, success: true });
      } catch (err) {
        // Still best-effort — see this file's own header comment on why this
        // step's necessity on the ad_code path isn't fully confirmed — but
        // now recorded as a (non-fatal) step instead of silently discarded,
        // so a real failure here is visible instead of only ever showing up
        // as a confusing downstream "Invalid parameter" on the creative call.
        itemSteps.push({ type: "video", itemId: item.id, name: item.name, success: false, error: err.message });
      }
    }

    progress(`Creating ad creative for "${item.name}"…`);
    let creativeId;
    try {
      const creative = await createBrandedCreative(token, accountId, {
        objectId: facebookPageId,
        sponsorFacebookPageId: taggedPartner.fb_page_id,
        sponsorIgUserId: taggedPartner.ig_user_id,
        callToActionType: item.cta,
        link: item.redirectionLink,
        adCode,
        sourceInstagramMediaId,
        testimonial: item.primaryText || undefined,
      });
      creativeId = creative.id;
      itemSteps.push({ type: "creative", itemId: item.id, name: item.name, success: true, id: creativeId });
    } catch (err) {
      itemSteps.push({ type: "creative", itemId: item.id, name: item.name, success: false, error: err.message });
      return { itemId: item.id, steps: itemSteps, succeeded: false, createdAdIds: [] };
    }

    progress(`Creating ${adsetIds.length} ad${adsetIds.length === 1 ? "" : "s"} for "${item.name}"…`);
    const adResults = await Promise.allSettled(
      adsetIds.map((adsetId) => createAd(token, accountId, { name: item.name, adsetId, creativeId }))
    );
    let itemSucceeded = true;
    const createdAdIds = [];
    adResults.forEach((result, j) => {
      const adsetId = adsetIds[j];
      if (result.status === "fulfilled") {
        createdAdIds.push(result.value.id);
        itemSteps.push({ type: "ad", itemId: item.id, name: item.name, adsetId, success: true, id: result.value.id });
      } else {
        itemSucceeded = false;
        itemSteps.push({ type: "ad", itemId: item.id, name: item.name, adsetId, success: false, error: result.reason.message });
      }
    });

    return { itemId: item.id, steps: itemSteps, succeeded: itemSucceeded, createdAdIds };
  }

  const itemResults = await Promise.all(items.map(runItem));

  const steps = [];
  let overallSuccess = true;
  const allCreatedAdIds = [];
  const succeededItemIds = [];
  for (const result of itemResults) {
    steps.push(...result.steps);
    allCreatedAdIds.push(...result.createdAdIds);
    if (result.succeeded) succeededItemIds.push(result.itemId);
    else overallSuccess = false;
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
