// The account-validation rules, transcribed from the team's rules sheet ("Rough - Sheet88.csv").
// Thresholds live next to each rule so changing the sheet means changing one line here.
//
// A rule is { id, name, level, action, text, check(subject, ctx) }. `check` returns null when the
// rule doesn't apply to this subject, else { conditions } — the rule fires when every condition holds.
// `level` is the entity the flag is raised on: "adset" | "campaign" | "ad".
// `action`: INCREASE_BUDGET | DECREASE_BUDGET | PAUSE_AD.
//
// Interpretations of wording the sheet leaves open (also listed in the Rules tab):
//  - "account's ROAS" with no window → same window as the rest of that rule.
//  - Campaign rules saying "campaign spend > 1.4x account's spend" can never hold literally (a campaign
//    can't out-spend its account), so it is read as 1.4x the average active-campaign spend.
//  - CPM "greater than 40%" / CTR "less than 20%" of account → 1.4x / 0.2x the account figure.
//  - "highest/lowest spending" → by 7-day spend among active siblings.
//  - Budget-bucket spend share: 1%, or 2% when account 7-day spend is above ₹20 lakh.

import { priorOf3 } from "./metrics";

const LAKH = 100000;
export const BIG_ACCOUNT_7D_SPEND = 20 * LAKH;

const OPS = { gt: (a, b) => a > b, gte: (a, b) => a >= b, lt: (a, b) => a < b, lte: (a, b) => a <= b };
const OP_TEXT = { gt: ">", gte: "≥", lt: "<", lte: "≤" };

function fmt(value, kind, ctx) {
  if (value == null || !Number.isFinite(value)) return "—";
  switch (kind) {
    case "money":
      // Small amounts (CPC, CPM, CPR) keep their paise so "₹13 < ₹13" can't happen.
      return `${ctx.currencySymbol}${Math.abs(value) < 100 ? value.toFixed(2) : Math.round(value).toLocaleString("en-IN")}`;
    case "pct":
      return `${value.toFixed(2)}%`;
    case "int":
      return String(Math.round(value));
    case "ratio":
      return `${Math.round(value * 100)}%`;
    default:
      return value.toFixed(2);
  }
}

// One condition: `label` says what is compared, actual/target are shown side by side.
// `hint` is an optional plain-English line shown under the label. Without one, a label like
// "7-day ROAS < 80% of account" gets an automatic hint spelling out the account figure it is based on.
const METRIC_KEYS = { ROAS: ["roas", "num"], CPM: ["cpm", "money"], CTR: ["ctr", "pct"], CPR: ["cpr", "money"], "conversion rate": ["cvr", "pct"] };
function autoHint(ctx, label, target, kind) {
  if (!/(%|×) (of )?account/.test(label)) return "";
  const days = label.match(/(\d+)-day/);
  const metric = [...label.matchAll(/(ROAS|CPM|CTR|CPR|conversion rate)/g)].pop()?.[1];
  const key = metric && METRIC_KEYS[metric];
  const base = days && key ? ctx.acc[days[1]]?.[key[0]] : null;
  if (base == null) return "";
  return `The account's ${days[1]}-day ${metric} is ${fmt(base, key[1], ctx)}, so the limit works out to ${fmt(target, kind, ctx)}.`;
}
export function cond(ctx, label, actual, op, target, kind = "num", hint = "") {
  const ok = actual != null && target != null && Number.isFinite(actual) && Number.isFinite(target) && OPS[op](actual, target);
  return { label, ok, actual: fmt(actual, kind, ctx), op: OP_TEXT[op], target: fmt(target, kind, ctx), hint: hint || autoHint(ctx, label, target, kind) };
}
export function flag(label, ok, detail = "", hint = "") {
  return { label, ok: !!ok, actual: ok ? "yes" : "no", op: "", target: detail, hint };
}

const times = (x, n) => (x == null ? null : x * n);
const share = (ctx) => (ctx.acc[7].spend > BIG_ACCOUNT_7D_SPEND ? 0.02 : 0.01);

// Top/bottom N by 7-day spend among a list of {m} metric holders.
function rankBySpend7(list) {
  return [...list].sort((a, b) => b.m[7].spend - a.m[7].spend);
}

function allWindowsBeatAccount(ctx, s, label) {
  return [30, 14, 7, 3].map((w) => cond(ctx, `${label} ${w}-day ROAS vs account`, s.m[w].roas, "gt", ctx.acc[w].roas));
}


// Spend of an ad set's active ads over the last 3 days, highest first. `null` when nothing was spent
// (every ratio below is then "no data", never a match).
function adSpend3(ctx, adset) {
  const spends = ctx.adsOfAdset(adset.id).map((a) => a.m[3].spend).sort((a, b) => b - a);
  const total = spends.reduce((t, v) => t + v, 0);
  return { spends, total: total > 0 ? total : null };
}

// Extra gate on the "New creative" rules: the ad set is slipping — its last 3 days cost at least 10% more per link click, or
// click through at least 10% less, than the days just before them (4–7 days ago). Either one is enough.
function recentVsPrior(ctx, s) {
  const prior = priorOf3(s.m);
  const cpcHigher = s.m[3].cpc != null && prior.cpc != null && s.m[3].cpc >= prior.cpc * 1.1;
  const ctrLower = s.m[3].ctr != null && prior.ctr != null && s.m[3].ctr <= prior.ctr * 0.9;
  const money = (v) => (v == null ? "—" : `${ctx.currencySymbol}${v.toFixed(2)}`);
  const pct = (v) => (v == null ? "—" : `${v.toFixed(2)}%`);
  return flag(
    "3-day CPC ≥10% higher, or CTR ≥10% lower, than days 4–7",
    cpcHigher || ctrLower,
    `CPC ${money(s.m[3].cpc)} vs ${money(prior.cpc)}; CTR ${pct(s.m[3].ctr)} vs ${pct(prior.ctr)}`
  );
}

export const RULES = [
  // Room for a new creative: the ad set's spend is stacked on too few ads. "Share" is of the ad set's 3-day ad spend.
  {
    id: "new-creative-01",
    name: "New creative -01",
    level: "adset",
    action: "ADD_CREATIVE",
    text: "Ad set has more than 5 active ads, its lowest-spending half takes less than 30% of the ad set's 3-day spend, and its 3-day CPC is at least 10% higher or its 3-day CTR at least 10% lower than in days 4–7.",
    check: (s, ctx) => {
      const { spends, total } = adSpend3(ctx, s);
      const n = spends.length;
      const lowest = spends.slice(n - Math.floor(n / 2)).reduce((t, v) => t + v, 0);
      return {
        conditions: [
          cond(ctx, "Active ads > 5", n, "gt", 5, "int"),
          cond(ctx, "Lowest 50% of ads take < 30% of 3-day spend", total ? (lowest / total) * 100 : null, "lt", 30, "pct"),
          recentVsPrior(ctx, s),
        ],
      };
    },
  },
  {
    id: "new-creative-02",
    name: "New creative -02",
    level: "adset",
    action: "ADD_CREATIVE",
    text: "Ad set has 2 to 5 active ads, its top 2 ads take more than 70% of the ad set's 3-day spend, and its 3-day CPC is at least 10% higher or its 3-day CTR at least 10% lower than in days 4–7.",
    check: (s, ctx) => {
      const { spends, total } = adSpend3(ctx, s);
      const top2 = spends.slice(0, 2).reduce((t, v) => t + v, 0);
      return {
        conditions: [
          cond(ctx, "Active ads ≥ 2", spends.length, "gte", 2, "int"),
          cond(ctx, "Active ads ≤ 5", spends.length, "lte", 5, "int"),
          cond(ctx, "Top 2 ads take > 70% of 3-day spend", total ? (top2 / total) * 100 : null, "gt", 70, "pct"),
          recentVsPrior(ctx, s),
        ],
      };
    },
  },
  {
    id: "new-creative-03",
    name: "New creative -03",
    level: "adset",
    action: "ADD_CREATIVE",
    text: "Ad set has only 1 active ad, and its 3-day CPC is at least 10% higher or its 3-day CTR at least 10% lower than in days 4–7.",
    check: (s, ctx) => {
      const n = ctx.adsOfAdset(s.id).length;
      return { conditions: [cond(ctx, "Active ads = 1", n, "gte", 1, "int"), cond(ctx, "Only 1 active ad", n, "lte", 1, "int"), recentVsPrior(ctx, s)] };
    },
  },
  {
    id: "adset-scale-01",
    name: "Adset scale -01",
    level: "adset",
    action: "INCREASE_BUDGET",
    text: "Ad set budget (ABO). Ad set 3-day and 7-day ROAS are each ≥ 1.4× the account's.",
    check: (s, ctx) => {
      if (!s.abo) return null;
      return {
        conditions: [
          cond(ctx, "3-day ROAS ≥ 1.4× account", s.m[3].roas, "gte", times(ctx.acc[3].roas, 1.4)),
          cond(ctx, "7-day ROAS ≥ 1.4× account", s.m[7].roas, "gte", times(ctx.acc[7].roas, 1.4)),
        ],
      };
    },
  },
  {
    id: "adset-abo-scale-02",
    name: "Adset ABO scale -02",
    level: "adset",
    action: "INCREASE_BUDGET",
    text: "Ad set budget (ABO). 7-day spend < 1% of account's (2% above ₹20 lakh). ROAS beats the account's over 30, 14, 7 and 3 days.",
    check: (s, ctx) => {
      if (!s.abo) return null;
      return {
        conditions: [
          cond(ctx, `7-day spend < ${share(ctx) * 100}% of account`, s.m[7].spend, "lt", ctx.acc[7].spend * share(ctx), "money"),
          ...allWindowsBeatAccount(ctx, s, "Ad set"),
        ],
      };
    },
  },
  {
    id: "adset-scale-abo-03",
    name: "Adset Scale ABO -03",
    level: "adset",
    action: "INCREASE_BUDGET",
    text: "Ad set budget (ABO). 3-day ROAS > 120% of account's; 7-day ROAS > account's; 7-day spend > 4× account's 7-day CPR.",
    check: (s, ctx) => {
      if (!s.abo) return null;
      return {
        conditions: [
          cond(ctx, "3-day ROAS > 120% of account", s.m[3].roas, "gt", times(ctx.acc[3].roas, 1.2)),
          cond(ctx, "7-day ROAS > account", s.m[7].roas, "gt", ctx.acc[7].roas),
          cond(ctx, "7-day spend > 4× account CPR", s.m[7].spend, "gt", times(ctx.acc[7].cpr, 4), "money"),
        ],
      };
    },
  },
  {
    id: "adset-scale-04",
    name: "Adset scale -04",
    level: "adset",
    action: "INCREASE_BUDGET",
    text: "Ad set budget (ABO). Highest-spending ad set in its campaign; 7-day ROAS ≥ 1.4× account's.",
    check: (s, ctx) => {
      if (!s.abo) return null;
      const top = rankBySpend7(ctx.adsetsOfCampaign(s.campaignId))[0];
      return {
        conditions: [
          flag("Highest-spending ad set in its campaign", top && top.id === s.id),
          cond(ctx, "7-day ROAS ≥ 1.4× account", s.m[7].roas, "gte", times(ctx.acc[7].roas, 1.4)),
        ],
      };
    },
  },
  {
    id: "adset-scale-05",
    name: "Adset scale -5",
    level: "adset",
    action: "INCREASE_BUDGET",
    text: "At least half of the ad set's ads have 7-day ROAS ≥ 1.4× account's, spend > 3× account CPR and more than 5 purchases; and the ad set's 7-day ROAS > account's.",
    check: (s, ctx) => {
      const ads = ctx.adsOfAdset(s.id);
      if (ads.length === 0) return null;
      const good = ads.filter(
        (a) =>
          a.m[7].roas != null &&
          ctx.acc[7].roas != null &&
          a.m[7].roas >= ctx.acc[7].roas * 1.4 &&
          ctx.acc[7].cpr != null &&
          a.m[7].spend > ctx.acc[7].cpr * 3 &&
          a.m[7].purchases > 5
      );
      return {
        conditions: [
          cond(ctx, "Share of this ad set's ads that meet the ad-level bar", good.length / ads.length, "gte", 0.5, "ratio", `${good.length} of ${ads.length} ads have 7-day ROAS at least 1.4× the account's, spend above 3× the account's cost per result, and more than 5 purchases.`),
          cond(ctx, "Ad set 7-day ROAS > account", s.m[7].roas, "gt", ctx.acc[7].roas),
        ],
      };
    },
  },
  {
    id: "adset-descale-01",
    name: "Descale adset -01",
    level: "adset",
    action: "DECREASE_BUDGET",
    text: "More than 3 active ads; ad set 7-day spend > 0; the top 30% of ads take ≥ 60% of the ad set's spend; ad set 7-day ROAS < 80% of account's.",
    check: (s, ctx) => {
      const ads = ctx.adsOfAdset(s.id);
      const ranked = rankBySpend7(ads);
      const topN = Math.max(1, Math.ceil(ranked.length * 0.3));
      const topSpend = ranked.slice(0, topN).reduce((t, a) => t + a.m[7].spend, 0);
      return {
        conditions: [
          cond(ctx, "Number of active ads in this ad set", ads.length, "gt", 3, "int", "Ads currently running inside this ad set."),
          cond(ctx, "Money this ad set spent in the last 7 days", s.m[7].spend, "gt", 0, "money", "It must have spent something in the last 7 days."),
          cond(ctx, "Share of the ad set's spend taken by its top 30% of ads", s.m[7].spend > 0 ? topSpend / s.m[7].spend : null, "gte", 0.6, "ratio", `Ranking this ad set's ads by 7-day spend, the top ${topN} of ${ads.length} ads took ${s.m[7].spend > 0 ? Math.round((topSpend / s.m[7].spend) * 100) : 0}% of its spend.`),
          cond(ctx, "7-day ROAS < 80% of account", s.m[7].roas, "lt", times(ctx.acc[7].roas, 0.8)),
        ],
      };
    },
  },
  {
    id: "adset-descale-02",
    name: "Descale adset -02",
    level: "adset",
    action: "DECREASE_BUDGET",
    text: "Among the account's top 30% highest-spending ad sets; 7-day ROAS < 0.8× account's.",
    check: (s, ctx) => {
      const ranked = rankBySpend7(ctx.activeAdsets);
      const topN = Math.max(1, Math.ceil(ranked.length * 0.3));
      return {
        conditions: [
          flag("In the account's top 30% of ad sets by 7-day spend", ranked.slice(0, topN).some((a) => a.id === s.id), `#${ranked.findIndex((a) => a.id === s.id) + 1} of ${ranked.length}`, `Active ad sets ranked by 7-day spend; the top ${topN} of ${ranked.length} count as "top 30%".`),
          cond(ctx, "7-day ROAS < 0.8× account", s.m[7].roas, "lt", times(ctx.acc[7].roas, 0.8)),
        ],
      };
    },
  },
  {
    id: "campaign-budget-increase",
    name: "Campaign budget Increase",
    level: "campaign",
    action: "INCREASE_BUDGET",
    text: "7-day spend > 1.4× the average campaign; 7-day ROAS > 80% of account's; 7-day ROAS > 14-day > 30-day.",
    check: (s, ctx) => {
      if (!s.cbo) return null;
      return {
        conditions: [
          cond(ctx, "7-day spend > 1.4× average campaign", s.m[7].spend, "gt", ctx.avgCampaignSpend7 * 1.4, "money", `The average active campaign spent ${fmt(ctx.avgCampaignSpend7, "money", ctx)} in 7 days; the bar is 1.4× that.`),
          cond(ctx, "7-day ROAS > 80% of account", s.m[7].roas, "gt", times(ctx.acc[7].roas, 0.8)),
          cond(ctx, "7-day ROAS > 14-day ROAS", s.m[7].roas, "gt", s.m[14].roas),
          cond(ctx, "14-day ROAS > 30-day ROAS", s.m[14].roas, "gt", s.m[30].roas),
        ],
      };
    },
  },
  {
    id: "campaign-descale",
    name: "Campaign Descale",
    level: "campaign",
    action: "DECREASE_BUDGET",
    text: "7-day spend > 1.4× the average campaign; 7-day ROAS < 80% of account's; 7-day ROAS < 14-day; 14-day ROAS > 30-day.",
    check: (s, ctx) => {
      if (!s.cbo) return null;
      return {
        conditions: [
          cond(ctx, "7-day spend > 1.4× average campaign", s.m[7].spend, "gt", ctx.avgCampaignSpend7 * 1.4, "money", `The average active campaign spent ${fmt(ctx.avgCampaignSpend7, "money", ctx)} in 7 days; the bar is 1.4× that.`),
          cond(ctx, "7-day ROAS < 80% of account", s.m[7].roas, "lt", times(ctx.acc[7].roas, 0.8)),
          cond(ctx, "7-day ROAS < 14-day ROAS", s.m[7].roas, "lt", s.m[14].roas),
          cond(ctx, "14-day ROAS > 30-day ROAS", s.m[14].roas, "gt", s.m[30].roas),
        ],
      };
    },
  },
  {
    id: "campaign-scale-02",
    name: "Campaign scale -02",
    level: "campaign",
    action: "INCREASE_BUDGET",
    text: "7-day spend > 20% of the median campaign's; 7-day ROAS > 14-day > 30-day.",
    check: (s, ctx) => {
      if (!s.cbo) return null;
      return {
        conditions: [
          cond(ctx, "7-day spend > 20% of median campaign", s.m[7].spend, "gt", ctx.medianCampaignSpend7 * 0.2, "money", `The middle (median) active campaign spent ${fmt(ctx.medianCampaignSpend7, "money", ctx)} in 7 days; the bar is 20% of that.`),
          cond(ctx, "7-day ROAS > 14-day ROAS", s.m[7].roas, "gt", s.m[14].roas),
          cond(ctx, "14-day ROAS > 30-day ROAS", s.m[14].roas, "gt", s.m[30].roas),
        ],
      };
    },
  },
  {
    id: "scale-cbo-02",
    name: "Scale CBO-02",
    level: "campaign",
    action: "INCREASE_BUDGET",
    text: "Campaign budget (CBO). Its highest-spending ad set has 7-day ROAS ≥ 1.4× account's.",
    check: (s, ctx) => {
      if (!s.cbo) return null;
      const top = rankBySpend7(ctx.adsetsOfCampaign(s.id))[0];
      if (!top) return null;
      return { conditions: [cond(ctx, `Top ad set (${top.name}) 7-day ROAS ≥ 1.4× account`, top.m[7].roas, "gte", times(ctx.acc[7].roas, 1.4))] };
    },
  },
  {
    id: "scale-cbo-03",
    name: "Scale CBO -03",
    level: "campaign",
    action: "INCREASE_BUDGET",
    text: "Campaign budget (CBO). It has an ad set in the account's lowest 30% by spend whose 7-day ROAS ≥ 1.4× account's.",
    check: (s, ctx) => {
      if (!s.cbo) return null;
      const ranked = rankBySpend7(ctx.activeAdsets);
      const lowN = Math.max(1, Math.ceil(ranked.length * 0.3));
      const low = new Set(ranked.slice(-lowN).map((a) => a.id));
      const hit = ctx.adsetsOfCampaign(s.id).filter((a) => low.has(a.id) && a.m[7].roas != null && ctx.acc[7].roas != null && a.m[7].roas >= ctx.acc[7].roas * 1.4);
      return { conditions: [flag("Has a low-spend ad set with 7-day ROAS ≥ 1.4× account", hit.length > 0, hit.map((a) => a.name).join(", "))] };
    },
  },
  {
    id: "scale-cbo-01",
    name: "Scale CBO-1",
    level: "campaign",
    action: "INCREASE_BUDGET",
    text: "Campaign budget (CBO). The top half of its ad sets by spend each have 7-day spend < 1% of account (2% above ₹20 lakh) and ROAS above account's over 30, 14, 7 and 3 days.",
    check: (s, ctx) => {
      if (!s.cbo) return null;
      const ranked = rankBySpend7(ctx.adsetsOfCampaign(s.id));
      if (ranked.length === 0) return null;
      const top = ranked.slice(0, Math.max(1, Math.ceil(ranked.length * 0.5)));
      const limit = ctx.acc[7].spend * share(ctx);
      const okAdsets = top.filter(
        (a) => a.m[7].spend < limit && [30, 14, 7, 3].every((w) => a.m[w].roas != null && ctx.acc[w].roas != null && a.m[w].roas > ctx.acc[w].roas)
      );
      return {
        conditions: [cond(ctx, "Share of this campaign's top-half ad sets that meet the bar", okAdsets.length / top.length, "gte", 1, "ratio", `${okAdsets.length} of ${top.length} top ad sets have 7-day spend under ${fmt(limit, "money", ctx)} (${share(ctx) * 100}% of account spend) and ROAS above the account's over 30, 14, 7 and 3 days. All of them must.`)],
      };
    },
  },
  {
    id: "pause-ad-05",
    name: "Pause ad -05",
    level: "ad",
    action: "PAUSE_AD",
    text: "3-day and 7-day ROAS < 80% of account's; 3-day CPC (link click) > 7-day CPC; 7-day spend > 4× account's 7-day CPR.",
    check: (s, ctx) => ({
      conditions: [
        cond(ctx, "3-day ROAS < 80% of account", s.m[3].roas, "lt", times(ctx.acc[3].roas, 0.8)),
        cond(ctx, "7-day ROAS < 80% of account", s.m[7].roas, "lt", times(ctx.acc[7].roas, 0.8)),
        cond(ctx, "3-day CPC > 7-day CPC", s.m[3].cpc, "gt", s.m[7].cpc, "money"),
        cond(ctx, "7-day spend > 4× account CPR", s.m[7].spend, "gt", times(ctx.acc[7].cpr, 4), "money"),
      ],
    }),
  },
  {
    id: "pause-ad-06",
    name: "Pause Ad -06",
    level: "ad",
    action: "PAUSE_AD",
    text: "7-day CPM ≥ 1.4× account's; 7-day CTR < 20% of account's; 7-day spend ≥ 3× account CPR; fewer than 50 purchases in 7 days.",
    check: (s, ctx) => ({
      conditions: [
        cond(ctx, "7-day CPM ≥ 1.4× account", s.m[7].cpm, "gte", times(ctx.acc[7].cpm, 1.4), "money"),
        cond(ctx, "7-day CTR < 20% of account", s.m[7].ctr, "lt", times(ctx.acc[7].ctr, 0.2), "pct"),
        cond(ctx, "7-day spend ≥ 3× account CPR", s.m[7].spend, "gte", times(ctx.acc[7].cpr, 3), "money"),
        cond(ctx, "7-day purchases < 50", s.m[7].purchases, "lt", 50, "int"),
      ],
    }),
  },
  {
    id: "pause-ad-1",
    name: "Pause Ad -1",
    level: "ad",
    action: "PAUSE_AD",
    text: "3-day and 7-day ROAS < 80% of account's; 3-day ROAS < the ad's own 7-day ROAS; 3-day spend > 25% of the ad set's; 3-day spend > 3× account CPR; 7-day spend > 4× account CPR.",
    check: (s, ctx) => {
      const adset = ctx.adsetById(s.adsetId);
      return {
        conditions: [
          cond(ctx, "3-day ROAS < 80% of account", s.m[3].roas, "lt", times(ctx.acc[3].roas, 0.8)),
          cond(ctx, "7-day ROAS < 80% of account", s.m[7].roas, "lt", times(ctx.acc[7].roas, 0.8)),
          cond(ctx, "3-day ROAS < own 7-day ROAS", s.m[3].roas, "lt", s.m[7].roas),
          cond(ctx, "3-day spend > 25% of ad set's", s.m[3].spend, "gt", adset ? adset.m[3].spend * 0.25 : null, "money"),
          cond(ctx, "3-day spend > 3× account CPR", s.m[3].spend, "gt", times(ctx.acc[3].cpr, 3), "money"),
          cond(ctx, "7-day spend > 4× account CPR", s.m[7].spend, "gt", times(ctx.acc[7].cpr, 4), "money"),
        ],
      };
    },
  },
  {
    id: "pause-ad-2",
    name: "Pause Ad 2",
    level: "ad",
    action: "PAUSE_AD",
    text: "3-day and 7-day ROAS < 80% of account's; 7-day spend > 3× account's 7-day CPR.",
    check: (s, ctx) => ({
      conditions: [
        cond(ctx, "3-day ROAS < 80% of account", s.m[3].roas, "lt", times(ctx.acc[3].roas, 0.8)),
        cond(ctx, "7-day ROAS < 80% of account", s.m[7].roas, "lt", times(ctx.acc[7].roas, 0.8)),
        cond(ctx, "7-day spend > 3× account CPR", s.m[7].spend, "gt", times(ctx.acc[7].cpr, 3), "money"),
      ],
    }),
  },
  {
    id: "pause-ad-3",
    name: "Pause ad -3",
    level: "ad",
    action: "PAUSE_AD",
    text: "7-day conversion rate < 50% of account's; 7-day ROAS < account's; 7-day spend ≥ 3× account CPR; fewer than 50 purchases in 7 days.",
    check: (s, ctx) => ({
      conditions: [
        cond(ctx, "7-day conversion rate < 50% of account", s.m[7].cvr, "lt", times(ctx.acc[7].cvr, 0.5), "pct"),
        cond(ctx, "7-day ROAS < account", s.m[7].roas, "lt", ctx.acc[7].roas),
        cond(ctx, "7-day spend ≥ 3× account CPR", s.m[7].spend, "gte", times(ctx.acc[7].cpr, 3), "money"),
        cond(ctx, "7-day purchases < 50", s.m[7].purchases, "lt", 50, "int"),
      ],
    }),
  },
  {
    id: "pause-4",
    name: "Pause -4",
    level: "ad",
    action: "PAUSE_AD",
    text: "3-day and 7-day ROAS < 80% of account's; 3-day ROAS > the ad's own 7-day ROAS; 7-day spend > 4× account CPR.",
    check: (s, ctx) => ({
      conditions: [
        cond(ctx, "3-day ROAS < 80% of account", s.m[3].roas, "lt", times(ctx.acc[3].roas, 0.8)),
        cond(ctx, "7-day ROAS < 80% of account", s.m[7].roas, "lt", times(ctx.acc[7].roas, 0.8)),
        cond(ctx, "3-day ROAS > own 7-day ROAS", s.m[3].roas, "gt", s.m[7].roas),
        cond(ctx, "7-day spend > 4× account CPR", s.m[7].spend, "gt", times(ctx.acc[7].cpr, 4), "money"),
      ],
    }),
  },
];
