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

// ── Trends, projection and last year ──

const KEYS = ASSUMPTION_KEYS;
const FLAT = 0.02; // a month-on-month change smaller than this is "flat"
const CLAMP = 0.3; // a projection never moves more than 30% away from the 3-month average

/** Months from "2026-08" to "2026-12" (4). */
export function monthDiff(fromKey, toKey) {
  const [fy, fm] = fromKey.split("-").map(Number);
  const [ty, tm] = toKey.split("-").map(Number);
  return (ty - fy) * 12 + (tm - fm);
}

/** "2026-12" -> "2025-12" */
export function sameMonthLastYear(key) {
  return `${Number(key.slice(0, 4)) - 1}${key.slice(4)}`;
}

/** The next `count` months starting with next month (the default plan month), as [{ key, label }]. */
export function planMonthOptions(now = new Date(), count = 6) {
  const names = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1 + i, 1));
    return { key: d.toISOString().slice(0, 7), label: `${names[d.getUTCMonth()]} ${d.getUTCFullYear()}${i === 0 ? " (next month)" : ""}` };
  });
}

/** Straight-line fit through [{t, y}] points; null with fewer than two. */
function fitLine(points) {
  const n = points.length;
  if (n < 2) return null;
  const mt = points.reduce((s, p) => s + p.t, 0) / n;
  const my = points.reduce((s, p) => s + p.y, 0) / n;
  const den = points.reduce((s, p) => s + (p.t - mt) ** 2, 0);
  if (!den) return null;
  const slope = points.reduce((s, p) => s + (p.t - mt) * (p.y - my), 0) / den;
  return { slope, intercept: my - slope * mt, mean: my };
}

/**
 * The assumptions for a plan month, with what led to them.
 *   months:  the recent month rows of raw totals (oldest first, each with `month: "2026-08"`)
 *   planKey: the month being planned, "2026-12"
 *   method:  "avg" (all months added up), "trend" (the month-by-month movement carried forward to the plan month) or
 *            "lastYear" (the rates of the same month last year, `lastYearTotals`; any rate it lacks falls back to the average)
 * Returns { values, notes }: values are the seven assumptions; notes[key] = { series: [{ month, value }], avg,
 * direction: "up" | "down" | "flat" | null, changePerMonth (fraction), projected, used: "avg" | "trend" | "lastYear" }.
 */
export function buildAssumptions({ months, planKey, method = "avg", lastYearTotals = null }) {
  const avg = assumptionsFromTotals(sumMonths(months));
  const perMonth = (months || []).map((m) => ({ month: m.month, spend: Number(m.spend) || 0, a: assumptionsFromTotals(m) }));
  const meanSpend = perMonth.length ? perMonth.reduce((s, m) => s + m.spend, 0) / perMonth.length : 0;
  const first = months?.[0]?.month;
  const tPlan = first ? monthDiff(first, planKey) : 0;
  const lastYear = lastYearTotals && lastYearTotals.spend > 0 ? assumptionsFromTotals(lastYearTotals) : null;
  const values = {};
  const notes = {};
  for (const key of KEYS) {
    const series = perMonth.map((m) => ({ month: m.month, value: m.a[key] }));
    // Months with hardly any spend say little about a rate: leave them out of the trend.
    const points = perMonth
      .map((m, t) => ({ t, y: m.a[key], spend: m.spend }))
      .filter((p) => p.y != null && p.spend > meanSpend * 0.1);
    const fit = fitLine(points);
    const rel = fit && fit.mean > 0 ? fit.slope / fit.mean : null;
    const direction = rel == null ? null : rel > FLAT ? "up" : rel < -FLAT ? "down" : "flat";
    let projected = null;
    if (fit && avg[key] != null) {
      const raw = fit.intercept + fit.slope * tPlan;
      projected = Math.min(avg[key] * (1 + CLAMP), Math.max(avg[key] * (1 - CLAMP), raw));
      if (direction === "flat") projected = avg[key];
    }
    let value = avg[key];
    let used = "avg";
    if (method === "trend" && projected != null) { value = projected; used = "trend"; }
    if (method === "lastYear" && lastYear?.[key] != null) { value = lastYear[key]; used = "lastYear"; }
    values[key] = value;
    notes[key] = { series, avg: avg[key], direction, changePerMonth: rel, projected, used };
  }
  return { values, notes };
}

/** Sentences about what is moving (for the page): only the rates that matter most and are clearly rising or falling. */
export function describeTrends(notes, { good }) {
  const names = { ctr: "CTR", cpc: "CPC", clickToLpv: "Click → LPV", clickToAtc: "Click → ATC", atcToIc: "ATC → Checkout", icToPur: "Checkout → Purchase", aov: "AOV" };
  const order = ["cpc", "ctr", "icToPur", "clickToAtc", "aov", "clickToLpv", "atcToIc"];
  const out = [];
  for (const key of order) {
    const n = notes[key];
    if (!n || n.direction == null || n.direction === "flat") continue;
    const pct = Math.abs(n.changePerMonth * 100);
    const better = good[key](n.direction);
    out.push({ key, name: names[key], direction: n.direction, pct, better });
  }
  return out;
}

/** Whether a rise (up) or fall (down) in each rate is good news. */
export const GOOD_WHEN = {
  ctr: (d) => d === "up",
  cpc: (d) => d === "down",
  clickToLpv: (d) => d === "up",
  clickToAtc: (d) => d === "up",
  atcToIc: (d) => d === "up",
  icToPur: (d) => d === "up",
  aov: (d) => d === "up",
};
