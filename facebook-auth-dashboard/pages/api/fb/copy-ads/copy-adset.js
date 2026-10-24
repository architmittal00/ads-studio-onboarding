import { getServerSession } from "next-auth/next";
import { authOptions } from "../../auth/[...nextauth]";
import { graphPost } from "@/lib/facebookGraph";
import { createAssetCopyCoordinator, copyAdsIntoAdset, COPY_CONCURRENCY } from "@/lib/adCopy";
import { buildGenericCampaignPayload, buildGenericAdsetPayload, toMinorUnits } from "@/lib/campaignLaunch";

// Ad Set-level cross-account copy: creates a brand-new ad set in the
// destination account — either under a brand-new campaign cloned from the
// source ad set's own parent campaign (`destinationMode: "new_campaign"`) or
// under a campaign that already exists there (`"existing_campaign"`) — then
// copies every selected ad from the source ad set into it via the exact same
// machinery pages/api/fb/copy-ads/copy.js already uses for its own ad-level
// path (lib/adCopy.js's copyAdsIntoAdset, extracted from that route for
// exactly this reuse).
//
// Same two-phase safety pattern as every other creation flow in this app:
// the campaign (if created)/ad set/every ad are all created PAUSED first,
// only flipped to ACTIVE in one final step, and only if every single one of
// those creates succeeded — mirrors pages/api/fb/launch-campaign.js's own
// "only activate what this request itself created" rule exactly, just with
// a cross-account creative copy standing in for launch-campaign.js's
// same-account creative_id reuse.
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session?.accessToken) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  const {
    sourceAccountId,
    destAccountId,
    sourceAdsetId,
    destinationMode,
    destCampaignId,
    campaignFields,
    campaignBudget,
    adsetFields,
    items,
    finalStatus: rawFinalStatus,
  } = req.body || {};

  if (!sourceAccountId || !destAccountId || !sourceAdsetId) {
    return res.status(400).json({ error: "sourceAccountId, destAccountId, and sourceAdsetId are required" });
  }
  if (sourceAccountId === destAccountId) {
    return res.status(400).json({ error: "Source and destination ad accounts must be different." });
  }
  if (destinationMode !== "new_campaign" && destinationMode !== "existing_campaign") {
    return res.status(400).json({ error: "destinationMode must be 'new_campaign' or 'existing_campaign'" });
  }
  if (destinationMode === "existing_campaign" && !destCampaignId) {
    return res.status(400).json({ error: "destCampaignId is required when destinationMode is 'existing_campaign'" });
  }
  if (destinationMode === "new_campaign" && !campaignFields?.name) {
    return res.status(400).json({ error: "campaignFields.name is required when destinationMode is 'new_campaign'" });
  }
  if (!adsetFields?.name || !adsetFields?.optimizationGoal) {
    return res.status(400).json({ error: "adsetFields (with name, optimizationGoal) is required" });
  }
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "A non-empty items array is required" });
  }

  const token = session.accessToken;
  const finalStatus = rawFinalStatus === "ACTIVE" ? "ACTIVE" : "PAUSED";
  // The campaign's own CBO/ABO shape decides whether a budget lands on the
  // campaign or the ad set — see lib/campaignLaunch.js's buildGenericCampaignPayload/
  // buildGenericAdsetPayload, same convention pages/api/fb/launch-campaign.js
  // already uses. For `existing_campaign`, the client is responsible for
  // reading this off the picked campaign's own budget fields (campaigns-list.js
  // already returns `daily_budget`/`lifetime_budget` on every list row) —
  // this route trusts whatever it's sent rather than re-deriving it, same as
  // launch-campaign.js already does for its own existingCampaignId path.
  const { budgetStrategy, budgetType, budgetAmount } = campaignBudget || {};
  const budget = parseFloat(budgetAmount);
  const budgetAmountMinorUnits = budget > 0 ? toMinorUnits(budget) : undefined;

  res.writeHead(200, { "Content-Type": "application/x-ndjson", "Cache-Control": "no-cache" });
  function progress(message) {
    res.write(`${JSON.stringify({ type: "progress", message })}\n`);
  }
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

  const steps = [];
  let overallSuccess = true;
  let campaignId = destinationMode === "existing_campaign" ? destCampaignId : null;
  let weCreatedCampaign = false;

  if (destinationMode === "new_campaign") {
    const campaignPayload = buildGenericCampaignPayload({ ...campaignFields, budgetStrategy, budgetType, budgetAmountMinorUnits });
    res.write(`${JSON.stringify({ type: "campaign_start", name: campaignPayload.name })}\n`);
    try {
      const json = await graphPost(`/${destAccountId}/campaigns`, token, campaignPayload);
      campaignId = json.id;
      weCreatedCampaign = true;
      res.write(`${JSON.stringify({ type: "campaign_done", success: true, id: campaignId })}\n`);
      steps.push({ type: "campaign", label: "Campaign", name: campaignPayload.name, success: true, id: campaignId });
    } catch (err) {
      res.write(`${JSON.stringify({ type: "campaign_done", success: false, error: err.message })}\n`);
      finish({
        success: false,
        steps: [...steps, { type: "campaign", label: "Campaign", name: campaignPayload.name, success: false, error: err.message }],
      });
      return;
    }
  }

  // Bid strategy mirrors the campaign's own choice when we just created one
  // (Meta expects these consistent, especially under CBO) — falls back to
  // the ad set's own source-derived bid strategy when attaching to an
  // existing campaign instead, same reasoning launch-campaign.js's own
  // comment gives for the identical choice.
  const adsetPayload = buildGenericAdsetPayload({
    ...adsetFields,
    campaignId,
    bidStrategy: destinationMode === "new_campaign" ? campaignFields?.bidStrategy : adsetFields.bidStrategy,
    budgetStrategy,
    budgetType,
    budgetAmountMinorUnits,
  });
  res.write(`${JSON.stringify({ type: "adset_start", sourceAdsetId, name: adsetPayload.name })}\n`);
  let adsetId = null;
  try {
    const json = await graphPost(`/${destAccountId}/adsets`, token, adsetPayload);
    adsetId = json.id;
    res.write(`${JSON.stringify({ type: "adset_done", sourceAdsetId, success: true, id: adsetId })}\n`);
    steps.push({ type: "adset", label: "Ad set", name: adsetPayload.name, success: true, id: adsetId });
  } catch (err) {
    res.write(`${JSON.stringify({ type: "adset_done", sourceAdsetId, success: false, error: err.message })}\n`);
    steps.push({ type: "adset", label: "Ad set", name: adsetPayload.name, success: false, error: err.message });
    finish({ success: false, createdCampaignId: weCreatedCampaign ? campaignId : null, steps });
    return;
  }

  // Shared across just this one ad set's items — same dedup guarantee
  // pages/api/fb/copy-ads/copy.js's own batch gets, scoped the same way
  // (one ad set's worth of ads, not spanning several).
  const assets = createAssetCopyCoordinator(token, destAccountId, sourceAccountId, progress);
  const {
    createdAdIds,
    steps: adSteps,
    overallSuccess: adsSucceeded,
  } = await copyAdsIntoAdset(token, {
    destAccountId,
    destAdsetId: adsetId,
    items,
    assets,
    concurrency: COPY_CONCURRENCY,
    onProgress: progress,
    onAdStart: adStart,
    onAdDone: adDone,
  });
  steps.push(...adSteps);
  if (!adsSucceeded) overallSuccess = false;

  if (finalStatus === "ACTIVE" && overallSuccess && createdAdIds.length > 0) {
    progress("Activating…");
    try {
      // Never flips a pre-existing campaign the user attached to — only
      // what this request itself created, same rule launch-campaign.js
      // already enforces for its own existingCampaignId path.
      if (weCreatedCampaign) await graphPost(`/${campaignId}`, token, { status: "ACTIVE" });
      await graphPost(`/${adsetId}`, token, { status: "ACTIVE" });
      await Promise.all(createdAdIds.map((id) => graphPost(`/${id}`, token, { status: "ACTIVE" })));
      steps.push({ type: "activation", label: "Activated", success: true });
    } catch (err) {
      overallSuccess = false;
      steps.push({
        type: "activation",
        label: "Activation",
        success: false,
        error: `Created successfully but failed to activate: ${err.message}. Everything is sitting paused in Ads Manager — activate it manually when ready.`,
      });
    }
  }

  finish({
    success: overallSuccess,
    createdCampaignId: weCreatedCampaign ? campaignId : null,
    createdAdsetId: adsetId,
    createdAdIds,
    steps,
  });
}
