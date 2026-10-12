import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import { graphPost } from "@/lib/facebookGraph";
import { buildGenericCampaignPayload, buildGenericAdsetPayload, toMinorUnits } from "@/lib/campaignLaunch";

// General-purpose campaign/ad-set creation for the Launch tab — separate
// from pages/api/fb/launch-strategy.js (which stays hardwired to the fixed
// STRATEGIES list for the Figure Out Strategy flow) so neither path can
// break the other. Exactly one of `campaign` (create a new one) or
// `existingCampaignId` (attach the new ad set to it) is provided — the
// "duplicate an existing ad set" entry point on the Launch tab is handled
// entirely client-side (pages/api/fb/adsets-list.js?adsetId= pre-fills the
// same `adset` fields this endpoint takes from a source ad set's live
// settings instead of the Indian-D2C defaults), so this endpoint never needs
// to know a launch came from a duplicate.
//
// Same safety pattern as launch-strategy.js: everything is created PAUSED
// first regardless of the requested final status, only flipped to ACTIVE in
// a last step and only if every create succeeded — and only the objects
// *this request created* are touched, never a pre-existing campaign passed
// in via `existingCampaignId`. Streams newline-delimited JSON for the same
// reason (live progress instead of one blocking response).
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session?.accessToken) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  const { accountId, campaign, existingCampaignId, budgetStrategy, budgetType, budgetAmount, adset, status } = req.body || {};

  if (!accountId || !adset?.name || !adset?.optimizationGoal) {
    return res.status(400).json({ error: "accountId and adset (with name, optimizationGoal) are required" });
  }
  if (!campaign && !existingCampaignId) {
    return res.status(400).json({ error: "Either campaign (to create one) or existingCampaignId is required" });
  }
  if (campaign && existingCampaignId) {
    return res.status(400).json({ error: "Provide only one of campaign or existingCampaignId, not both" });
  }
  if (campaign && !campaign.name) {
    return res.status(400).json({ error: "campaign.name is required" });
  }

  // A budget amount is only actually spent somewhere when this request is
  // creating a CBO campaign (budget lands on the campaign) or the ad set
  // itself is ABO (budget lands on the ad set) — attaching to an existing
  // CBO campaign needs no amount at all, since that campaign already funds
  // every ad set under it and Meta rejects a budget set on the ad set too.
  const budgetIsUsed = (campaign && budgetStrategy === "CBO") || budgetStrategy === "ABO";
  const budget = parseFloat(budgetAmount);
  if (budgetIsUsed && (!budget || budget <= 0)) {
    return res.status(400).json({ error: "budgetAmount must be a positive number" });
  }
  const budgetAmountMinorUnits = budget > 0 ? toMinorUnits(budget) : undefined;
  const finalStatus = status === "ACTIVE" ? "ACTIVE" : "PAUSED";

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
  let campaignId = existingCampaignId || null;
  let weCreatedCampaign = false;

  if (campaign) {
    const campaignPayload = buildGenericCampaignPayload({ ...campaign, budgetStrategy, budgetType, budgetAmountMinorUnits });
    progress(`Creating campaign: ${campaignPayload.name}…`);
    try {
      const json = await graphPost(`/${accountId}/campaigns`, token, campaignPayload);
      campaignId = json.id;
      weCreatedCampaign = true;
      steps.push({ type: "campaign", label: "Campaign", name: campaignPayload.name, success: true, id: campaignId });
    } catch (err) {
      return finish({
        success: false,
        accountId,
        steps: [...steps, { type: "campaign", label: "Campaign", name: campaignPayload.name, success: false, error: err.message }],
      });
    }
  }

  // The ad set's bid strategy mirrors the campaign's choice when we created
  // one (Meta expects these consistent, especially under CBO) — falls back
  // to buildGenericAdsetPayload's own BID_STRATEGY default when attaching to
  // an existing campaign, whose bid strategy this request never fetched.
  const adsetPayload = buildGenericAdsetPayload({
    ...adset,
    campaignId,
    bidStrategy: campaign?.bidStrategy,
    budgetStrategy,
    budgetType,
    budgetAmountMinorUnits,
  });
  progress(`Creating ad set: ${adsetPayload.name}…`);
  let adsetId = null;
  try {
    const json = await graphPost(`/${accountId}/adsets`, token, adsetPayload);
    adsetId = json.id;
    steps.push({ type: "adset", label: "Ad set", name: adsetPayload.name, campaignId, success: true, id: adsetId });
  } catch (err) {
    overallSuccess = false;
    steps.push({ type: "adset", label: "Ad set", name: adsetPayload.name, campaignId, success: false, error: err.message });
  }

  if (finalStatus === "ACTIVE" && overallSuccess) {
    progress("Activating…");
    try {
      // Never flips a pre-existing campaign the user attached to — only
      // what this request itself created.
      if (weCreatedCampaign) await graphPost(`/${campaignId}`, token, { status: "ACTIVE" });
      await graphPost(`/${adsetId}`, token, { status: "ACTIVE" });
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

  finish({ success: overallSuccess, accountId, steps });
}
