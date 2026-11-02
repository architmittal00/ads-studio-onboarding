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

const LAKH = 100000;
export const BIG_ACCOUNT_7D_SPEND = 20 * LAKH;

const OPS = { gt: (a, b) => a > b, gte: (a, b) => a >= b, lt: (a, b) => a < b, lte: (a, b) => a <= b };
const OP_TEXT = { gt: ">", gte: "≥", lt: "<", lte: "≤" };

function fmt(value, kind, ctx) {
  if (value == null || !Number.isFinite(value)) return "—";
  switch (kind) {
    case "money":
      return `${ctx.currencySymbol}${Math.round(value).toLocaleString("en-IN")}`;
    case "pct":
      return `${value.toFixed(2)}%`;
    case "int":
      return String(Math.round(value));
    default:
      return value.toFixed(2);
  }
}

// One condition: `label` says what is compared, actual/target are shown side by side.
export function cond(ctx, label, actual, op, target, kind = "num") {
  const ok = actual != null && target != null && Number.isFinite(actual) && Number.isFinite(target) && OPS[op](actual, target);
  return { label, ok, actual: fmt(actual, kind, ctx), op: OP_TEXT[op], target: fmt(target, kind, ctx) };
}
export function flag(label, ok, detail = "") {
  return { label, ok: !!ok, actual: ok ? "yes" : "no", op: "", target: detail };
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

export const RULES = [
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
    text: "Ad set budget (ABO). 3-day ROAS > 80% of account's; 7-day ROAS > account's; 7-day spend > 4× account's 7-day CPR.",
    check: (s, ctx) => {
      if (!s.abo) return null;
      return {
        conditions: [
          cond(ctx, "3-day ROAS > 80% of account", s.m[3].roas, "gt", times(ctx.acc[3].roas, 0.8)),
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
          cond(ctx, "Ads meeting the bar (of ad set's ads)", good.length / ads.length, "gte", 0.5, "num"),
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
          cond(ctx, "Active ads in ad set", ads.length, "gt", 3, "int"),
          cond(ctx, "7-day ad set spend", s.m[7].spend, "gt", 0, "money"),
          cond(ctx, "Spend share of the top 30% of ads", s.m[7].spend > 0 ? topSpend / s.m[7].spend : null, "gte", 0.6, "num"),
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
    text: "Among the account's top 30% highest-spending ad sets; 7-day ROAS < 1.4× account's.",
    check: (s, ctx) => {
      const ranked = rankBySpend7(ctx.activeAdsets);
      const topN = Math.max(1, Math.ceil(ranked.length * 0.3));
      return {
        conditions: [
          flag("In the account's top 30% by 7-day spend", ranked.slice(0, topN).some((a) => a.id === s.id)),
          cond(ctx, "7-day ROAS < 1.4× account", s.m[7].roas, "lt", times(ctx.acc[7].roas, 1.4)),
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
          cond(ctx, "7-day spend > 1.4× average campaign", s.m[7].spend, "gt", ctx.avgCampaignSpend7 * 1.4, "money"),
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
          cond(ctx, "7-day spend > 1.4× average campaign", s.m[7].spend, "gt", ctx.avgCampaignSpend7 * 1.4, "money"),
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
          cond(ctx, "7-day spend > 20% of median campaign", s.m[7].spend, "gt", ctx.medianCampaignSpend7 * 0.2, "money"),
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
        conditions: [cond(ctx, `Top-half ad sets meeting the bar (limit ${share(ctx) * 100}% of account spend)`, okAdsets.length / top.length, "gte", 1, "num")],
      };
    },
  },
  {
    id: "pause-ad-05",
    name: "Pause ad -05",
    level: "ad",
    action: "PAUSE_AD",
    text: "3-day and 7-day ROAS < 80% of account's; 3-day CPC < 7-day CPC; 7-day spend > 4× account's 7-day CPR.",
    check: (s, ctx) => ({
      conditions: [
        cond(ctx, "3-day ROAS < 80% of account", s.m[3].roas, "lt", times(ctx.acc[3].roas, 0.8)),
        cond(ctx, "7-day ROAS < 80% of account", s.m[7].roas, "lt", times(ctx.acc[7].roas, 0.8)),
        cond(ctx, "3-day CPC < 7-day CPC", s.m[3].cpc, "lt", s.m[7].cpc, "money"),
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
    text: "3-day and 7-day ROAS < 80% of account's; 7-day spend < 3× account's 7-day CPR.",
    check: (s, ctx) => ({
      conditions: [
        cond(ctx, "3-day ROAS < 80% of account", s.m[3].roas, "lt", times(ctx.acc[3].roas, 0.8)),
        cond(ctx, "7-day ROAS < 80% of account", s.m[7].roas, "lt", times(ctx.acc[7].roas, 0.8)),
        cond(ctx, "7-day spend < 3× account CPR", s.m[7].spend, "lt", times(ctx.acc[7].cpr, 3), "money"),
      ],
    }),
  },
  {
    id: "pause-ad-3",
    name: "Pause ad -3",
    level: "ad",
    action: "PAUSE_AD",
    text: "7-day conversion rate < 50% of account's; 7-day spend ≥ 3× account CPR; fewer than 50 purchases in 7 days.",
    check: (s, ctx) => ({
      conditions: [
        cond(ctx, "7-day conversion rate < 50% of account", s.m[7].cvr, "lt", times(ctx.acc[7].cvr, 0.5), "pct"),
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
