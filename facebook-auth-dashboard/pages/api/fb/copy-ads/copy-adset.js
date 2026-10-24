import { getServerSession } from "next-auth/next";
import { authOptions } from "../../auth/[...nextauth]";
import { graphPost } from "@/lib/facebookGraph";
import { copyAdsetsIntoCampaign } from "@/lib/adCopy";
import { buildGenericCampaignPayload, toMinorUnits } from "@/lib/campaignLaunch";

// Ad Set-level cross-account copy: creates one or more brand-new ad sets in
// the destination account — either under a brand-new campaign cloned from
// the (single) source ad set's own parent campaign (`destinationMode:
// "new_campaign"`, only valid for one ad set at a time — see the validation
// below) or under a campaign that already exists there
// (`"existing_campaign"`, the only mode multi-select supports: several
// source ad sets can land together in one existing destination campaign, but
// never spread across several new ones) — then copies every selected ad from
// each source ad set into its new one via lib/adCopy.js's
// copyAdsetsIntoCampaign (shared with pages/api/fb/copy-ads/copy-campaign.js,
// which does the identical "N ad sets, one campaign" work for its own
// always-new-campaign case).
//
// Same two-phase safety pattern as every other creation flow in this app:
// the campaign (if created)/every ad set/every ad are all created PAUSED
// first, only flipped to ACTIVE in one final step, and only if every single
// one of those creates succeeded — mirrors pages/api/fb/launch-campaign.js's
// own "only activate what this request itself created" rule exactly, just
// with a cross-account creative copy standing in for launch-campaign.js's
// same-account creative_id reuse.
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session?.accessToken) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  const { sourceAccountId, destAccountId, adsets, destinationMode, destCampaignId, campaignFields, campaignBudget, finalStatus: rawFinalStatus } =
    req.body || {};

  if (!sourceAccountId || !destAccountId) {
    return res.status(400).json({ error: "sourceAccountId and destAccountId are required" });
  }
  if (sourceAccountId === destAccountId) {
    return res.status(400).json({ error: "Source and destination ad accounts must be different." });
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
  if (destinationMode !== "new_campaign" && destinationMode !== "existing_campaign") {
    return res.status(400).json({ error: "destinationMode must be 'new_campaign' or 'existing_campaign'" });
  }
  // Creating a brand-new campaign only makes sense for exactly one ad set —
  // several ad sets selected together can only ever land in one EXISTING
  // campaign (the user's own explicit choice: "all the ad sets to 1
  // campaign only, that too one which exists before"), never spread across
  // several freshly-created ones or bundled into a single new one that
  // doesn't correspond to any one of their real source campaigns.
  if (destinationMode === "new_campaign" && adsets.length > 1) {
    return res
      .status(400)
      .json({ error: "Creating a new campaign is only supported for a single ad set — pick an existing destination campaign to copy several ad sets at once." });
  }
  if (destinationMode === "existing_campaign" && !destCampaignId) {
    return res.status(400).json({ error: "destCampaignId is required when destinationMode is 'existing_campaign'" });
  }
  if (destinationMode === "new_campaign" && !campaignFields?.name) {
    return res.status(400).json({ error: "campaignFields.name is required when destinationMode is 'new_campaign'" });
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
  function finish(body) {
    res.write(`${JSON.stringify({ type: "done", ...body })}\n`);
    res.end();
  }

  const steps = [];
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

  // `campaignBidStrategy` only passed when we just created a new campaign to
  // match — see lib/adCopy.js's copyAdsetsIntoCampaign for why each ad set
  // falls back to its own real bid strategy otherwise (an existing
  // destination campaign this route didn't create has no bid strategy of
  // its own to enforce).
  const {
    createdAdsetIds,
    createdAdIds,
    steps: adsetSteps,
    overallSuccess: adsetsSucceeded,
  } = await copyAdsetsIntoCampaign(token, {
    destAccountId,
    sourceAccountId,
    campaignId,
    adsets,
    campaignBidStrategy: destinationMode === "new_campaign" ? campaignFields?.bidStrategy : undefined,
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

  if (finalStatus === "ACTIVE" && overallSuccess && createdAdIds.length > 0) {
    progress("Activating…");
    try {
      // Never flips a pre-existing campaign the user attached to — only
      // what this request itself created, same rule launch-campaign.js
      // already enforces for its own existingCampaignId path.
      if (weCreatedCampaign) await graphPost(`/${campaignId}`, token, { status: "ACTIVE" });
      await Promise.all(createdAdsetIds.map((id) => graphPost(`/${id}`, token, { status: "ACTIVE" })));
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
    createdAdsetIds,
    createdAdIds,
    steps,
  });
}
