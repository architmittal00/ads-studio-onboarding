import { getServerSession } from "next-auth/next";
import { authOptions } from "../../auth/[...nextauth]";
import { graphGet, graphGetAllPages, graphGetInsights } from "@/lib/facebookGraph";
import { todayInTimeZone } from "@/lib/dateRanges";
import { lastNDaysRange, chunk, fetchAdDetails, fetchPostLandingUrls } from "@/lib/adCreativeDetails";
import { derive, emptyAgg, addInsightsRow } from "@/lib/rules/metrics";
import { ADSET_OPTIMIZATION_FIELDS, isPurchaseOptimized } from "@/lib/rules/optimization";
import { validTimeZone } from "@/lib/rules/checkAccount";
import { POOL_WINDOWS, groupCreatives, qualifiesCreative } from "@/lib/rules/pushRank";

// GET /api/fb/rules/creative-pool?accountId=act_123[&tz=…] — what's needed to suggest which existing ads to push
// into an ad set (lib/rules/pushRank.js ranks it in the browser). Every ad that delivered in the last 14 days in a
// purchase-optimized ad set comes back with its 3/7/14-day totals and creative id, plus the account's own figures.
//
// Kept fast on purpose: three ad-level insights jobs (not four), creative ids fetched in small batches while those
// run, and the heavy lookups (landing page, thumbnail, format) only for the ONE ad that stands in for each creative
// that actually clears the bar — a handful, not the whole account.
const VALID_ID = /^act_\d+$/;
const MAX_ADS = 900; // most-spent ads beyond this are dropped (active ads always stay)
const MAX_SOURCES = 150;
const ACTIVE_FILTER = [{ field: "effective_status", operator: "IN", value: ["ACTIVE", "IN_PROCESS"] }];

const compact = (agg) => ({ spend: agg.spend, impressions: agg.impressions, linkClicks: agg.linkClicks, purchases: agg.purchases, revenue: agg.revenue });

// adId -> creative id, 50 ads per Graph call, all calls at once.
async function fetchCreativeIds(adIds, token) {
  const out = new Map();
  const results = await Promise.allSettled(chunk(adIds, 50).map((ids) => graphGet("", token, { ids: ids.join(","), fields: "creative{id}" })));
  for (const r of results) {
    if (r.status !== "fulfilled") continue;
    for (const [id, obj] of Object.entries(r.value || {})) if (obj?.creative?.id) out.set(id, obj.creative.id);
  }
  return out;
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const session = await getServerSession(req, res, authOptions);
  if (!session?.accessToken) return res.status(401).json({ error: "Not authenticated" });
  const { accountId } = req.query;
  if (!VALID_ID.test(String(accountId || ""))) return res.status(400).json({ error: "accountId must be an ad account id like act_123" });
  const token = session.accessToken;

  try {
    // The time zone places the date windows; the client normally sends it, so nothing waits on the account call.
    const tzParam = validTimeZone(req.query.tz);
    const account = tzParam ? { timezone_name: tzParam } : await graphGet(`/${accountId}`, token, { fields: "timezone_name" });
    const today = todayInTimeZone(tzParam || account.timezone_name);

    const insightsFor = (days) => {
      const range = lastNDaysRange(days, today);
      return graphGetInsights(
        `/${accountId}/insights`,
        token,
        { level: "ad", fields: "ad_id,adset_id,spend,impressions,inline_link_clicks,actions,action_values", time_range: { since: range.since, until: range.until }, limit: 500 },
        { timeoutMs: 90000 }
      ).then((r) => r.data || []);
    };

    // Which creative has spent in which ad set over the last 30 days (a push must never repeat one that did).
    const spent30P = insightsFor(30).then((rows) => rows.filter((r) => r.ad_id && r.adset_id && parseFloat(r.spend) > 0).map((r) => [r.ad_id, r.adset_id]));

    const activeAdsP = graphGetAllPages(`/${accountId}/ads`, token, { fields: "id,name,adset_id,campaign_id,created_time", filtering: ACTIVE_FILTER, limit: 500 });
    const activeAdsetsP = graphGetAllPages(`/${accountId}/adsets`, token, { fields: `id,name,campaign_id,${ADSET_OPTIMIZATION_FIELDS}`, filtering: ACTIVE_FILTER, limit: 500 });
    const activeCampaignsP = graphGetAllPages(`/${accountId}/campaigns`, token, { fields: "id,name", filtering: ACTIVE_FILTER, limit: 500 });
    // Creative ids of the active ads start loading the moment the lists are back — while the insights jobs are still running.
    const activeCreativesP = Promise.all([activeAdsP, activeAdsetsP]).then(([ads, adsets]) => {
      const eligibleSets = new Set((adsets.data || []).filter(isPurchaseOptimized).map((a) => a.id));
      return fetchCreativeIds((ads.data || []).filter((a) => eligibleSets.has(a.adset_id)).map((a) => a.id), token);
    });

    const [activeAds, activeAdsets, activeCampaigns, activeCreatives, spent30, ...windowRows] = await Promise.all([activeAdsP, activeAdsetsP, activeCampaignsP, activeCreativesP, spent30P, ...POOL_WINDOWS.map(insightsFor)]);
    const rowsByWindow = Object.fromEntries(POOL_WINDOWS.map((w, i) => [w, windowRows[i]]));

    // Account totals (the benchmark every creative is compared with), summed from the same rows.
    const baseline = {};
    for (const w of POOL_WINDOWS) {
      const agg = emptyAgg();
      for (const row of rowsByWindow[w]) addInsightsRow(agg, row);
      const d = derive(agg);
      baseline[w] = { spend: d.spend, roas: d.roas, ctr: d.ctr, cpc: d.cpc, cpr: d.cpr };
    }

    const perAd = new Map();
    for (const w of POOL_WINDOWS) {
      for (const row of rowsByWindow[w]) {
        if (!row.ad_id) continue;
        if (!perAd.has(row.ad_id)) perAd.set(row.ad_id, { adsetId: row.adset_id, aggs: {} });
        const entry = perAd.get(row.ad_id);
        entry.aggs[w] ||= emptyAgg();
        addInsightsRow(entry.aggs[w], row);
      }
    }
    const activeById = new Map((activeAds.data || []).map((a) => [a.id, a]));
    for (const a of activeById.values()) if (!perAd.has(a.id)) perAd.set(a.id, { adsetId: a.adset_id, aggs: {} });

    // Purchase-optimized ad sets: the active ones came with the list; an ad that delivered in a since-paused ad set
    // needs its ad set looked up.
    const adsetInfo = new Map((activeAdsets.data || []).map((a) => [a.id, a]));
    const unknownAdsets = [...new Set([...perAd.values()].map((e) => e.adsetId).filter((id) => id && !adsetInfo.has(id)))];
    const lookups = await Promise.allSettled(chunk(unknownAdsets, 50).map((ids) => graphGet("", token, { ids: ids.join(","), fields: `name,campaign_id,${ADSET_OPTIMIZATION_FIELDS}` })));
    for (const l of lookups) {
      if (l.status !== "fulfilled") continue;
      for (const [id, obj] of Object.entries(l.value || {})) adsetInfo.set(id, { id, ...obj });
    }

    let ids = [...perAd.entries()].filter(([, e]) => isPurchaseOptimized(adsetInfo.get(e.adsetId))).map(([id]) => id);
    const spend14 = (id) => perAd.get(id).aggs[14]?.spend || 0;
    ids.sort((a, b) => spend14(b) - spend14(a));
    if (ids.length > MAX_ADS) {
      const keep = new Set(ids.slice(0, MAX_ADS));
      for (const id of ids) if (activeById.has(id)) keep.add(id);
      ids = ids.filter((id) => keep.has(id));
    }

    // Creative ids: the active ones are already here; only ads that have since been paused still need one.
    const creativeOf = new Map(activeCreatives);
    // Ads that spent only in days 15–30 (in a currently active ad set) need one too, for the 30-day "already in this ad set" check.
    const liveSets = new Set((activeAdsets.data || []).map((a) => a.id));
    const spent30Live = spent30.filter(([, setId]) => liveSets.has(setId));
    const wanted = [...new Set([...ids, ...spent30Live.map(([adId]) => adId)])].filter((id) => !creativeOf.has(id));
    const pausedFetched = await fetchCreativeIds(wanted, token);
    for (const [id, c] of pausedFetched) creativeOf.set(id, c);
    const adsetCreatives30 = {};
    for (const [adId, setId] of spent30Live) {
      const c = creativeOf.get(adId);
      if (c) (adsetCreatives30[setId] ||= new Set()).add(c);
    }
    for (const k of Object.keys(adsetCreatives30)) adsetCreatives30[k] = [...adsetCreatives30[k]];

    const campaignName = new Map((activeCampaigns.data || []).map((c) => [c.id, c.name]));
    const light = ids.map((id) => {
      const e = perAd.get(id);
      const active = activeById.get(id);
      const adset = adsetInfo.get(e.adsetId);
      return {
        id,
        name: active?.name || id,
        adsetId: e.adsetId,
        adsetName: adset?.name || null,
        campaignName: campaignName.get(active?.campaign_id || adset?.campaign_id) || null,
        status: active ? "ACTIVE" : "PAUSED",
        creativeId: creativeOf.get(id) || null,
        createdTime: active?.created_time || null,
        m: Object.fromEntries(POOL_WINDOWS.map((w) => [w, compact(e.aggs[w] || emptyAgg())])),
      };
    });

    // Only the creatives that clear the bar get their stand-in ad looked up (landing page, thumbnail, format).
    const creatives = groupCreatives(light);
    const sources = [...creatives.values()]
      .filter((c) => c.activeAds.length > 0 && qualifiesCreative(c.stats[14], baseline[14]))
      .sort((a, b) => b.stats[14].spend - a.stats[14].spend)
      .slice(0, MAX_SOURCES)
      .map((c) => c.source.id);
    const details = await fetchAdDetails(sources, token);
    const postIds = [...new Set(Object.values(details).map((d) => d.postId).filter(Boolean))];
    let postUrls = {};
    try {
      postUrls = await fetchPostLandingUrls(postIds, token);
    } catch {}
    const sourceSet = new Set(sources);
    const ads = light.map((a) => {
      if (!sourceSet.has(a.id)) return a;
      const d = details[a.id] || {};
      return { ...a, landing: d.landingUrl || (d.postId ? postUrls[d.postId] : null) || null, thumbnailUrl: d.thumbnailUrl || null, format: d.creativeType || null, kind: d.kind || null };
    });

    res.setHeader("Cache-Control", "private, max-age=300");
    res.status(200).json({ generatedAt: Date.now(), accountId, baseline, adsetCreatives30, ads });
  } catch (err) {
    res.status(err.graphResponse ? 400 : 500).json({ error: err.message || "Request failed" });
  }
}
