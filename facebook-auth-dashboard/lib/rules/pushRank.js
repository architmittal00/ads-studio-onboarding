import { derive, emptyAgg } from "./metrics";

// Which existing creatives to push into an ad set that has too few ads ("Add a creative" recommendations).
// Pure functions over the account's creative pool (pages/api/fb/rules/creative-pool.js), so the same pool serves every
// ad set and the ranking runs instantly in the browser.
//
// The unit is the CREATIVE: every ad that uses it (copies in other ad sets share one creative id) is pooled, and
// ROAS / link CTR / link CPC are worked out from the pooled totals — not averaged per ad. Only ads from
// purchase-optimized ad sets are in the pool.
//
// A creative qualifies when it has enough evidence (≥ 10 purchases, or spend > 3× the account's cost per purchase,
// over 30 days) and beats the account's 30-day ROAS; it is skipped when it already runs in the target ad set, no ad
// using it is active, or one of its ads is flagged by a Pause rule. Qualifiers are scored 0–100:
//   landing page 30 · ROAS vs account 25 · CTR 10 · CPC 10 · consistency 10 · evidence 10 · freshness 5

export const MAX_PUSH_OPTIONS = 20;
export const WEIGHTS = { landing: 30, roas: 25, ctr: 10, cpc: 10, consistency: 10, evidence: 10, freshness: 5 };
export const FACTOR_LABELS = { landing: "Landing page", roas: "ROAS", ctr: "CTR", cpc: "CPC", consistency: "Consistency", evidence: "Evidence", freshness: "Freshness" };
const WINDOWS = [3, 7, 14, 30];
const MIN_PURCHASES = 10;
const MIN_SPEND_IN_ACCOUNT_CPP = 3;
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
  for (const w of WINDOWS) {
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
    const source = [...(activeAds.length ? activeAds : ads)].sort((a, b) => (b.m?.[30]?.spend || 0) - (a.m?.[30]?.spend || 0))[0];
    const created = ads.map((a) => Date.parse(a.createdTime)).filter(Number.isFinite);
    out.set(id, { id, ads, activeAds, source, stats: statsOf(ads), createdAt: created.length ? Math.min(...created) : null });
  }
  return out;
}

const pctVs = (value, base) => (value != null && base ? (value / base - 1) * 100 : null);

// Landing-page weight is dropped (the rest re-scaled) when there is nothing to compare — the ad set's ads have no
// links we could read, or the candidate has none (catalog ads).
function totalScore(parts) {
  let sum = 0;
  let weight = 0;
  for (const [k, v] of Object.entries(parts)) {
    if (v == null) continue;
    sum += WEIGHTS[k] * v;
    weight += WEIGHTS[k];
  }
  return weight > 0 ? (sum / weight) * 100 : 0;
}

export function rankPushCandidates({ pool, adsetId, pausedAdIds = new Set(), now = Date.now() }) {
  const base = pool.baseline;
  const b30 = base?.[30];
  if (!b30) return { candidates: [], qualified: 0, mainLanding: null };
  const creatives = groupCreatives(pool.ads);
  const adsetAds = pool.ads.filter((a) => a.adsetId === adsetId && a.status === "ACTIVE");
  const inAdset = new Set(adsetAds.map((a) => a.creativeId).filter(Boolean));

  const landingCounts = new Map();
  for (const a of adsetAds) {
    const key = normalizeLandingUrl(a.landing);
    if (key) landingCounts.set(key, (landingCounts.get(key) || 0) + 1);
  }
  const mainCount = Math.max(0, ...landingCounts.values());
  const mainKey = mainCount > 0 ? [...landingCounts.entries()].find(([, n]) => n === mainCount)[0] : null;

  const scored = [];
  for (const c of creatives.values()) {
    if (inAdset.has(c.id) || c.activeAds.length === 0) continue;
    if (c.ads.some((a) => pausedAdIds.has(a.id))) continue;
    const s30 = c.stats[30];
    const enough = s30.purchases >= MIN_PURCHASES || (b30.cpr != null && s30.spend > MIN_SPEND_IN_ACCOUNT_CPP * b30.cpr);
    if (!enough || s30.roas == null || b30.roas == null || !(s30.roas > b30.roas)) continue;

    const s14 = c.stats[14];
    const s7 = c.stats[7];
    const s3 = c.stats[3];
    const roasRatio = 0.6 * (s30.roas / b30.roas) + 0.4 * (s14.roas != null && base[14]?.roas ? s14.roas / base[14].roas : s30.roas / b30.roas);

    const key = normalizeLandingUrl(c.source?.landing);
    const landing = mainCount === 0 || !key ? null : (landingCounts.get(key) || 0) / mainCount;
    const ctrRatio = s30.ctr != null && b30.ctr ? s30.ctr / b30.ctr : null;
    const cpcRatio = s30.cpc != null && b30.cpc ? s30.cpc / b30.cpc : null;
    const roasTrend = s7.roas != null && s30.roas ? s7.roas / s30.roas : null;
    const ctrTrend = s3.ctr != null && s30.ctr ? s3.ctr / s30.ctr : null;
    const ageDays = c.createdAt ? (now - c.createdAt) / DAY_MS : null;

    const parts = {
      landing,
      roas: clamp01((roasRatio - 1) / 0.5),
      ctr: ctrRatio == null ? 0 : clamp01((ctrRatio - 1) / 0.3),
      cpc: cpcRatio == null ? 0 : clamp01((1 - cpcRatio) / 0.3),
      consistency: ((roasTrend == null ? 0.5 : clamp01((roasTrend - 0.7) / 0.3)) + (ctrTrend == null ? 0.5 : clamp01((ctrTrend - 0.8) / 0.2))) / 2,
      evidence: clamp01(Math.log10(Math.max(1, s30.purchases)) / 2),
      freshness: ageDays == null ? 0.5 : clamp01(1 - (ageDays - 14) / 106),
    };

    const beaten = WINDOWS.filter((w) => c.stats[w].roas != null && base[w]?.roas != null && c.stats[w].roas > base[w].roas);
    const withData = WINDOWS.filter((w) => c.stats[w].spend > 0);
    const tags = [];
    if (landing === 1) tags.push("Main landing page");
    else if (landing > 0) tags.push("Landing page already in this ad set");
    tags.push(`Beat account ROAS in ${beaten.length} of ${withData.length || WINDOWS.length} windows`);
    if (ctrRatio != null && ctrRatio > 1) tags.push("CTR above account");
    if (cpcRatio != null && cpcRatio < 1) tags.push("CPC below account");

    scored.push({
      creativeId: c.id,
      sourceAdId: c.source.id,
      name: c.source.name,
      thumbnailUrl: c.source.thumbnailUrl || null,
      format: c.source.format || null,
      where: [c.source.campaignName, c.source.adsetName].filter(Boolean).join(" › "),
      adCount: c.ads.length,
      score: Math.round(totalScore(parts)),
      parts,
      tags,
      landingMatch: landing,
      stats: {
        purchases: s30.purchases,
        spend: s30.spend,
        roas: s30.roas,
        roasVsAcct: pctVs(s30.roas, b30.roas),
        ctr: s30.ctr,
        ctrVsAcct: pctVs(s30.ctr, b30.ctr),
        cpc: s30.cpc,
        cpcVsAcct: pctVs(s30.cpc, b30.cpc),
      },
    });
  }
  scored.sort((a, b) => b.score - a.score || b.stats.purchases - a.stats.purchases);
  return {
    candidates: scored.slice(0, MAX_PUSH_OPTIONS),
    qualified: scored.length,
    mainLanding: mainKey ? { key: mainKey, adCount: mainCount, totalAds: adsetAds.length } : null,
  };
}

// For "New creative -01" (spend stacked on a few ads): the ad set's own lowest-spending half by 3-day spend — the ads
// that aren't getting served — worst performers first. Starved ads that beat the account are tagged so they can be kept.
export function starvedAds({ pool, adsetId }) {
  const b30 = pool.baseline?.[30];
  const creatives = groupCreatives(pool.ads);
  const own = pool.ads.filter((a) => a.adsetId === adsetId && a.status === "ACTIVE").sort((a, b) => (a.m?.[3]?.spend || 0) - (b.m?.[3]?.spend || 0));
  const total3 = own.reduce((t, a) => t + (a.m?.[3]?.spend || 0), 0);
  const rows = own.slice(0, Math.floor(own.length / 2)).map((a) => {
    const s30 = creatives.get(a.creativeId)?.stats[30] || statsOf([a])[30];
    const beats = s30.roas != null && b30?.roas != null && s30.roas > b30.roas && s30.purchases >= 5;
    return {
      adId: a.id,
      name: a.name,
      thumbnailUrl: a.thumbnailUrl || null,
      format: a.format || null,
      spendShare3: total3 > 0 ? ((a.m?.[3]?.spend || 0) / total3) * 100 : null,
      stats: {
        purchases: s30.purchases,
        roas: s30.roas,
        roasVsAcct: pctVs(s30.roas, b30?.roas),
        ctr: s30.ctr,
        ctrVsAcct: pctVs(s30.ctr, b30?.ctr),
        cpc: s30.cpc,
        cpcVsAcct: pctVs(s30.cpc, b30?.cpc),
      },
      beatsAccount: beats,
    };
  });
  rows.sort((a, b) => (a.stats.roasVsAcct ?? -101) - (b.stats.roasVsAcct ?? -101));
  return rows;
}
