import { getServerSession } from "next-auth/next";
import { authOptions } from "../../auth/[...nextauth]";
import { graphGet, graphGetAllPages, graphGetInsights } from "@/lib/facebookGraph";
import { todayInTimeZone } from "@/lib/dateRanges";
import { lastNDaysRange, chunk, fetchAdDetails, fetchPostLandingUrls } from "@/lib/adCreativeDetails";
import { WINDOWS, derive, emptyAgg, addInsightsRow } from "@/lib/rules/metrics";
import { ADSET_OPTIMIZATION_FIELDS, isPurchaseOptimized } from "@/lib/rules/optimization";
import { validTimeZone } from "@/lib/rules/checkAccount";

// GET /api/fb/rules/creative-pool?accountId=act_123[&tz=…] — everything needed to suggest which existing ads to
// push into an ad set (lib/rules/pushRank.js ranks it in the browser): every ad that delivered in the last 30 days
// in a purchase-optimized ad set, with its 3/7/14/30-day totals, creative id, landing page, thumbnail and format,
// plus the account's own figures for the same windows. One pool per account serves every ad set.
const VALID_ID = /^act_\d+$/;
const MAX_ADS = 900; // most-spent ads beyond this are dropped (active ads always stay)
const ACTIVE_FILTER = [{ field: "effective_status", operator: "IN", value: ["ACTIVE", "IN_PROCESS"] }];

const compact = (agg) => ({ spend: agg.spend, impressions: agg.impressions, linkClicks: agg.linkClicks, purchases: agg.purchases, revenue: agg.revenue });

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const session = await getServerSession(req, res, authOptions);
  if (!session?.accessToken) return res.status(401).json({ error: "Not authenticated" });
  const { accountId } = req.query;
  if (!VALID_ID.test(String(accountId || ""))) return res.status(400).json({ error: "accountId must be an ad account id like act_123" });
  const token = session.accessToken;

  try {
    const account = await graphGet(`/${accountId}`, token, { fields: "currency,timezone_name" });
    const today = todayInTimeZone(validTimeZone(req.query.tz) || account.timezone_name);

    const insightsFor = (days) => {
      const range = lastNDaysRange(days, today);
      return graphGetInsights(
        `/${accountId}/insights`,
        token,
        { level: "ad", fields: "ad_id,adset_id,spend,impressions,inline_link_clicks,actions,action_values", time_range: { since: range.since, until: range.until }, limit: 500 },
        { timeoutMs: 90000 }
      ).then((r) => r.data || []);
    };

    const [activeAds, activeAdsets, activeCampaigns, ...windowRows] = await Promise.all([
      graphGetAllPages(`/${accountId}/ads`, token, { fields: "id,name,adset_id,campaign_id,created_time", filtering: ACTIVE_FILTER, limit: 500 }),
      graphGetAllPages(`/${accountId}/adsets`, token, { fields: `id,name,campaign_id,${ADSET_OPTIMIZATION_FIELDS}`, filtering: ACTIVE_FILTER, limit: 500 }),
      graphGetAllPages(`/${accountId}/campaigns`, token, { fields: "id,name", filtering: ACTIVE_FILTER, limit: 500 }),
      ...WINDOWS.map(insightsFor),
    ]);
    const rowsByWindow = Object.fromEntries(WINDOWS.map((w, i) => [w, windowRows[i]]));

    // Account totals (the benchmark every creative is compared with), summed from the same rows.
    const baseline = {};
    for (const w of WINDOWS) {
      const agg = emptyAgg();
      for (const row of rowsByWindow[w]) addInsightsRow(agg, row);
      const d = derive(agg);
      baseline[w] = { spend: d.spend, roas: d.roas, ctr: d.ctr, cpc: d.cpc, cpr: d.cpr };
    }

    // Per-ad totals for every window.
    const perAd = new Map();
    for (const w of WINDOWS) {
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
    for (const [id, entry] of perAd) if (!entry.adsetId && activeById.get(id)) entry.adsetId = activeById.get(id).adset_id;

    // Which ad sets are purchase-optimized: the active ones come with the list; an ad that delivered in a
    // since-paused ad set needs its ad set looked up.
    const adsetInfo = new Map((activeAdsets.data || []).map((a) => [a.id, a]));
    const unknownAdsets = [...new Set([...perAd.values()].map((e) => e.adsetId).filter((id) => id && !adsetInfo.has(id)))];
    const lookups = await Promise.allSettled(chunk(unknownAdsets, 50).map((ids) => graphGet("", token, { ids: ids.join(","), fields: `name,campaign_id,${ADSET_OPTIMIZATION_FIELDS}` })));
    for (const l of lookups) {
      if (l.status !== "fulfilled") continue;
      for (const [id, obj] of Object.entries(l.value || {})) adsetInfo.set(id, { id, ...obj });
    }

    // Candidates: ads in purchase-optimized ad sets. Most-spent first; every active ad is kept.
    let ids = [...perAd.entries()].filter(([, e]) => isPurchaseOptimized(adsetInfo.get(e.adsetId))).map(([id]) => id);
    const spend30 = (id) => perAd.get(id).aggs[30]?.spend || 0;
    ids.sort((a, b) => spend30(b) - spend30(a));
    if (ids.length > MAX_ADS) {
      const keep = new Set(ids.slice(0, MAX_ADS));
      for (const id of ids) if (activeById.has(id)) keep.add(id);
      ids = ids.filter((id) => keep.has(id));
    }

    const details = await fetchAdDetails(ids, token);
    const postIds = [...new Set(Object.values(details).map((d) => d.postId).filter(Boolean))];
    let postUrls = {};
    try {
      postUrls = await fetchPostLandingUrls(postIds, token);
    } catch {}
    const campaignName = new Map((activeCampaigns.data || []).map((c) => [c.id, c.name]));
    const missingCampaigns = [...new Set([...adsetInfo.values()].map((a) => a.campaign_id).filter((id) => id && !campaignName.has(id)))];
    const nameLookups = await Promise.allSettled(chunk(missingCampaigns, 50).map((cs) => graphGet("", token, { ids: cs.join(","), fields: "name" })));
    for (const l of nameLookups) {
      if (l.status !== "fulfilled") continue;
      for (const [id, obj] of Object.entries(l.value || {})) if (obj?.name) campaignName.set(id, obj.name);
    }
    // Names and creation times of ads that are no longer active come from a lookup by id.
    const pausedInfo = {};
    const needInfo = ids.filter((id) => !activeById.has(id));
    const infoResults = await Promise.allSettled(chunk(needInfo, 50).map((c) => graphGet("", token, { ids: c.join(","), fields: "name,created_time,campaign_id" })));
    for (const r of infoResults) {
      if (r.status !== "fulfilled") continue;
      for (const [id, obj] of Object.entries(r.value || {})) pausedInfo[id] = obj;
    }

    const ads = ids.map((id) => {
      const e = perAd.get(id);
      const d = details[id] || {};
      const active = activeById.get(id);
      const adset = adsetInfo.get(e.adsetId);
      return {
        id,
        name: active?.name || pausedInfo[id]?.name || id,
        adsetId: e.adsetId,
        adsetName: adset?.name || null,
        campaignName: campaignName.get(active?.campaign_id || adset?.campaign_id || pausedInfo[id]?.campaign_id) || null,
        status: activeById.has(id) ? "ACTIVE" : d.status || "PAUSED",
        creativeId: d.creativeId || null,
        landing: d.landingUrl || (d.postId ? postUrls[d.postId] : null) || null,
        thumbnailUrl: d.thumbnailUrl || null,
        format: d.creativeType || null,
        createdTime: active?.created_time || pausedInfo[id]?.created_time || null,
        m: Object.fromEntries(WINDOWS.map((w) => [w, compact(e.aggs[w] || emptyAgg())])),
      };
    });

    res.setHeader("Cache-Control", "private, max-age=300");
    res.status(200).json({ generatedAt: Date.now(), accountId, baseline, ads });
  } catch (err) {
    res.status(err.graphResponse ? 400 : 500).json({ error: err.message || "Request failed" });
  }
}
