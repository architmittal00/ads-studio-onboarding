import { getServerSession } from "next-auth/next";
import { authOptions } from "../../auth/[...nextauth]";
import { graphPost } from "@/lib/facebookGraph";
import { createAssetCopyCoordinator, copyAdsIntoAdset, COPY_CONCURRENCY } from "@/lib/adCopy";
import { buildGenericCampaignPayload, buildGenericAdsetPayload, toMinorUnits } from "@/lib/campaignLaunch";
import { mapWithConcurrency } from "@/lib/metaInterestSearch";

// How many ad sets this route creates (and copies ads into) at once. Kept
// deliberately lower than COPY_CONCURRENCY (which already runs up to 5
// concurrent ad-copies *within* one ad set) — a campaign with several ad
// sets, each copying several ads, compounds into far more simultaneous
// write-heavy Graph calls than this app has ever exercised at the plain
// ad-set level. Unverified against a real multi-ad-set account at this
// value; the first signal to dial it down is the same one COPY_CONCURRENCY
// already watches for (a visible Meta rate-limit error). See PROJECT_STATUS.md.
const ADSET_CONCURRENCY = 2;

// Campaign-level cross-account copy: creates one new campaign, then
// recreates every selected ad set under it (each cloned with its own
// targeting/budget/pixel settings, same conversion as the Ad Set-level
// route), copying every selected ad into each new ad set via the same
// copyAdsIntoAdset machinery. Structurally "ad-set level, done N times,
// sharing one new campaign and one asset-copy coordinator" — an asset
// (image/video) reused across two different ad sets under the same source
// campaign is still only ever copied once, since `assets` is constructed
// ONCE for the whole request here, unlike copy-adset.js's own per-request
// (but single-ad-set-scoped) coordinator.
//
// Partial-failure semantics, same rule as every other creation flow in this
// app: one ad set failing to create doesn't abort the rest (mapWithConcurrency
// keeps going), but final activation is all-or-nothing across the ENTIRE
// nested result — if anything anywhere failed (the campaign, any ad set, any
// ad), everything created stays PAUSED rather than activating a partial,
// incomplete campaign.
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

  // Shared across every ad set in this request — not per ad set — so a
  // creative asset reused across two of the source campaign's ad sets (a
  // common case: several ad sets testing different audiences against the
  // same base creative) is still only ever copied once.
  const assets = createAssetCopyCoordinator(token, destAccountId, sourceAccountId, progress);

  const createdAdsetIds = [];
  const allCreatedAdIds = [];
  let overallSuccess = true;

  const adsetResults = await mapWithConcurrency(adsets, ADSET_CONCURRENCY, async (entry, i) => {
    const { sourceAdsetId, adsetFields, items } = entry;
    progress(`Creating ad set ${i + 1} of ${adsets.length}: ${adsetFields.name}…`);

    // Budget STRATEGY is shared by every ad set under the new campaign (it
    // has to match the campaign's own CBO/ABO shape — see this file's own
    // header comment) but the AMOUNT is not: under ABO, each source ad set
    // can carry its own distinct budget, so the amount has to come from
    // THIS ad set's own adsetFields (already resolved to the source's real
    // value by adsets-list.js's toFormFields), not the one shared
    // campaign-level amount, which only ever applies to a CBO campaign's own
    // budget (a single, genuinely shared number) and is irrelevant here
    // otherwise.
    const ownBudget = parseFloat(adsetFields.budgetAmount);
    const adsetBudgetAmountMinorUnits = budgetStrategy === "ABO" && ownBudget > 0 ? toMinorUnits(ownBudget) : budgetAmountMinorUnits;
    const adsetPayload = buildGenericAdsetPayload({
      ...adsetFields,
      campaignId,
      bidStrategy: campaignFields.bidStrategy,
      budgetStrategy,
      budgetType,
      budgetAmountMinorUnits: adsetBudgetAmountMinorUnits,
    });
    res.write(`${JSON.stringify({ type: "adset_start", sourceAdsetId, name: adsetPayload.name })}\n`);
    let adsetId;
    try {
      const json = await graphPost(`/${destAccountId}/adsets`, token, adsetPayload);
      adsetId = json.id;
      res.write(`${JSON.stringify({ type: "adset_done", sourceAdsetId, success: true, id: adsetId })}\n`);
    } catch (err) {
      res.write(`${JSON.stringify({ type: "adset_done", sourceAdsetId, success: false, error: err.message })}\n`);
      return { adsetStep: { type: "adset", label: "Ad set", name: adsetPayload.name, sourceAdsetId, success: false, error: err.message }, adSteps: [], createdAdIds: [], success: false };
    }

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
      onAdDone: (adId, result) => adDone(adId, { ...result, sourceAdsetId }),
    });

    return {
      adsetStep: { type: "adset", label: "Ad set", name: adsetPayload.name, sourceAdsetId, success: true, id: adsetId },
      adSteps: adSteps.map((s) => ({ ...s, sourceAdsetId })),
      createdAdIds,
      success: adsSucceeded,
    };
  });

  for (const r of adsetResults) {
    steps.push(r.adsetStep);
    steps.push(...r.adSteps);
    if (r.adsetStep.id) createdAdsetIds.push(r.adsetStep.id);
    allCreatedAdIds.push(...r.createdAdIds);
    if (!r.success) overallSuccess = false;
  }

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
