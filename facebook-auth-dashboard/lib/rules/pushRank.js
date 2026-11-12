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
//   without a language (WEIGHTS):      landing page 25 · type 20 · ROAS 20 · CTR 5 · CPC 5 · consistency 10 · freshness 10 · evidence 5
//   with a language (WEIGHTS_LANG):     landing page 20 · type 15 · ROAS 15 · language 15 · CTR 5 · CPC 5 · consistency 10 · freshness 10 · evidence 5
// The language weights are used for a candidate only when the target ad set has a most-spending language AND the
// candidate's name has one; every other candidate uses the first set. A different language just loses its points.
// Landing page, creative type and language are all "the share of the TARGET ad set's 14-day spend that goes to the
// candidate's page / type / language, relative to the ad set's top one, cubed" — so the top one counts far more.
// Language is read from the ad name: the text between ces…cee or les…lee (the last such pair), any token, digits dropped.
// Creative type is one of Partnership / Catalog / Carousel / Video / Image (lib/adCreativeDetails.js deriveCreativeKind).

export const MAX_PUSH_OPTIONS = 20;
export const MIN_SCORE = 60; // creatives scoring below this are not shown
export const WEIGHTS = { landing: 25, type: 20, roas: 20, ctr: 5, cpc: 5, consistency: 10, freshness: 10, evidence: 5 };
export const WEIGHTS_LANG = { landing: 20, type: 15, roas: 15, language: 15, ctr: 5, cpc: 5, consistency: 10, freshness: 10, evidence: 5 };
export const FACTOR_LABELS = { landing: "Landing page", type: "Creative type", roas: "ROAS", language: "Language", ctr: "CTR", cpc: "CPC", consistency: "Consistency", freshness: "Freshness", evidence: "Evidence" };
export const POOL_WINDOWS = [3, 7, 14];
export const SHARE_EXPONENT = 3; // landing page, type and language: 100% of the top one's spend → 1.0, 60% → 0.22, 30% → 0.03
const HOLDING = 0.9; // recent ROAS / CTR must be at least 90% of the 14-day figure to count as "holding"
const MIN_PURCHASES = 10;
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const DAY_MS = 86400000;

// The language in an ad's name: the text between ces…cee or les…lee (markers may carry digits, e.g. ces1…cee1), the
// LAST such pair when there are several. Any token counts; trailing digits and symbols are dropped (malayalam1 →
// malayalam). Returns lower case, or null.
export function languageFromName(name) {
  if (!name) return null;
  let last = null;
  for (const m of String(name).matchAll(/(?:^|[_\s-])(?:ces|les)\d*[_\s-]+(.+?)[_\s-]+(?:cee|lee)\d*(?=[_\s-]|$)/gi)) last = m[1];
  if (!last) return null;
  const token = last.replace(/\d+$/, "").replace(/[^\p{L}]+/gu, " ").trim().toLowerCase();
  // A language is one word: a multi-word or very long token (e.g. a creative title that happens to sit between the
  // markers) is not read as one.
  return token && !/\s/.test(token) && token.length <= 20 ? token : null;
}
const titleCase = (s) => (s ? s.replace(/\b\p{L}/gu, (c) => c.toUpperCase()) : s);

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
function weighted(parts, weights) {
  let weight = 0;
  for (const [k, v] of Object.entries(parts)) if (v != null) weight += weights[k];
  const points = {};
  let total = 0;
  for (const [k, v] of Object.entries(parts)) {
    if (v == null) continue;
    points[k] = { points: (weights[k] * v * 100) / weight, max: (weights[k] * 100) / weight };
    total += points[k].points;
  }
  return { total, points };
}

const money = (v, symbol) => (v == null ? "—" : `${symbol}${v < 100 ? v.toFixed(2) : Math.round(v).toLocaleString("en-IN")}`);
const pct = (v) => (v == null ? "—" : `${v.toFixed(2)}%`);
const signed = (v) => (v == null ? "" : ` (${v >= 0 ? "+" : "−"}${Math.abs(Math.round(v))}% vs account)`);

// How the target ad set's 14-day spend splits by some key (landing page, creative type, language) across every ad that
// delivered in it, any status.
function spendBy(adsetAds, keyOf) {
  const byKey = new Map();
  let total = 0;
  for (const a of adsetAds) {
    const spend = a.m?.[14]?.spend || 0;
    total += spend;
    const key = keyOf(a);
    if (key) byKey.set(key, (byKey.get(key) || 0) + spend);
  }
  const top = Math.max(0, ...byKey.values());
  const topKey = top > 0 ? [...byKey.entries()].find(([, s]) => s === top)[0] : null;
  return { byKey, total, top, topKey };
}
const shareOfTop = (spend, top) => (top > 0 ? (spend || 0) / top : null);

export function rankPushCandidates({ pool, adsetId, pausedAdIds = new Set(), now = Date.now(), symbol = "₹" }) {
  const base = pool.baseline;
  const b14 = base?.[14];
  if (!b14) return { candidates: [], qualified: 0, mainLanding: null };
  const creatives = groupCreatives(pool.ads);
  const adsetAds = pool.ads.filter((a) => a.adsetId === adsetId);
  const inAdset = new Set(adsetAds.map((a) => a.creativeId).filter(Boolean));
  const landing = spendBy(adsetAds, (a) => normalizeLandingUrl(a.landing));
  const types = spendBy(adsetAds, (a) => a.kind || null);
  let langs = spendBy(adsetAds, (a) => languageFromName(a.name));
  if (langs.top === 0) {
    // No ad carries a language: fall back to the ad set's own name.
    const fromSet = languageFromName(adsetAds.find((a) => a.adsetName)?.adsetName);
    if (fromSet) langs = { byKey: new Map([[fromSet, 1]]), total: 1, top: 1, topKey: fromSet };
  }

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
    const landingScore = share == null ? null : Math.pow(share, SHARE_EXPONENT);
    const ctrRatio = s14.ctr != null && b14.ctr ? s14.ctr / b14.ctr : null;
    const cpcRatio = s14.cpc != null && b14.cpc ? s14.cpc / b14.cpc : null;
    const roasTrend = s7.roas != null && s14.roas ? s7.roas / s14.roas : null;
    const ctrTrend = s3.ctr != null && s14.ctr ? s3.ctr / s14.ctr : null;
    const ageDays = c.createdAt ? (now - c.createdAt) / DAY_MS : null;

    // Creative type and language, compared with what this ad set spends on (cubed, like the landing page).
    const kind = c.source?.kind || c.ads.find((a) => a.kind)?.kind || null;
    const typeShare = types.top > 0 && kind ? shareOfTop(types.byKey.get(kind), types.top) : null;
    const lang = [c.source, ...c.ads].map((a) => languageFromName(a?.name)).find(Boolean) || null;
    const useLang = langs.top > 0 && !!lang; // language weights only for a candidate that has a language, in an ad set that has one
    const langShare = useLang ? shareOfTop(langs.byKey.get(lang), langs.top) : null;
    const weights = useLang ? WEIGHTS_LANG : WEIGHTS;

    const parts = {
      landing: landingScore,
      type: typeShare == null ? null : Math.pow(typeShare, SHARE_EXPONENT),
      ...(useLang ? { language: Math.pow(langShare, SHARE_EXPONENT) } : {}),
      roas: clamp01((roasRatio - 1) / 0.5),
      ctr: ctrRatio == null ? 0 : clamp01((ctrRatio - 1) / 0.3),
      cpc: cpcRatio == null ? 0 : clamp01((1 - cpcRatio) / 0.3),
      // Two yes/no checks, half each: is it still at 90%+ of its 14-day level? (No data to tell → half credit.)
      consistency: ((roasTrend == null ? 0.5 : roasTrend >= HOLDING ? 1 : 0) + (ctrTrend == null ? 0.5 : ctrTrend >= HOLDING ? 1 : 0)) / 2,
      evidence: clamp01(Math.log10(Math.max(1, s14.purchases)) / 2),
      freshness: ageDays == null ? 0.5 : clamp01(1 - (ageDays - 14) / 106),
    };
    const { total, points } = weighted(parts, weights);

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

    // One row per factor for the "Why push this?" table: what the creative has, what it is compared with, and a
    // strong / fair / weak verdict from how many of the factor's points it earned.
    const path = key ? key.slice(key.indexOf("/")) || "/" : null;
    const inSet = !!key && (landing.byKey.get(key) || 0) > 0;
    const dir = (v, lowerIsBetter) => (v == null ? "" : `${Math.abs(Math.round(v))}% ${(v >= 0) === !lowerIsBetter ? "better" : "worse"}`);
    const vs = (v) => (v == null ? "" : ` (${v >= 0 ? "+" : "−"}${Math.abs(Math.round(v))}%)`);
    const days = ageDays != null ? Math.round(ageDays) : null;
    const rows = {
      landing: {
        value: key ? path : "No page to compare",
        against: landing.top <= 0 ? "This ad set's links couldn't be read" : inSet ? `${adsetShare.toFixed(0)}% of this ad set's spend${isTop ? " — its top page" : ""}` : "No ad in this ad set uses this page",
        short: inSet ? `landing page (${adsetShare.toFixed(0)}% of this ad set's spend)` : "landing page (not used by this ad set)",
      },
      type: {
        value: kind || "Unknown",
        against: types.top <= 0 ? "This ad set's ad types couldn't be read" : (types.byKey.get(kind) || 0) > 0 ? `${((types.byKey.get(kind) / types.total) * 100).toFixed(0)}% of this ad set's spend${typeShare === 1 ? " — its top type" : ""}` : "No ad of this type in this ad set",
        short: (types.byKey.get(kind) || 0) > 0 ? `creative type (${kind}, ${((types.byKey.get(kind) / types.total) * 100).toFixed(0)}% of this ad set's spend)` : `creative type (${kind || "unknown"}, not used by this ad set)`,
      },
      language: {
        value: titleCase(lang) || "—",
        against: useLang ? ((langs.byKey.get(lang) || 0) > 0 ? `${((langs.byKey.get(lang) / (langs.total || 1)) * 100).toFixed(0)}% of this ad set's spend${langShare === 1 ? " — its top language" : ""}` : `Not used by this ad set (it spends on ${titleCase(langs.topKey)})`) : "",
        short: useLang ? ((langs.byKey.get(lang) || 0) > 0 ? `language (${titleCase(lang)})` : `language (${titleCase(lang)}, not ${titleCase(langs.topKey)})`) : "language",
      },
      roas: { value: s14.roas.toFixed(2), against: `Account ${b14.roas.toFixed(2)}${vs(pctVs(s14.roas, b14.roas))}`, short: `ROAS ${dir(pctVs(s14.roas, b14.roas))} than the account` },
      ctr: { value: pct(s14.ctr), against: ctrRatio != null ? `Account ${pct(b14.ctr)}${vs(pctVs(s14.ctr, b14.ctr))}` : "No clicks to compare", short: `CTR ${dir(pctVs(s14.ctr, b14.ctr))} than the account` },
      cpc: { value: money(s14.cpc, symbol), against: cpcRatio != null ? `Account ${money(b14.cpc, symbol)}${vs(pctVs(s14.cpc, b14.cpc))}, lower is better` : "No clicks to compare", short: `CPC ${dir(pctVs(s14.cpc, b14.cpc), true)} than the account` },
      consistency: {
        value: `ROAS ${roasTrend != null ? `${Math.round(roasTrend * 100)}%` : "—"} · CTR ${ctrTrend != null ? `${Math.round(ctrTrend * 100)}%` : "—"}`,
        against: "Recent vs 14-day level; each needs 90%+",
        short: "holding up recently",
      },
      evidence: { value: `${Math.round(s14.purchases)} purchases`, against: `Needs ${MIN_PURCHASES}+ · ${money(s14.spend, symbol)} spent over ${c.ads.length} ad${c.ads.length === 1 ? "" : "s"}`, short: `${Math.round(s14.purchases)} purchases` },
      freshness: { value: days != null ? `${days} day${days === 1 ? "" : "s"} old` : "Unknown", against: "14 days or newer scores full", short: days != null ? `${days} days old` : "age unknown" },
    };
    const breakdown = Object.keys(weights)
      .filter((k) => points[k])
      .map((k) => {
        const ratio = points[k].max > 0 ? points[k].points / points[k].max : 0;
        return { key: k, label: FACTOR_LABELS[k], points: points[k].points, max: points[k].max, level: ratio >= 0.7 ? "strong" : ratio >= 0.3 ? "fair" : "weak", ...rows[k] };
      });
    const summary = {
      grade: total >= 80 ? "Strong fit" : total >= 70 ? "Good fit" : "Decent fit",
      strong: breakdown.filter((r) => r.level === "strong").map((r) => r.short),
      weak: breakdown.filter((r) => r.level === "weak").map((r) => r.short),
    };

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
      summary,
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
    // What the ad set mostly spends on, for the header line.
    profile: {
      language: langs.topKey ? { label: titleCase(langs.topKey), share: langs.total > 0 ? (langs.top / langs.total) * 100 : null } : null,
      type: types.topKey ? { label: types.topKey, share: types.total > 0 ? (types.top / types.total) * 100 : null } : null,
    },
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
