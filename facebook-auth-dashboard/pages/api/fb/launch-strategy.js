import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import { graphPost } from "@/lib/facebookGraph";
import { STRATEGIES, roundBudgetAmount } from "@/lib/strategyEngine";
import { buildCampaignPayload, buildAdsetPayload, buildAdsetName, toMinorUnits } from "@/lib/campaignLaunch";
import { getOrCreateVisitorsAudience, getOrCreateEngagersAudience, getOrCreateBuyerLookalike } from "@/lib/audienceManager";

// Creates the real campaign + ad set(s) for one strategy on a live ad
// account. Sequential, not parallel — a campaign must exist before its ad
// sets can reference it. Everything is created PAUSED first regardless of
// the requested final status; only flipped to ACTIVE in a last step, and
// only if every object above succeeded, so a partial failure always leaves
// a safe, inert (paused) result rather than a half-launched active campaign.
// Nothing created is ever auto-deleted on failure — the response reports
// exactly what succeeded/failed so the user can finish manually in Ads
// Manager if needed.
//
// Streams newline-delimited JSON instead of one final response: a
// `{type:"progress", message}` line before each slow step so the launch
// panel can show "Creating campaign 2 of 3…" in real time, then a single
// `{type:"done", success, accountId, steps}` line at the end. Once the
// first byte is written the HTTP status is locked at 200 — business-logic
// failure is communicated via `success:false` in the final line, same as
// the previous non-streamed version did.
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session?.accessToken) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  const { accountId, strategyId, dailyBudget, pageId, pixelId, status, interestChoices } = req.body || {};
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

  // Strategy 8's 3 ad sets are each a real, distinct Meta interest chosen by
  // the user (components/InterestPicker.js) — there is no stored/default
  // interest to silently fall back to, so launching it without a complete
  // choice is a hard error rather than resolving something unintended live.
  const totalInterestAdsets = strategy.campaigns.reduce(
    (sum, c) => sum + c.adsets.filter((a) => a.type === "interest").length,
    0
  );
  if (totalInterestAdsets > 0) {
    const valid = Array.isArray(interestChoices) && interestChoices.filter((c) => c?.id && c?.name).length;
    if (valid !== totalInterestAdsets) {
      return res.status(400).json({
        error: `This strategy needs ${totalInterestAdsets} chosen interest(s) (interestChoices: [{id, name}, ...]) — got ${valid || 0}`,
      });
    }
  }

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

  // "retargeting" ad sets always target BOTH website visitors and Page/ad
  // engagers (two separate Meta audience objects, unioned on the ad set —
  // see lib/campaignLaunch.js), so both are resolved together whenever any
  // ad set needs retargeting.
  const needsRetargeting = strategy.campaigns.some((c) => c.adsets.some((a) => a.type === "retargeting"));
  const needsLookalike = strategy.campaigns.some((c) => c.adsets.some((a) => a.type === "lookalike"));
  let visitorsAudienceId = null;
  let engagersAudienceId = null;
  let lookalikeAudienceId = null;

  try {
    if (needsRetargeting) {
      progress("Checking for an existing website-visitors audience…");
      const visitors = await getOrCreateVisitorsAudience(accountId, token, pixelId);
      visitorsAudienceId = visitors.id;
      steps.push({
        type: "audience",
        label: "Website visitors audience",
        created: visitors.created,
        success: true,
        id: visitors.id,
      });

      progress("Checking for an existing ad-engagers audience…");
      const engagers = await getOrCreateEngagersAudience(accountId, token, pageId);
      engagersAudienceId = engagers.id;
      steps.push({
        type: "audience",
        label: "Ad engagers audience",
        created: engagers.created,
        success: true,
        id: engagers.id,
      });
    }
    if (needsLookalike) {
      progress("Checking for an existing lookalike audience…");
      const result = await getOrCreateBuyerLookalike(accountId, token, pixelId);
      lookalikeAudienceId = result.id;
      steps.push({
        type: "audience",
        label: "Lookalike audience",
        created: result.created,
        success: true,
        id: result.id,
      });
    }
  } catch (err) {
    return finish({
      success: false,
      accountId,
      steps: [...steps, { type: "audience", label: "Audience setup", success: false, error: err.message }],
    });
  }

  const createdCampaignIds = [];
  const createdAdsetIds = [];
  let overallSuccess = true;
  let campaignNumber = 0;
  const campaignCount = strategy.campaigns.length;
  // Flat position across every interest ad set in the whole strategy (not
  // per-campaign) — matches how interestChoices is index-aligned on the
  // client, since Strategy 8's 3 interest ad sets all live in one campaign
  // but this stays correct even if a future strategy spreads them across
  // more than one.
  let interestChoiceIndex = 0;

  for (const campaign of strategy.campaigns) {
    campaignNumber += 1;
    const isAbo = campaign.adsets.some((a) => a.pct != null);
    const campaignBudget = roundBudgetAmount((budget * campaign.pct) / 100, budget);

    let campaignId = null;
    const campaignPayload = buildCampaignPayload({
      funnel: campaign.funnel,
      strategyId: strategy.id,
      dailyBudgetMinorUnits: isAbo ? undefined : toMinorUnits(campaignBudget),
      isAbo,
    });

    progress(`Creating campaign ${campaignNumber} of ${campaignCount}: ${campaign.name}…`);
    try {
      const json = await graphPost(`/${accountId}/campaigns`, token, campaignPayload);
      campaignId = json.id;
      createdCampaignIds.push(campaignId);
      steps.push({ type: "campaign", label: "Campaign", name: campaignPayload.name, success: true, id: campaignId });
    } catch (err) {
      overallSuccess = false;
      steps.push({ type: "campaign", label: "Campaign", name: campaignPayload.name, success: false, error: err.message });
      continue; // can't create this campaign's ad sets without it
    }

    for (let i = 0; i < campaign.adsets.length; i++) {
      const adset = campaign.adsets[i];
      // For "interest" ad sets, the id/name are already known (client-
      // chosen) before the name is built — fixes the previous ordering bug
      // where the name was built before the interest it names was resolved.
      const interestChoice = adset.type === "interest" ? interestChoices[interestChoiceIndex++] : null;
      const adsetName = buildAdsetName(campaign.funnel, adset, i, { interestName: interestChoice?.name });
      progress(`Creating ad set ${i + 1} of ${campaign.adsets.length} for ${campaign.name}: ${adsetName}…`);
      try {
        const adsetBudget = isAbo ? roundBudgetAmount((campaignBudget * adset.pct) / 100, budget) : null;

        const payload = buildAdsetPayload({
          funnel: campaign.funnel,
          campaignId,
          pageId,
          pixelId,
          adset,
          index: i,
          audienceIds: { visitors: visitorsAudienceId, engagers: engagersAudienceId, lookalike: lookalikeAudienceId },
          interestId: interestChoice?.id ?? null,
          interestName: interestChoice?.name,
          dailyBudgetMinorUnits: adsetBudget != null ? toMinorUnits(adsetBudget) : undefined,
        });
        const json = await graphPost(`/${accountId}/adsets`, token, payload);
        createdAdsetIds.push(json.id);
        steps.push({ type: "adset", label: "Ad set", name: adsetName, campaignId, success: true, id: json.id });
      } catch (err) {
        overallSuccess = false;
        steps.push({ type: "adset", label: "Ad set", name: adsetName, campaignId, success: false, error: err.message });
      }
    }
  }

  if (finalStatus === "ACTIVE" && overallSuccess && createdCampaignIds.length > 0) {
    progress("Activating…");
    try {
      await Promise.all(createdCampaignIds.map((id) => graphPost(`/${id}`, token, { status: "ACTIVE" })));
      await Promise.all(createdAdsetIds.map((id) => graphPost(`/${id}`, token, { status: "ACTIVE" })));
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
