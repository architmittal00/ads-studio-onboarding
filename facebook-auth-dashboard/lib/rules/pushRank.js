import { derive, emptyAgg } from "./metrics";

// Which existing creatives to push into an ad set that has too few ads ("Add a creative" recommendations).
// Pure functions over the account's creative pool (pages/api/fb/rules/creative-pool.js), so the same pool serves every
// ad set and the ranking runs instantly in the browser.
//
// The unit is the CREATIVE: every ad that uses it (copies in other ad sets share one creative id) is pooled, and
// ROAS / link CTR / link CPC are worked out from the pooled totals — not averaged per ad. Only ads from
// purchase-optimized ad sets are in the pool. Everything is compared over the last 14 days (3 and 7 days for trend).
//
// A creative qualifies when it has at least 10 purchases in the last 14 days and beats the account's 14-day ROAS; it is skipped when it already runs in the target ad set, no ad using it is
// active, or one of its ads is flagged by a Pause rule. Qualifiers are scored 0–100 and only those scoring
// MIN_SCORE (60) or more are shown:
//   landing page 30 · ROAS 25 · CTR 10 · CPC 10 · consistency 10 · evidence 10 · freshness 5
// Landing page = the share of the TARGET ad set's 14-day spend that goes to the candidate's page, relative to the
// ad set's top page, raised to a power so the top page counts far more than the rest.

export const MAX_PUSH_OPTIONS = 20;
export const MIN_SCORE = 60; // creatives scoring below this are not shown
export const WEIGHTS = { landing: 30, roas: 25, ctr: 10, cpc: 10, consistency: 10, evidence: 10, freshness: 5 };
export const FACTOR_LABELS = { landing: "Landing page", roas: "ROAS", ctr: "CTR", cpc: "CPC", consistency: "Consistency", evidence: "Evidence", freshness: "Freshness" };
export const POOL_WINDOWS = [3, 7, 14];
export const LANDING_EXPONENT = 3; // 100% of the top page's spend → 1.0, 60% → 0.22, 30% → 0.03
const HOLDING = 0.9; // recent ROAS / CTR must be at least 90% of the 14-day figure to count as "holding"
const MIN_PURCHASES = 10;
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const DAY_MS = 86400000;

// "Same landing page" = same host and path. Tracking parameters, capitalisation, `www.` and a trailing slash don't count.
export function normalizeLandingUrl(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    let path = u.pathname;
    try {
      path = decodeURI(path);
    } catch {}
    return `${u.hostname.toLowerCase().replace(/^www\./, "")}${path.replace(/\/+$/, "").toLowerCase()}`;
  } catch {
    return null;
  }
}

function statsOf(ads) {
  const out = {};
  for (const w of POOL_WINDOWS) {
    const agg = emptyAgg();
    for (const ad of ads) {
      const m = ad.m?.[w];
      if (!m) continue;
      agg.spend += m.spend || 0;
      agg.impressions += m.impressions || 0;
      agg.linkClicks += m.linkClicks || 0;
      agg.purchases += m.purchases || 0;
      agg.revenue += m.revenue || 0;
    }
    out[w] = derive(agg);
  }
  return out;
}

// creativeId -> the creative's pooled stats, its ads, and the ad that stands in for it when it is added elsewhere.
export function groupCreatives(poolAds) {
  const byId = new Map();
  for (const ad of poolAds) {
    if (!ad.creativeId) continue;
    if (!byId.has(ad.creativeId)) byId.set(ad.creativeId, []);
    byId.get(ad.creativeId).push(ad);
  }
  const out = new Map();
  for (const [id, ads] of byId) {
    const activeAds = ads.filter((a) => a.status === "ACTIVE");
    // The active ad that has spent the most stands in for the creative (its name, landing page, where it runs).
    const source = [...(activeAds.length ? activeAds : ads)].sort((a, b) => (b.m?.[14]?.spend || 0) - (a.m?.[14]?.spend || 0))[0];
    const created = ads.map((a) => Date.parse(a.createdTime)).filter(Number.isFinite);
    out.set(id, { id, ads, activeAds, source, stats: statsOf(ads), createdAt: created.length ? Math.min(...created) : null });
  }
  return out;
}

// The bar a creative has to clear before it is worth suggesting; shared with the server, which uses it to decide
// whose thumbnail and landing page to look up.
export function qualifiesCreative(stats14, base14) {
  if (!stats14 || !base14 || base14.roas == null || stats14.roas == null) return false;
  return stats14.purchases >= MIN_PURCHASES && stats14.roas > base14.roas;
}

const pctVs = (value, base) => (value != null && base ? (value / base - 1) * 100 : null);

// Landing-page weight is dropped (the rest re-scaled) when there is nothing to compare — the ad set's ads have no
// links we could read, or the candidate has none (catalog ads).
function weighted(parts) {
  let weight = 0;
  for (const [k, v] of Object.entries(parts)) if (v != null) weight += WEIGHTS[k];
  const points = {};
  let total = 0;
  for (const [k, v] of Object.entries(parts)) {
    if (v == null) continue;
    points[k] = { points: (WEIGHTS[k] * v * 100) / weight, max: (WEIGHTS[k] * 100) / weight };
    total += points[k].points;
  }
  return { total, points };
}

const money = (v, symbol) => (v == null ? "—" : `${symbol}${v < 100 ? v.toFixed(2) : Math.round(v).toLocaleString("en-IN")}`);
const pct = (v) => (v == null ? "—" : `${v.toFixed(2)}%`);
const signed = (v) => (v == null ? "" : ` (${v >= 0 ? "+" : "−"}${Math.abs(Math.round(v))}% vs account)`);

// How the target ad set's spend splits across landing pages (14 days, every ad that delivered in it, any status).
function landingSpend(adsetAds) {
  const byKey = new Map();
  let total = 0;
  for (const a of adsetAds) {
    const spend = a.m?.[14]?.spend || 0;
    total += spend;
    const key = normalizeLandingUrl(a.landing);
    if (key) byKey.set(key, (byKey.get(key) || 0) + spend);
  }
  const top = Math.max(0, ...byKey.values());
  const topKey = top > 0 ? [...byKey.entries()].find(([, s]) => s === top)[0] : null;
  return { byKey, total, top, topKey };
}

export function rankPushCandidates({ pool, adsetId, pausedAdIds = new Set(), now = Date.now(), symbol = "₹" }) {
  const base = pool.baseline;
  const b14 = base?.[14];
  if (!b14) return { candidates: [], qualified: 0, mainLanding: null };
  const creatives = groupCreatives(pool.ads);
  const adsetAds = pool.ads.filter((a) => a.adsetId === adsetId);
  const inAdset = new Set(adsetAds.map((a) => a.creativeId).filter(Boolean));
  const landing = landingSpend(adsetAds);

  const scored = [];
  let belowBar = 0;
  for (const c of creatives.values()) {
    if (inAdset.has(c.id) || c.activeAds.length === 0) continue;
    if (c.ads.some((a) => pausedAdIds.has(a.id))) continue;
    const s14 = c.stats[14];
    if (!qualifiesCreative(s14, b14)) continue;

    const s7 = c.stats[7];
    const s3 = c.stats[3];
    const roasRatio = 0.6 * (s14.roas / b14.roas) + 0.4 * (s7.roas != null && base[7]?.roas ? s7.roas / base[7].roas : s14.roas / b14.roas);

    const key = normalizeLandingUrl(c.source?.landing);
    const share = landing.top > 0 && key ? (landing.byKey.get(key) || 0) / landing.top : null; // relative to the top page
    const landingScore = share == null ? null : Math.pow(share, LANDING_EXPONENT);
    const ctrRatio = s14.ctr != null && b14.ctr ? s14.ctr / b14.ctr : null;
    const cpcRatio = s14.cpc != null && b14.cpc ? s14.cpc / b14.cpc : null;
    const roasTrend = s7.roas != null && s14.roas ? s7.roas / s14.roas : null;
    const ctrTrend = s3.ctr != null && s14.ctr ? s3.ctr / s14.ctr : null;
    const ageDays = c.createdAt ? (now - c.createdAt) / DAY_MS : null;

    const parts = {
      landing: landingScore,
      roas: clamp01((roasRatio - 1) / 0.5),
      ctr: ctrRatio == null ? 0 : clamp01((ctrRatio - 1) / 0.3),
      cpc: cpcRatio == null ? 0 : clamp01((1 - cpcRatio) / 0.3),
      // Two yes/no checks, half each: is it still at 90%+ of its 14-day level? (No data to tell → half credit.)
      consistency: ((roasTrend == null ? 0.5 : roasTrend >= HOLDING ? 1 : 0) + (ctrTrend == null ? 0.5 : ctrTrend >= HOLDING ? 1 : 0)) / 2,
      evidence: clamp01(Math.log10(Math.max(1, s14.purchases)) / 2),
      freshness: ageDays == null ? 0.5 : clamp01(1 - (ageDays - 14) / 106),
    };
    const { total, points } = weighted(parts);

    const beaten = POOL_WINDOWS.filter((w) => c.stats[w].roas != null && base[w]?.roas != null && c.stats[w].roas > base[w].roas);
    const withData = POOL_WINDOWS.filter((w) => c.stats[w].spend > 0);
    const isTop = share === 1;
    const adsetShare = landing.total > 0 && key ? ((landing.byKey.get(key) || 0) / landing.total) * 100 : null;
    const tags = [];
    if (isTop) tags.push("Main landing page");
    else if (share > 0) tags.push("Landing page already in this ad set");
    tags.push(`Beat account ROAS in ${beaten.length} of ${withData.length || POOL_WINDOWS.length} windows`);
    if (ctrRatio != null && ctrRatio > 1) tags.push("CTR above account");
    if (cpcRatio != null && cpcRatio < 1) tags.push("CPC below account");

    // Where the creative already runs (active ads, grouped by ad set).
    const bySet = new Map();
    for (const a of c.activeAds) {
      if (!bySet.has(a.adsetId)) bySet.set(a.adsetId, { adsetId: a.adsetId, adsetName: a.adsetName, campaignName: a.campaignName, ads: [] });
      bySet.get(a.adsetId).ads.push(a);
    }
    const runningIn = [...bySet.values()]
      .map((r) => {
        const st = statsOf(r.ads)[14];
        return { adsetId: r.adsetId, adsetName: r.adsetName, campaignName: r.campaignName, spend: st.spend, roas: st.roas, purchases: st.purchases };
      })
      .sort((a, b) => b.spend - a.spend);

    const detail = {
      landing: key
        ? landing.top > 0
          ? `Goes to ${key}${(landing.byKey.get(key) || 0) > 0 ? ` — ${adsetShare.toFixed(0)}% of this ad set's 14-day spend${isTop ? " (its top page)" : ""}` : " — no ad in this ad set uses this page"}.`
          : `Goes to ${key}; this ad set's links couldn't be read.`
        : "No landing page to compare (for example a catalog ad).",
      roas: `${s14.roas.toFixed(2)} over 14 days vs the account's ${b14.roas.toFixed(2)}${signed(pctVs(s14.roas, b14.roas))}${s7.roas != null ? `; ${s7.roas.toFixed(2)} over 7 days` : ""}.`,
      ctr: ctrRatio != null ? `${pct(s14.ctr)} vs the account's ${pct(b14.ctr)}${signed(pctVs(s14.ctr, b14.ctr))}.` : "No clicks to compare.",
      cpc: cpcRatio != null ? `${money(s14.cpc, symbol)} vs the account's ${money(b14.cpc, symbol)}${signed(pctVs(s14.cpc, b14.cpc))}.` : "No clicks to compare.",
      consistency: `${roasTrend != null ? `7-day ROAS is ${Math.round(roasTrend * 100)}% of its 14-day ROAS — ${roasTrend >= HOLDING ? "holding ✓" : "fading ✗"}` : "Not enough 7-day data"}; ${ctrTrend != null ? `last-3-day CTR is ${Math.round(ctrTrend * 100)}% of its 14-day CTR — ${ctrTrend >= HOLDING ? "holding ✓" : "fading ✗"}` : "not enough 3-day data"}. Each check is worth half; holding means 90% or more.`,
      evidence: `${Math.round(s14.purchases)} purchases (10 needed) and ${money(s14.spend, symbol)} spent over 14 days across ${c.ads.length} ad${c.ads.length === 1 ? "" : "s"}.`,
      freshness: ageDays != null ? `First created ${Math.round(ageDays)} day${Math.round(ageDays) === 1 ? "" : "s"} ago.` : "Creation date unknown.",
    };
    const breakdown = Object.keys(WEIGHTS)
      .filter((k) => points[k])
      .map((k) => ({ key: k, label: FACTOR_LABELS[k], points: points[k].points, max: points[k].max, detail: detail[k] }));

    scored.push({
      creativeId: c.id,
      sourceAdId: c.source.id,
      name: c.source.name,
      thumbnailUrl: c.source.thumbnailUrl || null,
      format: c.source.format || null,
      adCount: c.ads.length,
      runningIn,
      score: Math.round(total),
      breakdown,
      tags,
      stats: {
        purchases: s14.purchases,
        spend: s14.spend,
        roas: s14.roas,
        roasVsAcct: pctVs(s14.roas, b14.roas),
        ctr: s14.ctr,
        ctrVsAcct: pctVs(s14.ctr, b14.ctr),
        cpc: s14.cpc,
        cpcVsAcct: pctVs(s14.cpc, b14.cpc),
      },
    });
  }
  const shown = scored.filter((c) => c.score >= MIN_SCORE);
  belowBar = scored.length - shown.length;
  shown.sort((a, b) => b.score - a.score || b.stats.purchases - a.stats.purchases);
  return {
    candidates: shown.slice(0, MAX_PUSH_OPTIONS),
    qualified: shown.length,
    belowBar,
    mainLanding: landing.topKey ? { key: landing.topKey, share: landing.total > 0 ? (landing.top / landing.total) * 100 : null } : null,
  };
}

// For "New creative -01" (spend stacked on a few ads): the ad set's own lowest-spending half by 3-day spend — the ads
// that aren't getting served — worst performers first. Starved ads that beat the account are tagged so they can be kept.
export function starvedAds({ pool, adsetId }) {
  const b14 = pool.baseline?.[14];
  const creatives = groupCreatives(pool.ads);
  const own = pool.ads.filter((a) => a.adsetId === adsetId && a.status === "ACTIVE").sort((a, b) => (a.m?.[3]?.spend || 0) - (b.m?.[3]?.spend || 0));
  const total3 = own.reduce((t, a) => t + (a.m?.[3]?.spend || 0), 0);
  const rows = own.slice(0, Math.floor(own.length / 2)).map((a) => {
    const s14 = creatives.get(a.creativeId)?.stats[14] || statsOf([a])[14];
    const beats = s14.roas != null && b14?.roas != null && s14.roas > b14.roas && s14.purchases >= 5;
    return {
      adId: a.id,
      name: a.name,
      thumbnailUrl: a.thumbnailUrl || null,
      format: a.format || null,
      spendShare3: total3 > 0 ? ((a.m?.[3]?.spend || 0) / total3) * 100 : null,
      stats: {
        purchases: s14.purchases,
        roas: s14.roas,
        roasVsAcct: pctVs(s14.roas, b14?.roas),
        ctr: s14.ctr,
        ctrVsAcct: pctVs(s14.ctr, b14?.ctr),
        cpc: s14.cpc,
        cpcVsAcct: pctVs(s14.cpc, b14?.cpc),
      },
      beatsAccount: beats,
    };
  });
  rows.sort((a, b) => (a.stats.roasVsAcct ?? -101) - (b.stats.roasVsAcct ?? -101));
  return rows;
}
