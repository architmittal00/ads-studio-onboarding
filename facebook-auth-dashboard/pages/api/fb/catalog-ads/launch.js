import { requireCatalogAdsRequest } from "@/lib/catalogAds/apiGuard";
import { graphPost } from "@/lib/facebookGraph";
import { buildCatalogAdsetPayload, buildCatalogCampaignPayload, buildCatalogCreativeParams, buildStandardCreativeParams, toMinorUnits } from "@/lib/catalogAds/launch";

// Catalog AND standard (image/existing-post) ad launch sequence — same
// paused-first-then-activate-only-if-everything-succeeded shape as
// pages/api/fb/launch-campaign.js, extended with the two extra steps that
// endpoint never needed (this ad's own creative + ad), since the existing
// Launch tab's "new campaign/ad set" flow never creates an ad from scratch,
// only duplicates an existing one's creative by id.
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const session = await requireCatalogAdsRequest(req, res);
  if (!session) return;

  const { accountId, campaign, existingCampaignId, budgetStrategy, budgetType, budgetAmount, adset, ad, status } = req.body || {};
  const isCatalog = !!adset?.isCatalog;

  if (!accountId || !adset?.name || !adset?.optimizationGoal) {
    return res.status(400).json({ error: "accountId and adset (with name, optimizationGoal) are required" });
  }
  if (isCatalog && !adset?.productSetId) {
    return res.status(400).json({ error: "adset.productSetId is required for a catalog ad set" });
  }
  if (!isCatalog && !adset?.pixelId) {
    return res.status(400).json({ error: "adset.pixelId is required for a standard ad set" });
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
  if (campaign && isCatalog && !campaign.catalogId) {
    return res.status(400).json({ error: "campaign.catalogId is required for a new catalog campaign" });
  }
  if (!ad?.name || !ad?.pageId) {
    return res.status(400).json({ error: "ad.name and ad.pageId are required" });
  }
  if (ad.kind === "POST" && !ad.postId) {
    return res.status(400).json({ error: "ad.postId is required for an existing-post ad" });
  }
  if (ad.kind !== "POST" && (!ad.message || !ad.headline || !ad.link)) {
    return res.status(400).json({ error: "ad.message, ad.headline and ad.link are required" });
  }

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
    const campaignPayload = buildCatalogCampaignPayload({ ...campaign, budgetStrategy, budgetType, budgetAmountMinorUnits });
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

  const adsetPayload = buildCatalogAdsetPayload({
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

  let adId = null;
  if (adsetId) {
    const creativePayload = isCatalog ? buildCatalogCreativeParams({ ad, productSetId: adset.productSetId }) : buildStandardCreativeParams({ ad });
    progress(`Creating ad creative…`);
    try {
      const creative = await graphPost(`/${accountId}/adcreatives`, token, creativePayload);
      progress(`Creating ad: ${ad.name}…`);
      const adJson = await graphPost(`/${accountId}/ads`, token, {
        name: ad.name.trim(),
        adset_id: adsetId,
        creative: { creative_id: creative.id },
        status: "PAUSED",
      });
      adId = adJson.id;
      steps.push({ type: "ad", label: "Ad", name: ad.name.trim(), success: true, id: adId });
    } catch (err) {
      overallSuccess = false;
      steps.push({ type: "ad", label: "Ad", name: ad.name.trim(), success: false, error: err.message });
    }
  }

  if (finalStatus === "ACTIVE" && overallSuccess) {
    progress("Activating…");
    try {
      if (weCreatedCampaign) await graphPost(`/${campaignId}`, token, { status: "ACTIVE" });
      await graphPost(`/${adsetId}`, token, { status: "ACTIVE" });
      if (adId) await graphPost(`/${adId}`, token, { status: "ACTIVE" });
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
