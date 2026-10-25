import { getServerSession } from "next-auth/next";
import { authOptions } from "../../auth/[...nextauth]";
import { graphPost } from "@/lib/facebookGraph";
import { copyAdsetsIntoCampaign } from "@/lib/adCopy";
import { buildGenericCampaignPayload, toMinorUnits } from "@/lib/campaignLaunch";

// Campaign-level cross-account copy: creates one new campaign, then
// delegates to lib/adCopy.js's copyAdsetsIntoCampaign for the actual "N ad
// sets, one campaign" work — recreating every selected ad set under it (each
// cloned with its own targeting/budget/pixel settings, same conversion as
// the Ad Set-level route) and copying every selected ad into each new ad set
// via the same copyAdsIntoAdset machinery that function already uses. See
// that function's own comment for the asset-coordinator-sharing and
// partial-failure reasoning — identical here.
//
// Final activation is all-or-nothing across the ENTIRE nested result — if
// anything anywhere failed (the campaign, any ad set, any ad), everything
// created stays PAUSED rather than activating a partial, incomplete campaign.
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session?.accessToken) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  const { sourceAccountId, destAccountId, sourceCampaignId, campaignFields, campaignBudget, adsets, finalStatus: rawFinalStatus } = req.body || {};

  if (!sourceAccountId || !destAccountId || !sourceCampaignId) {
    return res.status(400).json({ error: "sourceAccountId, destAccountId, and sourceCampaignId are required" });
  }
  if (sourceAccountId === destAccountId) {
    return res.status(400).json({ error: "Source and destination ad accounts must be different." });
  }
  if (!campaignFields?.name) {
    return res.status(400).json({ error: "campaignFields.name is required" });
  }
  if (!Array.isArray(adsets) || adsets.length === 0) {
    return res.status(400).json({ error: "A non-empty adsets array is required" });
  }
  for (const a of adsets) {
    if (!a?.sourceAdsetId || !a?.adsetFields?.name || !a?.adsetFields?.optimizationGoal || !Array.isArray(a.items) || a.items.length === 0) {
      return res
        .status(400)
        .json({ error: "Each entry in adsets needs sourceAdsetId, adsetFields (with name, optimizationGoal), and a non-empty items array" });
    }
  }

  const token = session.accessToken;
  const finalStatus = rawFinalStatus === "ACTIVE" ? "ACTIVE" : "PAUSED";
  const { budgetStrategy, budgetType, budgetAmount } = campaignBudget || {};
  const budget = parseFloat(budgetAmount);
  const budgetAmountMinorUnits = budget > 0 ? toMinorUnits(budget) : undefined;

  res.writeHead(200, { "Content-Type": "application/x-ndjson", "Cache-Control": "no-cache" });
  function progress(message) {
    res.write(`${JSON.stringify({ type: "progress", message })}\n`);
  }
  function finish(body) {
    res.write(`${JSON.stringify({ type: "done", ...body })}\n`);
    res.end();
  }

  const steps = [];

  const campaignPayload = buildGenericCampaignPayload({ ...campaignFields, budgetStrategy, budgetType, budgetAmountMinorUnits });
  res.write(`${JSON.stringify({ type: "campaign_start", name: campaignPayload.name })}\n`);
  let campaignId;
  try {
    const json = await graphPost(`/${destAccountId}/campaigns`, token, campaignPayload);
    campaignId = json.id;
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

  const {
    createdAdsetIds,
    createdAdIds: allCreatedAdIds,
    steps: adsetSteps,
    overallSuccess: adsetsSucceeded,
  } = await copyAdsetsIntoCampaign(token, {
    destAccountId,
    sourceAccountId,
    campaignId,
    adsets,
    campaignBidStrategy: campaignFields.bidStrategy,
    budgetStrategy,
    budgetType,
    budgetAmountMinorUnits,
    onProgress: progress,
    onAdsetStart: (sourceAdsetId, name) => res.write(`${JSON.stringify({ type: "adset_start", sourceAdsetId, name })}\n`),
    onAdsetDone: (sourceAdsetId, result) => res.write(`${JSON.stringify({ type: "adset_done", sourceAdsetId, ...result })}\n`),
    onAdStart: (adId) => res.write(`${JSON.stringify({ type: "ad_start", adId })}\n`),
    onAdDone: (adId, result) => res.write(`${JSON.stringify({ type: "ad_done", adId, ...result })}\n`),
  });
  steps.push(...adsetSteps);
  let overallSuccess = adsetsSucceeded;

  if (finalStatus === "ACTIVE" && overallSuccess && allCreatedAdIds.length > 0) {
    progress("Activating…");
    try {
      await graphPost(`/${campaignId}`, token, { status: "ACTIVE" });
      await Promise.all(createdAdsetIds.map((id) => graphPost(`/${id}`, token, { status: "ACTIVE" })));
      await Promise.all(allCreatedAdIds.map((id) => graphPost(`/${id}`, token, { status: "ACTIVE" })));
      steps.push({ type: "activation", label: "Activated", success: true });
    } catch (err) {
      overallSuccess = false;
      steps.push({
        type: "activation",
        label: "Activation",
        success: false,
        error: `Created successfully but failed to activate: ${err.message}. Everything is sitting paused in Ads Manager — activate manually when ready.`,
      });
    }
  }

  finish({
    success: overallSuccess,
    createdCampaignId: campaignId,
    createdAdsetIds,
    createdAdIds: allCreatedAdIds,
    steps,
  });
}
