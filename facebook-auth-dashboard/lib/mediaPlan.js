// Media plan maths, the same formulae as the "Media Plan" sheet of the Studio Bagru performance report. A plan starts from
// a budget and eight assumptions, and everything else follows from them:
//
//   clicks      = cost / CPC                  impressions = clicks / CTR            CPM = cost / impressions * 1000
//   LP views    = clicks * click->LPV         ATC         = clicks * click->ATC     checkouts = ATC * ATC->checkout
//   purchases   = checkouts * checkout->purchase                                    revenue = purchases * AOV
//   ROAS = revenue / cost    CPP = cost / purchases    CVR = purchases / clicks
//
// The assumptions are the account's own averages over the months given (totals added up first, then divided, so a busy
// month counts for more than a quiet one). Pure functions: no fetching, no rounding.

const div = (a, b) => (b > 0 && Number.isFinite(a) && Number.isFinite(b) ? a / b : null);

export const ASSUMPTION_KEYS = ["ctr", "cpc", "clickToLpv", "clickToAtc", "atcToIc", "icToPur", "aov"];

/** Adds up month rows of raw totals: { spend, impressions, linkClicks, lpv, atc, ic, purchases, revenue }. */
export function sumMonths(months) {
  const t = { spend: 0, impressions: 0, linkClicks: 0, lpv: 0, atc: 0, ic: 0, purchases: 0, revenue: 0 };
  for (const m of months || []) for (const k of Object.keys(t)) t[k] += Number(m[k]) || 0;
  return t;
}

/** The plan's assumptions from raw totals (null where the account has no data for that step). */
export function assumptionsFromTotals(t) {
  return {
    ctr: div(t.linkClicks, t.impressions),
    cpc: div(t.spend, t.linkClicks),
    clickToLpv: div(t.lpv, t.linkClicks),
    clickToAtc: div(t.atc, t.linkClicks),
    atcToIc: div(t.ic, t.atc),
    icToPur: div(t.purchases, t.ic),
    aov: div(t.revenue, t.purchases),
  };
}

/** One plan row from a cost and the assumptions. Anything that cannot be worked out is null. */
export function computePlan(cost, a) {
  const clicks = div(cost, a.cpc);
  const impressions = div(clicks, a.ctr);
  const lpv = clicks != null && a.clickToLpv != null ? clicks * a.clickToLpv : null;
  const atc = clicks != null && a.clickToAtc != null ? clicks * a.clickToAtc : null;
  const ic = atc != null && a.atcToIc != null ? atc * a.atcToIc : null;
  const purchases = ic != null && a.icToPur != null ? ic * a.icToPur : null;
  const revenue = purchases != null && a.aov != null ? purchases * a.aov : null;
  return {
    cost, impressions, clicks, ctr: a.ctr, cpc: a.cpc,
    cpm: impressions != null ? (cost / impressions) * 1000 : null,
    lpv, clickToLpv: a.clickToLpv, atc, clickToAtc: a.clickToAtc, ic, atcToIc: a.atcToIc, icToPur: a.icToPur,
    purchases, revenue, aov: a.aov,
    roas: revenue != null ? div(revenue, cost) : null,
    cpp: purchases != null ? div(cost, purchases) : null,
    cvr: purchases != null ? div(purchases, clicks) : null,
  };
}

/**
 * The Total row: amounts added up, every ratio worked out again from the sums (as the sheet does). Accounts that have no
 * data to plan from (no results can be worked out) are left out of the results and of the ratios, but their cost still
 * counts in the cost column, so it matches the budget.
 */
export function totalPlan(rows) {
  const ok = rows.filter((r) => r.purchases != null && r.impressions != null);
  const add = (k) => (ok.length ? ok.reduce((t, r) => t + r[k], 0) : null);
  const cost = rows.reduce((t, r) => t + (r.cost || 0), 0);
  const costOk = ok.reduce((t, r) => t + (r.cost || 0), 0);
  const impressions = add("impressions"); const clicks = add("clicks"); const lpv = add("lpv"); const atc = add("atc");
  const ic = add("ic"); const purchases = add("purchases"); const revenue = add("revenue");
  const r = (a, b) => (a != null && b != null ? div(a, b) : null);
  return {
    cost, impressions, clicks, ctr: r(clicks, impressions), cpc: r(costOk, clicks), cpm: impressions ? (costOk / impressions) * 1000 : null,
    lpv, clickToLpv: r(lpv, clicks), atc, clickToAtc: r(atc, clicks), ic, atcToIc: r(ic, atc), icToPur: r(purchases, ic),
    purchases, revenue, aov: r(revenue, purchases), roas: r(revenue, costOk), cpp: r(costOk, purchases), cvr: r(purchases, clicks),
  };
}

/** Splits a total budget across accounts: by each one's share of past spend, or equally. Whole-rupee amounts that add up exactly. */
export function splitBudget(total, accounts, mode) {
  const n = accounts.length;
  if (!n) return [];
  const pastTotal = accounts.reduce((t, a) => t + (a.pastSpend || 0), 0);
  const weights = mode === "spend" && pastTotal > 0 ? accounts.map((a) => (a.pastSpend || 0) / pastTotal) : accounts.map(() => 1 / n);
  const out = weights.map((w) => Math.floor(total * w));
  out[0] += Math.round(total) - out.reduce((x, y) => x + y, 0); // the leftover rupees go to the first one
  return out;
}

/** The last `count` full calendar months before `now`, oldest first, as { key: "2026-09", since, until }. */
export function lastFullMonths(now = new Date(), count = 3) {
  const out = [];
  for (let i = count; i >= 1; i--) {
    const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0));
    const iso = (d) => d.toISOString().slice(0, 10);
    out.push({ key: iso(first).slice(0, 7), since: iso(first), until: iso(last) });
  }
  return out;
}
