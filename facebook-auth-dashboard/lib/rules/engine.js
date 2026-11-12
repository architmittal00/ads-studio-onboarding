import { RULES } from "./definitions";
import { WINDOWS, derive, emptyAgg, addInsightsRow } from "./metrics";
import { isPurchaseOptimized, isLearning } from "./optimization";

const BUDGET_STEP_NOTE = "Budget changes are suggested at 10% and can be edited before applying.";
export { BUDGET_STEP_NOTE };

const toMajor = (v) => (v ? parseFloat(v) / 100 : null);

// structure: { campaigns, adsets, ads } of ACTIVE entities, as listed by Graph.
// insightsByWindow: { 3: rows[], 7: rows[], 14: rows[], 30: rows[] } — ad-level rows with ad_id/adset_id/campaign_id.
// Returns { baseline, flags, rulesChecked }.
export function evaluateAccount({ structure, insightsByWindow, currency, currencySymbol, recentBudgetChanges, extraNames = {}, levels = null }) {
  const recentChanged = recentBudgetChanges?.changed || {};
  // Aggregate every window's ad-level rows up the tree. Account totals include inactive ads too.
  const accAgg = {};
  const adAgg = new Map();
  const adsetAgg = new Map();
  const campaignAgg = new Map();
  const bump = (map, id, w, row) => {
    if (!id) return;
    if (!map.has(id)) map.set(id, {});
    const byWindow = map.get(id);
    byWindow[w] ||= emptyAgg();
    addInsightsRow(byWindow[w], row);
  };
  for (const w of WINDOWS) {
    accAgg[w] = emptyAgg();
    for (const row of insightsByWindow[w] || []) {
      addInsightsRow(accAgg[w], row);
      bump(adAgg, row.ad_id, w, row);
      bump(adsetAgg, row.adset_id, w, row);
      bump(campaignAgg, row.campaign_id, w, row);
    }
  }
  const metricsOf = (map, id) => {
    const byWindow = map.get(id) || {};
    const m = {};
    for (const w of WINDOWS) m[w] = derive(byWindow[w] || emptyAgg());
    return m;
  };

  const acc = {};
  for (const w of WINDOWS) acc[w] = derive(accAgg[w]);

  const campaigns = structure.campaigns.map((c) => {
    const cbo = !!(parseFloat(c.daily_budget) > 0 || parseFloat(c.lifetime_budget) > 0);
    return {
      type: "campaign",
      id: c.id,
      name: c.name,
      cbo,
      budgetType: parseFloat(c.daily_budget) > 0 ? "daily" : parseFloat(c.lifetime_budget) > 0 ? "lifetime" : null,
      budget: toMajor(parseFloat(c.daily_budget) > 0 ? c.daily_budget : c.lifetime_budget),
      m: metricsOf(campaignAgg, c.id),
    };
  });
  const campaignById = new Map(campaigns.map((c) => [c.id, c]));
  const adsets = structure.adsets.map((a) => {
    const abo = !!(parseFloat(a.daily_budget) > 0 || parseFloat(a.lifetime_budget) > 0);
    return {
      type: "adset",
      id: a.id,
      name: a.name,
      campaignId: a.campaign_id,
      abo,
      budgetType: parseFloat(a.daily_budget) > 0 ? "daily" : parseFloat(a.lifetime_budget) > 0 ? "lifetime" : null,
      budget: toMajor(parseFloat(a.daily_budget) > 0 ? a.daily_budget : a.lifetime_budget),
      // Rules only judge ad sets optimized for Purchase / purchase value (lib/rules/optimization.js).
      eligible: isPurchaseOptimized(a),
      learning: isLearning(a),
      m: metricsOf(adsetAgg, a.id),
    };
  });
  const adsetById = new Map(adsets.map((a) => [a.id, a]));
  // An ad follows its ad set (unknown ad set → skipped).
  const ads = structure.ads.map((a) => ({ type: "ad", id: a.id, name: a.name, adsetId: a.adset_id, campaignId: a.campaign_id, createdAt: a.created_time ? Date.parse(a.created_time) : null, eligible: !!adsetById.get(a.adset_id)?.eligible, m: metricsOf(adAgg, a.id) }));

  const adsByAdset = new Map();
  for (const ad of ads) {
    if (!adsByAdset.has(ad.adsetId)) adsByAdset.set(ad.adsetId, []);
    adsByAdset.get(ad.adsetId).push(ad);
  }
  const adsetsByCampaign = new Map();
  for (const a of adsets) {
    if (!adsetsByCampaign.has(a.campaignId)) adsetsByCampaign.set(a.campaignId, []);
    adsetsByCampaign.get(a.campaignId).push(a);
  }

  // A campaign is judged only when every one of its active ad sets is optimized for purchases — its ROAS
  // is a blend of its ad sets', so a mixed campaign's figure means nothing.
  for (const c of campaigns) {
    const own = adsetsByCampaign.get(c.id) || [];
    c.eligible = own.length > 0 && own.every((a) => a.eligible);
    // A campaign is in learning while any of its ad sets is (a campaign budget change would hit that ad set too).
    c.learning = own.some((a) => a.learning);
  }
  const eligibleAdsets = adsets.filter((a) => a.eligible);
  const eligibleCampaigns = campaigns.filter((c) => c.eligible);

  const spends = eligibleCampaigns.map((c) => c.m[7].spend).sort((a, b) => a - b);
  const median = spends.length === 0 ? 0 : spends.length % 2 ? spends[(spends.length - 1) / 2] : (spends[spends.length / 2 - 1] + spends[spends.length / 2]) / 2;
  const ctx = {
    acc,
    currency,
    currencySymbol,
    now: Date.now(),
    // Rankings ("top 30% by spend") compare like with like: only purchase-optimized ad sets.
    activeAdsets: eligibleAdsets,
    adsetsOfCampaign: (id) => adsetsByCampaign.get(id) || [],
    adsOfAdset: (id) => adsByAdset.get(id) || [],
    adsetById: (id) => adsetById.get(id),
    avgCampaignSpend7: spends.length ? spends.reduce((t, v) => t + v, 0) / spends.length : 0,
    medianCampaignSpend7: median,
  };

  const subjectsByLevel = { campaign: campaigns, adset: adsets, ad: ads };
  const byEntity = new Map(); // "type:id" -> { subject, hits: [] }
  for (const rule of RULES) {
    // `levels` (Custom Views) narrows the run to the entity types on screen.
    if (levels && !levels.includes(rule.level)) continue;
    for (const subject of subjectsByLevel[rule.level]) {
      // Only entities optimized for purchases; and nothing to judge without any delivery in the last 7 days.
      if (!subject.eligible) continue;
      // Ad sets and campaigns still in Meta's learning phase are not judged (ads follow their own rules).
      if (subject.learning) continue;
      if (!(subject.m[7].spend > 0)) continue;
      const result = rule.check(subject, ctx);
      if (!result || result.conditions.length === 0) continue;
      if (!result.conditions.every((c) => c.ok)) continue;
      const key = `${subject.type}:${subject.id}`;
      if (!byEntity.has(key)) byEntity.set(key, { subject, hits: [] });
      byEntity.get(key).hits.push({ rule, conditions: result.conditions });
    }
  }

  const flags = [];
  function pushFlag(subject, action, winners, budgetTarget, budgetNote, hidden) {
    const parentCampaign = campaignById.get(subject.campaignId || (subject.type === "campaign" ? subject.id : null));
    const campaignName = subject.type === "campaign" ? null : parentCampaign?.name || extraNames[subject.campaignId] || null;
    const parentAdset = subject.type === "ad" ? adsetById.get(subject.adsetId) : null;
    // Shown on click for a pause suggestion: how many active ads share the ad set, and how much of the
    // ad set's spend this ad takes (3 and 7 days).
    let adContext = null;
    if (subject.type === "ad" && action === "PAUSE_AD") {
      const siblings = adsByAdset.get(subject.adsetId) || [];
      const shareOf = (w) => {
        const total = siblings.reduce((t, a) => t + a.m[w].spend, 0);
        return total > 0 ? (subject.m[w].spend / total) * 100 : null;
      };
      adContext = { activeAdsInAdset: siblings.length, spendShare: { 3: shareOf(3), 7: shareOf(7) } };
    }
    flags.push({
      adContext,
      key: `${subject.type}:${subject.id}`,
      entityType: subject.type,
      entityId: subject.id,
      name: subject.name,
      // Parents, so Custom Views can show a campaign / ad set that has flagged rows below it.
      campaignId: subject.type === "campaign" ? subject.id : subject.campaignId || null,
      adsetId: subject.type === "ad" ? subject.adsetId || null : null,
      campaignName,
      adsetName: subject.type === "ad" ? parentAdset?.name || extraNames[subject.adsetId] || null : null,
      action,
      budgetTarget,
      budgetNote,
      matchedRules: winners.map((h) => ({ id: h.rule.id, name: h.rule.name, text: h.rule.text, conditions: h.conditions })),
      hiddenConflicts: hidden,
      stats: {
        spend7: subject.m[7].spend,
        roas7: subject.m[7].roas,
        roas3: subject.m[3].roas,
        cpp7: subject.m[7].cpr,
        purchases7: subject.m[7].purchases,
      },
    });
  }

  const held = []; // budget suggestions skipped because that budget was edited in the last 48h
  for (const { subject, hits: allHits } of byEntity.values()) {
    // "Add a creative" is a different kind of suggestion from the budget / pause ones: it never competes with
    // them, and a flag that has only this is informational (nothing to apply with one click).
    const creativeHits = allHits.filter((h) => h.rule.action === "ADD_CREATIVE");
    const hits = allHits.filter((h) => h.rule.action !== "ADD_CREATIVE");
    if (hits.length === 0) {
      pushFlag(subject, "ADD_CREATIVE", creativeHits, null, null, []);
      continue;
    }
    // Opposite budget directions on one entity: the direction backed by the rule with
    // more conditions wins; a tie goes to the cautious (decrease) side. The loser is listed, not shown as a flag.
    const dirs = { INCREASE_BUDGET: [], DECREASE_BUDGET: [], PAUSE_AD: [] };
    for (const h of hits) dirs[h.rule.action].push(h);
    const strength = (list) => list.reduce((best, h) => Math.max(best, h.conditions.length), 0);
    let winnerAction = hits[0].rule.action;
    let hidden = [];
    if (dirs.INCREASE_BUDGET.length && dirs.DECREASE_BUDGET.length) {
      const inc = strength(dirs.INCREASE_BUDGET);
      const dec = strength(dirs.DECREASE_BUDGET);
      winnerAction = inc > dec ? "INCREASE_BUDGET" : "DECREASE_BUDGET";
      hidden = (winnerAction === "INCREASE_BUDGET" ? dirs.DECREASE_BUDGET : dirs.INCREASE_BUDGET).map((h) => h.rule.name);
    }
    const winners = dirs[winnerAction];

    // Which object a budget change would be applied to.
    let budgetTarget = null;
    let budgetNote = null;
    if (winnerAction !== "PAUSE_AD") {
      if (subject.type === "campaign" && subject.cbo) budgetTarget = { id: subject.id, level: "campaign", type: subject.budgetType, current: subject.budget, name: subject.name };
      else if (subject.type === "adset" && subject.abo) budgetTarget = { id: subject.id, level: "adset", type: subject.budgetType, current: subject.budget, name: subject.name };
      else if (subject.type === "adset") budgetNote = "This ad set has no budget of its own — it's set on the campaign (CBO).";
    }
    // Cool-down: don't suggest another budget move on something whose budget was just changed — the
    // ad set / campaign itself, the object the change would hit, or (for an ad set funded by its
    // campaign) that campaign.
    if (winnerAction !== "PAUSE_AD") {
      const ids = [subject.id, budgetTarget?.id, subject.type === "adset" && !subject.abo ? subject.campaignId : null].filter(Boolean);
      const changedId = ids.find((id) => recentChanged[id]);
      if (changedId) {
        held.push({
          key: `${subject.type}:${subject.id}`,
          entityType: subject.type,
          name: subject.name,
          action: winnerAction,
          changedAt: recentChanged[changedId],
          changedWhat: changedId === subject.id ? subject.type : "campaign",
          ruleNames: winners.map((h) => h.rule.name),
        });
        if (creativeHits.length) pushFlag(subject, "ADD_CREATIVE", creativeHits, null, null, []);
        continue;
      }
    }
    pushFlag(subject, winnerAction, [...winners, ...creativeHits], budgetTarget, budgetNote, hidden);
  }
  flags.sort((a, b) => b.stats.spend7 - a.stats.spend7);

  return {
    baseline: WINDOWS.map((w) => ({ days: w, spend: acc[w].spend, roas: acc[w].roas, cpr: acc[w].cpr, cpm: acc[w].cpm, ctr: acc[w].ctr })),
    counts: {
      campaigns: campaigns.length,
      adsets: adsets.length,
      ads: ads.length,
      // Active entities the rules did not judge because they are not optimized for purchases.
      // Eligible ad sets / campaigns held back because Meta still has them in the learning phase.
      learning: { campaigns: eligibleCampaigns.filter((c) => c.learning).length, adsets: eligibleAdsets.filter((a) => a.learning).length },
      skipped: { campaigns: campaigns.length - eligibleCampaigns.length, adsets: adsets.length - eligibleAdsets.length, ads: ads.filter((a) => !a.eligible).length },
    },
    flags,
    held,
    heldChecked: recentBudgetChanges ? recentBudgetChanges.ok : false,
    rulesChecked: RULES.map((r) => ({ id: r.id, name: r.name, level: r.level, action: r.action, text: r.text })),
  };
}
