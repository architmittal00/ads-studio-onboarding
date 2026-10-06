import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import { graphPost } from "@/lib/facebookGraph";
import { STRATEGIES, roundBudgetAmount } from "@/lib/strategyEngine";
import { buildCampaignPayload, buildAdsetPayload, buildAdsetName, resolveInterestId, toMinorUnits } from "@/lib/campaignLaunch";
import { getOrCreateVisitorsAudience, getOrCreateBuyerLookalike } from "@/lib/audienceManager";

// Creates the real campaign + ad set(s) for one strategy on a live ad
// account. Sequential, not parallel — a campaign must exist before its ad
// sets can reference it. Everything is created PAUSED first regardless of
// the requested final status; only flipped to ACTIVE in a last step, and
// only if every object above succeeded, so a partial failure always leaves
// a safe, inert (paused) result rather than a half-launched active campaign.
// Nothing created is ever auto-deleted on failure — the response reports
// exactly what succeeded/failed so the user can finish manually in Ads
// Manager if needed.
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session?.accessToken) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  const { accountId, strategyId, dailyBudget, pageId, pixelId, status } = req.body || {};
  if (!accountId || !strategyId || !dailyBudget || !pageId || !pixelId) {
    return res.status(400).json({ error: "accountId, strategyId, dailyBudget, pageId, and pixelId are required" });
  }
  const budget = parseFloat(dailyBudget);
  if (!budget || budget <= 0) {
    return res.status(400).json({ error: "dailyBudget must be a positive number" });
  }
  const strategy = STRATEGIES.find((s) => s.id === Number(strategyId));
  if (!strategy) {
    return res.status(400).json({ error: `Unknown strategy id ${strategyId}` });
  }
  const finalStatus = status === "ACTIVE" ? "ACTIVE" : "PAUSED";

  const token = session.accessToken;
  const steps = [];
  let overallSuccess = true;

  // Audiences resolved once up front, reused by any campaign in this
  // strategy that needs them. Skipped entirely for strategies with no
  // retargeting/lookalike ad sets (2, 4, 6, 7, 8).
  const needsVisitors = strategy.campaigns.some((c) => c.adsets.some((a) => a.type === "retargeting"));
  const needsLookalike = strategy.campaigns.some((c) => c.adsets.some((a) => a.type === "lookalike"));
  let visitorsAudienceId = null;
  let lookalikeAudienceId = null;

  try {
    if (needsVisitors) {
      const result = await getOrCreateVisitorsAudience(accountId, token, pixelId);
      visitorsAudienceId = result.id;
      steps.push({ label: `Retargeting audience (${result.created ? "created" : "reused existing"})`, success: true, id: result.id });
    }
    if (needsLookalike) {
      const result = await getOrCreateBuyerLookalike(accountId, token, pixelId);
      lookalikeAudienceId = result.id;
      steps.push({ label: `Lookalike audience (${result.created ? "created" : "reused existing"})`, success: true, id: result.id });
    }
  } catch (err) {
    return res.status(200).json({ success: false, steps: [...steps, { label: "Audience setup", success: false, error: err.message }] });
  }

  const createdCampaignIds = [];
  const createdAdsetIds = [];

  for (const campaign of strategy.campaigns) {
    const isAbo = campaign.adsets.some((a) => a.pct != null);
    const campaignBudget = roundBudgetAmount((budget * campaign.pct) / 100, budget);

    let campaignId = null;
    const campaignPayload = buildCampaignPayload({
      funnel: campaign.funnel,
      strategyId: strategy.id,
      dailyBudgetMinorUnits: isAbo ? undefined : toMinorUnits(campaignBudget),
      isAbo,
    });

    try {
      const json = await graphPost(`/${accountId}/campaigns`, token, campaignPayload);
      campaignId = json.id;
      createdCampaignIds.push(campaignId);
      steps.push({ label: `Campaign: ${campaignPayload.name}`, success: true, id: campaignId });
    } catch (err) {
      overallSuccess = false;
      steps.push({ label: `Campaign: ${campaignPayload.name}`, success: false, error: err.message });
      continue; // can't create this campaign's ad sets without it
    }

    for (let i = 0; i < campaign.adsets.length; i++) {
      const adset = campaign.adsets[i];
      const adsetLabel = `Ad set: ${buildAdsetName(campaign.funnel, adset, i)}`;
      try {
        const interestId = adset.type === "interest" ? await resolveInterestId(token, adset.interestQuery) : null;
        const adsetBudget = isAbo ? roundBudgetAmount((campaignBudget * adset.pct) / 100, budget) : null;

        const payload = buildAdsetPayload({
          funnel: campaign.funnel,
          campaignId,
          pageId,
          pixelId,
          adset,
          index: i,
          audienceIds: { visitors: visitorsAudienceId, lookalike: lookalikeAudienceId },
          interestId,
          dailyBudgetMinorUnits: adsetBudget != null ? toMinorUnits(adsetBudget) : undefined,
        });
        const json = await graphPost(`/${accountId}/adsets`, token, payload);
        createdAdsetIds.push(json.id);
        steps.push({ label: adsetLabel, success: true, id: json.id });
      } catch (err) {
        overallSuccess = false;
        steps.push({ label: adsetLabel, success: false, error: err.message });
      }
    }
  }

  if (finalStatus === "ACTIVE" && overallSuccess && createdCampaignIds.length > 0) {
    try {
      await Promise.all(createdCampaignIds.map((id) => graphPost(`/${id}`, token, { status: "ACTIVE" })));
      await Promise.all(createdAdsetIds.map((id) => graphPost(`/${id}`, token, { status: "ACTIVE" })));
      steps.push({ label: "Activated", success: true });
    } catch (err) {
      overallSuccess = false;
      steps.push({
        label: "Activation",
        success: false,
        error: `Created successfully but failed to activate: ${err.message}. Everything is sitting paused in Ads Manager — activate it manually when ready.`,
      });
    }
  }

  res.status(200).json({ success: overallSuccess, steps });
}
