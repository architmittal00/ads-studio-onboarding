import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import { graphGet, graphGetAllPages, graphGetInsights } from "@/lib/facebookGraph";
import { pickPurchaseCount, roasFromRow } from "@/lib/metrics";
import { getCachedReport, setCachedReport } from "@/lib/reportCache";

const RTG_PATTERN = /rtg|retarget/i;
const VALID_DATE = /^\d{4}-\d{2}-\d{2}$/;

const ADSET_PAGE_SIZE = 200;
const ADSET_FIELDS = "id,name,effective_status,daily_budget,lifetime_budget";

const UNKNOWN_LANDING_PAGE_LABEL = "Unknown landing page";
const UNKNOWN_LANDING_PAGE_SPEND_CUTOFF_PCT = 10;

function toDateStr(d) {
  return d.toISOString().slice(0, 10);
}

// Facebook's `date_preset` shortcuts can silently drift from what Ads
// Manager's own date picker shows for "Last N days" (e.g. by one day, or by
// timezone cutoff). Reach-based metrics like frequency are NOT additive
// across days, so even a one-day difference in the window can visibly shift
// them — unlike spend/clicks, which just sum. Using an explicit, fixed
// window (last N full days, not including today) and surfacing the exact
// dates in the UI makes that comparable and debuggable against Ads Manager.
function lastNDaysRange(n, today) {
  const until = new Date(today);
  until.setDate(until.getDate() - 1);
  const since = new Date(until);
  since.setDate(since.getDate() - (n - 1));
  return { since: toDateStr(since), until: toDateStr(until) };
}

// Resolves the report's main date window from query params: a preset
// (today/last_7d/last_30d) or an explicit custom since/until. Falls back to
// last_30d for anything missing/invalid — the previous fixed default.
function resolveRange(query, today) {
  const preset = query.rangePreset || "last_30d";

  if (preset === "today") {
    const d = toDateStr(today);
    return { since: d, until: d, label: "Today", preset };
  }
  if (preset === "last_7d") {
    return { ...lastNDaysRange(7, today), label: "Last 7 Days", preset };
  }
  if (preset === "custom" && VALID_DATE.test(query.since) && VALID_DATE.test(query.until) && query.since <= query.until) {
    return { since: query.since, until: query.until, label: `${query.since} → ${query.until}`, preset };
  }
  return { ...lastNDaysRange(30, today), label: "Last 30 Days", preset: "last_30d" };
}

function daysBetween(since, until) {
  const ms = new Date(`${until}T00:00:00Z`) - new Date(`${since}T00:00:00Z`);
  return Math.round(ms / 86400000) + 1;
}

function settled(result, fallback) {
  return result.status === "fulfilled" ? result.value : fallback;
}

function chunk(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

// Fetches per-ad details (status, thumbnail, video id) for an exact list of
// ad IDs, via the Graph API's `?ids=a,b,c` batch-by-ID endpoint (chunked —
// large ID lists can hit URL/response-size limits). This matters because
// `/act_x/ads` with no filter returns Facebook's default-ordered first N
// ads (oldest-created first) — for any account with real history that's a
// completely different set of ads than the ones with spend in our report
// window, so fetching this way silently returns the wrong (or no) creative
// for most rows. Fetching by the exact IDs we're displaying avoids that.
async function fetchAdDetails(adIds, token) {
  const detailsByAdId = {};
  if (adIds.length === 0) return detailsByAdId;

  const batches = chunk(adIds, 50);
  const results = await Promise.allSettled(
    batches.map((batch) =>
      graphGet("", token, {
        ids: batch.join(","),
        fields:
          "effective_status,creative{thumbnail_url,image_url,video_id,object_type,product_set_id,effective_object_story_id,call_to_action,object_story_spec{link_data{link},video_data{video_id,call_to_action{value{link}}}},asset_feed_spec{link_urls{website_url}}}",
      })
    )
  );

  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    for (const [id, obj] of Object.entries(result.value || {})) {
      const creative = obj.creative || {};
      const videoId = creative.video_id || creative.object_story_spec?.video_data?.video_id || null;
      // A product_set_id means this ad pulls from a catalog (Dynamic Product
      // Ads / Advantage+ catalog ads) rather than being a single fixed
      // image or video creative.
      const creativeType = creative.product_set_id ? "Catalog" : videoId ? "Video" : "Static";
      // The ad's destination URL, checked across the shapes it can show up
      // in. `creative.call_to_action` (top-level, separate from the one
      // nested under object_story_spec.video_data) turned out to be the big
      // one — verified against a real account's "Unknown landing page" ads:
      // 10 of 10 video ads with no object_story_spec/asset_feed_spec at all
      // still carried their destination here. Catalog ads have no single
      // fixed URL — their real destination is generated per-product by
      // Facebook at serve time — so this stays null for them.
      const landingUrl =
        creative.object_story_spec?.link_data?.link ||
        creative.object_story_spec?.video_data?.call_to_action?.value?.link ||
        creative.call_to_action?.value?.link ||
        creative.asset_feed_spec?.link_urls?.[0]?.website_url ||
        null;
      detailsByAdId[id] = {
        status: obj.effective_status || null,
        thumbnailUrl: creative.thumbnail_url || creative.image_url || null,
        videoId,
        creativeType,
        landingUrl,
        // Set only when none of the structured creative fields above had a
        // link (rare now that call_to_action is checked) — resolved as a
        // last resort from the ad's underlying Page post, in a follow-up
        // batch by fetchPostLandingUrls().
        postId: !landingUrl ? creative.effective_object_story_id || null : null,
      };
    }
  }

  return detailsByAdId;
}

// Fallback landing-URL resolution for ads with no link anywhere in their own
// creative fields (object_story_spec / asset_feed_spec) — these are ads
// built by boosting an existing Page post rather than creating a new link
// ad, extremely common for video/Reels creative. The destination lives on
// the post itself instead: its own `link` field for a link-share post, a
// link-out call-to-action button, or an attachment's URL. Requires
// pages_read_engagement for Pages the token's user doesn't manage directly —
// failures are expected for some posts and handled per-ID (Facebook returns
// an {error} object for just that ID rather than failing the whole batch),
// so those ads simply stay unresolved rather than breaking the request.
async function fetchPostLandingUrls(postIds, token) {
  const urlByPostId = {};
  if (postIds.length === 0) return urlByPostId;

  const batches = chunk(postIds, 50);
  const results = await Promise.allSettled(
    batches.map((batch) =>
      graphGet("", token, {
        ids: batch.join(","),
        fields: "link,call_to_action,attachments{url,unshimmed_url}",
      })
    )
  );

  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    for (const [id, obj] of Object.entries(result.value || {})) {
      const attachment = obj.attachments?.data?.[0];
      const url = obj.link || obj.call_to_action?.value?.link || attachment?.unshimmed_url || attachment?.url || null;
      if (url) urlByPostId[id] = url;
    }
  }

  return urlByPostId;
}

// Resolves a direct, playable video URL for each video ID (Facebook's Video
// object `source` field), so the creative lightbox can actually play video
// ads instead of just showing their static thumbnail.
async function fetchVideoSources(videoIds, token) {
  const sourceByVideoId = {};
  if (videoIds.length === 0) return sourceByVideoId;

  const batches = chunk(videoIds, 50);
  const results = await Promise.allSettled(
    batches.map((batch) => graphGet("", token, { ids: batch.join(","), fields: "source" }))
  );

  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    for (const [id, obj] of Object.entries(result.value || {})) {
      if (obj.source) sourceByVideoId[id] = obj.source;
    }
  }

  return sourceByVideoId;
}

// Facebook's bulk `/act_x/insights?level=ad` call — the one the main
// ad-level query above uses, fetching every ad's data in one shot — computes
// `reach` (and therefore `frequency = impressions / reach`) correctly for a
// small number of ads, but silently falls over once more than
// FREQUENCY_CHUNK_SIZE ads are reach-deduplicated together in one request:
// `impressions` (a plain sum) stays accurate, but `reach` collapses to a
// much smaller, wrong number, wildly inflating frequency. Confirmed live
// against a real account/ad: querying it alongside 9 others (10 total)
// returned the correct reach (matching Ads Manager and a single-ad query
// exactly); adding just one more ad to the same request (11 total) dropped
// reach from ~205,000 to 721 and inflated frequency from 1 to ~285 — a hard
// cliff at exactly that boundary, not a gradual degradation. This re-fetches
// `frequency` in small, safe-sized chunks (filtered to exact ad IDs via
// `filtering`, which returns synchronously — small enough to never trigger
// Facebook's async-job path) and overwrites the unreliable bulk value.
//
// This is one Graph API call per `FREQUENCY_CHUNK_SIZE` ads, so for an
// account with many hundreds of active ads this is a meaningful number of
// extra requests — chosen deliberately anyway, since a wrong high-frequency
// reading looks exactly like real creative fatigue and sends someone
// investigating a problem that doesn't exist.
const FREQUENCY_CHUNK_SIZE = 10;

async function fetchAccurateFrequency(adIds, accountId, timeRange, token) {
  const frequencyByAdId = {};
  if (adIds.length === 0) return frequencyByAdId;

  const batches = chunk(adIds, FREQUENCY_CHUNK_SIZE);
  const results = await Promise.allSettled(
    batches.map((batch) =>
      graphGetInsights(`/${accountId}/insights`, token, {
        level: "ad",
        fields: "ad_id,frequency",
        time_range: timeRange,
        filtering: [{ field: "ad.id", operator: "IN", value: batch }],
        limit: FREQUENCY_CHUNK_SIZE,
      })
    )
  );

  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    for (const row of result.value?.data || []) {
      frequencyByAdId[row.ad_id] = parseFloat(row.frequency || 0);
    }
  }
  return frequencyByAdId;
}

// Groups `items` (each with spend/revenue/purchases) by `keyFn`, sums each
// group, and — unless `applyCutoff` is false — keeps only the highest-ranked
// groups needed to reach 80% of the total for whichever `metric` is passed
// ("revenue", the default, for the usual "where does 80% of purchase
// revenue come from" framing; "spend" for dimensions — like region, where
// Facebook doesn't return purchase data at all — where spend concentration
// is the only thing there's data for).
function groupAndPareto(items, keyFn, { applyCutoff = true, metric = "revenue" } = {}) {
  const groups = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, { label: key, spend: 0, revenue: 0, purchases: 0 });
    const g = groups.get(key);
    g.spend += item.spend;
    g.revenue += item.revenue;
    g.purchases += item.purchases;
  }

  const allGroups = [...groups.values()].map((g) => ({
    ...g,
    roas: g.spend > 0 ? g.revenue / g.spend : 0,
  }));
  const totalRevenue = allGroups.reduce((sum, g) => sum + g.revenue, 0);
  const totalSpend = allGroups.reduce((sum, g) => sum + g.spend, 0);
  const total = metric === "spend" ? totalSpend : totalRevenue;
  const sorted = [...allGroups].sort((a, b) => b[metric] - a[metric]);

  let cumRevenue = 0;
  let cumSpend = 0;
  const contributors = [];
  for (const g of sorted) {
    if (applyCutoff && g[metric] <= 0) break;
    cumRevenue += g.revenue;
    cumSpend += g.spend;
    const cum = metric === "spend" ? cumSpend : cumRevenue;
    contributors.push({
      ...g,
      revenueSharePct: totalRevenue > 0 ? (g.revenue / totalRevenue) * 100 : 0,
      spendSharePct: totalSpend > 0 ? (g.spend / totalSpend) * 100 : 0,
    });
    if (applyCutoff && total > 0 && cum / total >= 0.8) break;
  }

  return {
    totalGroupCount: allGroups.length,
    contributorCount: contributors.length,
    revenueSharePct: totalRevenue > 0 ? (cumRevenue / totalRevenue) * 100 : 0,
    spendSharePct: totalSpend > 0 ? (cumSpend / totalSpend) * 100 : 0,
    contributors,
  };
}

function bestBucket(rows) {
  if (!rows || !rows.length) return null;
  let best = null;
  for (const row of rows) {
    const { spend, revenue, roas } = roasFromRow(row);
    if (spend <= 0) continue;
    if (!best || roas > best.roas) {
      best = { roas, spend, revenue, since: row.date_start, until: row.date_stop };
    }
  }
  return best;
}

// Facebook returns daily_budget/lifetime_budget in the account currency's
// minor unit (e.g. cents). This doesn't hold for zero-decimal currencies
// (JPY, KRW, etc.) — acceptable simplification for now.
function toMajorUnits(value) {
  return value ? parseFloat(value) / 100 : null;
}

function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function titleCaseSnake(s) {
  return s
    ? s
        .split("_")
        .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w))
        .join(" ")
    : s;
}

// Facebook's `platform_position` values are often already prefixed with the
// platform name (e.g. "instagram_reels", "facebook_reels") — strip that
// redundant prefix before combining with the platform label, so placements
// read "Instagram · Reels" / "Facebook · Reels" rather than
// "Instagram · Instagram Reels".
function placementLabel(platform, position) {
  if (!platform || !position) return null;
  const prefix = `${platform}_`;
  const trimmed = position.startsWith(prefix) ? position.slice(prefix.length) : position;
  return `${titleCaseSnake(platform)} · ${titleCaseSnake(trimmed)}`;
}

// Best-effort "what product is this ad pointing at" derived from its landing
// page URL — Facebook's insights API has no native per-product revenue
// breakdown outside of catalog/DPA reporting, so this reverse-engineers it
// from the destination URL instead. Recognizes the common Shopify-style
// `/products/<handle>` path and turns the handle into a readable label;
// anything else falls back to the raw path, which is still a valid (if less
// pretty) grouping key. Catalog/dynamic-creative ads have no single fixed
// URL (the destination is generated per-product by Facebook at serve time)
// and are called out as their own bucket by the caller rather than through
// this function.
function extractLandingPageLabel(url) {
  if (!url) return null;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const path = parsed.pathname.replace(/\/+$/, "");
  if (!path) return "Homepage";
  const match = path.match(/\/products\/([^/]+)/i);
  if (match) {
    return decodeURIComponent(match[1])
      .replace(/[-_]+/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return path;
}

// The campaigns fetch above (`graphGetAllPages`) paginates the top-level
// campaigns connection, but each campaign's *nested* `adsets` edge has its
// own independent paging cursor — a campaign with more than
// ADSET_PAGE_SIZE ad sets of its own still only comes back with the first
// page, silently, exactly like the top-level truncation this whole change
// is fixing. Rare (most campaigns have far fewer ad sets than that), but
// cheap to check and fix: for any campaign flagged with a `paging.next` on
// its ad sets, fetch the rest directly from `/<campaignId>/adsets` and
// append them.
async function fillTruncatedAdsets(campaignsRaw, token) {
  const needsMore = campaignsRaw.filter((c) => c.adsets?.paging?.next);
  if (needsMore.length === 0) return;

  const results = await Promise.allSettled(
    needsMore.map((c) =>
      graphGetAllPages(`/${c.id}/adsets`, token, { fields: ADSET_FIELDS, limit: ADSET_PAGE_SIZE })
    )
  );

  needsMore.forEach((c, i) => {
    const result = results[i];
    if (result.status !== "fulfilled") return;
    // The first page is already included in c.adsets.data — replace
    // wholesale with the complete, re-fetched list rather than
    // appending, to avoid double-counting it.
    c.adsets.data = result.value.data;
  });
}

function emptyAgg() {
  return { spend: 0, revenue: 0, purchases: 0, creativeIds: new Set() };
}

function addToAgg(agg, ad) {
  agg.spend += ad.spend;
  agg.revenue += ad.revenue;
  agg.purchases += ad.purchases;
  if (ad.spend > 0) agg.creativeIds.add(ad.id);
}

export default async function handler(req, res) {
  const session = await getServerSession(req, res, authOptions);

  if (!session?.accessToken) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  const { accountId } = req.query;
  if (!accountId) {
    return res.status(400).json({ error: "accountId is required" });
  }

  const token = session.accessToken;
  const today = new Date();
  const range = resolveRange(req.query, today);
  // Facebook's `time_range` param rejects any keys beyond since/until — strip
  // the label/preset we attach to `range` for our own response/cache-key use.
  const graphTimeRange = { since: range.since, until: range.until };
  const range7d = lastNDaysRange(7, today);

  const force = req.query.force === "true" || req.query.force === "1";
  const cacheKey = `${session.user?.email || "unknown"}:${accountId}:${range.since}:${range.until}`;

  if (!force) {
    const cached = getCachedReport(cacheKey);
    if (cached) {
      return res.status(200).json({ ...cached.data, cachedAt: cached.fetchedAt, fromCache: true });
    }
  }

  // Trend chart granularity: daily for a month or less, weekly beyond that —
  // mirrors how Ads Manager switches granularity on its own trend charts.
  const rangeDays = daysBetween(range.since, range.until);
  const trendIncrement = rangeDays <= 31 ? 1 : 7;

  const since90 = new Date(today);
  since90.setDate(today.getDate() - 90);
  const since6mo = new Date(today);
  since6mo.setMonth(today.getMonth() - 6);

  const warnings = [];

  const [
    overviewResult,
    trendResult,
    weeklyResult,
    monthlyResult,
    adLevelResult,
    structureResult,
    pixelsResult,
    last7CampaignResult,
    last7AdsetResult,
    ageGenderResult,
    regionResult,
    platformResult,
  ] = await Promise.allSettled([
    graphGetInsights(`/${accountId}/insights`, token, {
      fields: "spend,clicks,ctr,actions,action_values,purchase_roas",
      time_range: graphTimeRange,
    }),
    graphGetInsights(`/${accountId}/insights`, token, {
      fields: "spend,clicks,ctr,actions,action_values,purchase_roas",
      time_range: graphTimeRange,
      time_increment: trendIncrement,
    }),
    graphGetInsights(`/${accountId}/insights`, token, {
      fields: "spend,actions,action_values,purchase_roas",
      time_range: { since: toDateStr(since90), until: toDateStr(today) },
      time_increment: 7,
    }),
    graphGetInsights(`/${accountId}/insights`, token, {
      fields: "spend,actions,action_values,purchase_roas",
      time_range: { since: toDateStr(since6mo), until: toDateStr(today) },
      time_increment: "monthly",
    }),
    graphGetInsights(`/${accountId}/insights`, token, {
      level: "ad",
      fields:
        "ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,spend,impressions,clicks,frequency,actions,action_values",
      time_range: graphTimeRange,
      limit: 500,
    }),
    graphGetAllPages(`/${accountId}/campaigns`, token, {
      fields: `id,name,effective_status,objective,daily_budget,lifetime_budget,adsets.limit(${ADSET_PAGE_SIZE}){${ADSET_FIELDS}}`,
      limit: 200,
    }),
    graphGetAllPages(`/${accountId}/adspixels`, token, {
      fields: "id,name,last_fired_time,creation_time",
    }),
    graphGetInsights(`/${accountId}/insights`, token, {
      level: "campaign",
      fields: "campaign_id,spend",
      time_range: range7d,
      limit: 500,
    }),
    graphGetInsights(`/${accountId}/insights`, token, {
      level: "adset",
      fields: "adset_id,spend",
      time_range: range7d,
      limit: 500,
    }),
    graphGetInsights(`/${accountId}/insights`, token, {
      fields: "spend,actions,action_values,purchase_roas",
      time_range: graphTimeRange,
      breakdowns: "age,gender",
      limit: 500,
    }),
    graphGetInsights(`/${accountId}/insights`, token, {
      fields: "spend,actions,action_values,purchase_roas",
      time_range: graphTimeRange,
      breakdowns: "region",
      limit: 500,
    }),
    graphGetInsights(`/${accountId}/insights`, token, {
      fields: "spend,actions,action_values,purchase_roas",
      time_range: graphTimeRange,
      breakdowns: "publisher_platform,platform_position",
      limit: 500,
    }),
  ]);

  // ── Overview (selected range) ──
  const overviewJson = settled(overviewResult, null);
  if (overviewResult.status === "rejected") warnings.push(`Overview metrics unavailable: ${overviewResult.reason.message}`);
  const overviewRow = overviewJson?.data?.[0];
  const overview = overviewRow
    ? (() => {
        const { spend, revenue, roas } = roasFromRow(overviewRow);
        const clicks = parseFloat(overviewRow.clicks || 0);
        const ctr = parseFloat(overviewRow.ctr || 0);
        const purchases = pickPurchaseCount(overviewRow.actions);
        const cvr = clicks > 0 ? (purchases / clicks) * 100 : 0;
        return { spend, revenue, roas, ctr, purchases, cvr };
      })()
    : { spend: 0, revenue: 0, roas: 0, ctr: 0, purchases: 0, cvr: 0 };

  // ── Trend: per-metric daily/weekly series for the selected range, powers
  // the click-to-drill-down chart on each overview stat ──
  const trendJson = settled(trendResult, null);
  if (trendResult.status === "rejected") warnings.push(`Trend chart data unavailable: ${trendResult.reason.message}`);

  const trendPoints = (trendJson?.data || []).map((row) => {
    const { spend, roas } = roasFromRow(row);
    const clicks = parseFloat(row.clicks || 0);
    const ctr = parseFloat(row.ctr || 0);
    const purchases = pickPurchaseCount(row.actions);
    const cvr = clicks > 0 ? (purchases / clicks) * 100 : 0;
    return { since: row.date_start, until: row.date_stop, spend, purchases, roas, ctr, cvr };
  });
  const trend = { granularity: trendIncrement === 1 ? "daily" : "weekly", points: trendPoints };

  // ── Best week / best month by ROAS (fixed lookback, independent of the
  // selected range — these exist to surface historical context) ──
  const weeklyJson = settled(weeklyResult, null);
  if (weeklyResult.status === "rejected") warnings.push(`Weekly trend unavailable: ${weeklyResult.reason.message}`);
  const monthlyJson = settled(monthlyResult, null);
  if (monthlyResult.status === "rejected") warnings.push(`Monthly trend unavailable: ${monthlyResult.reason.message}`);

  const bestWeek = bestBucket(weeklyJson?.data);
  const bestMonth = bestBucket(monthlyJson?.data);

  // ── Ad-level data: the single source of truth for campaign/adset aggregation ──
  const adLevelJson = settled(adLevelResult, null);
  if (adLevelResult.status === "rejected")
    warnings.push(`Creative-level performance unavailable: ${adLevelResult.reason.message}`);

  const adRowsBase = (adLevelJson?.data || []).map((row) => {
    const { spend, revenue, roas } = roasFromRow(row);
    return {
      id: row.ad_id,
      name: row.ad_name,
      adsetId: row.adset_id,
      adsetName: row.adset_name,
      campaignId: row.campaign_id,
      campaignName: row.campaign_name,
      spend,
      revenue,
      roas,
      purchases: pickPurchaseCount(row.actions),
      frequency: parseFloat(row.frequency || 0),
    };
  });

  const adIds = adRowsBase.map((r) => r.id);

  // Independent of each other — run concurrently rather than one after the
  // other.
  const [adDetailsResult, accurateFrequencyResult] = await Promise.allSettled([
    fetchAdDetails(adIds, token),
    fetchAccurateFrequency(adIds, accountId, graphTimeRange, token),
  ]);

  let adDetailsById = {};
  if (adDetailsResult.status === "fulfilled") {
    adDetailsById = adDetailsResult.value;
  } else {
    warnings.push(`Ad details (status/thumbnail/video) unavailable: ${adDetailsResult.reason.message}`);
  }

  let accurateFrequencyByAdId = {};
  if (accurateFrequencyResult.status === "fulfilled") {
    accurateFrequencyByAdId = accurateFrequencyResult.value;
  } else {
    warnings.push(
      `Could not verify ad-level frequency — showing Facebook's bulk-query value, which can be inflated for large accounts: ${accurateFrequencyResult.reason.message}`
    );
  }

  const videoIds = [...new Set(Object.values(adDetailsById).map((d) => d.videoId).filter(Boolean))];
  let videoSourceByVideoId = {};
  try {
    videoSourceByVideoId = await fetchVideoSources(videoIds, token);
  } catch (err) {
    warnings.push(`Video playback URLs unavailable: ${err.message}`);
  }

  const postIdsNeedingLink = [
    ...new Set(Object.values(adDetailsById).map((d) => d.postId).filter(Boolean)),
  ];
  let postLandingUrlByPostId = {};
  try {
    postLandingUrlByPostId = await fetchPostLandingUrls(postIdsNeedingLink, token);
  } catch (err) {
    warnings.push(`Some ad landing pages (linked via an existing Page post) could not be resolved: ${err.message}`);
  }
  // fetchPostLandingUrls swallows per-batch failures rather than throwing (a
  // permission error on one Page shouldn't block posts on others), so a
  // wholesale permission problem shows up as "tried N posts, resolved none"
  // rather than a caught exception — worth its own warning since it's
  // usually fixable (re-login to (re)grant pages_read_engagement).
  if (postIdsNeedingLink.length > 0 && Object.keys(postLandingUrlByPostId).length === 0) {
    warnings.push(
      `Could not resolve a landing page for ${postIdsNeedingLink.length} ad(s) linked via an existing Page post — likely missing pages_read_engagement access to those Pages. Try logging out and back in to re-grant Page permissions.`
    );
  }

  const adRows = adRowsBase.map((r) => {
    const details = adDetailsById[r.id];
    const isVideo = !!details?.videoId;
    return {
      ...r,
      // Prefer the chunked, verified value; fall back to the original bulk
      // query's (potentially inflated) figure only if that ad's chunk
      // failed to re-fetch — see fetchAccurateFrequency() above.
      frequency: r.id in accurateFrequencyByAdId ? accurateFrequencyByAdId[r.id] : r.frequency,
      status: details?.status || null,
      thumbnailUrl: details?.thumbnailUrl || null,
      isVideo,
      videoUrl: isVideo ? videoSourceByVideoId[details.videoId] || null : null,
      creativeType: details?.creativeType || "Static",
      landingUrl: details?.landingUrl || (details?.postId ? postLandingUrlByPostId[details.postId] : null) || null,
    };
  });

  // Creative recommendation is budget-driven, not benchmarked against the
  // account average: a campaign/ad set only needs more creatives if it is
  // actually leaving its OWN daily budget unspent. We take its current avg
  // spend per creative (its own avgDailySpend7d / creativeCount — a fully
  // utilized budget tells us nothing about the right ratio) and ask how many
  // creatives, at that same rate, would be needed to spend the full daily
  // budget. E.g. ₹10k budget, ₹6k avg daily spend, 2 creatives → ₹3k/creative
  // → ceil(10000/3000) = 4 creatives needed → +2 more.
  // Only meaningful when utilization is under 100% — a fully (or over-)
  // spent budget has nothing left for extra creatives to unlock.
  function creativeRecommendation(agg, { dailyBudget, avgDailySpend7d, utilizationPct }) {
    const creativeCount = agg.creativeIds.size;
    const avgSpendPerCreative = creativeCount > 0 ? avgDailySpend7d / creativeCount : null;
    const isUnderUtilized = utilizationPct != null && utilizationPct < 100;
    if (!isUnderUtilized || !dailyBudget || !avgSpendPerCreative || avgSpendPerCreative <= 0) {
      return { creativeCount, avgSpendPerCreative, recommendedCreatives: null, additionalNeeded: null };
    }
    const recommendedCreatives = Math.ceil(dailyBudget / avgSpendPerCreative);
    return {
      creativeCount,
      avgSpendPerCreative,
      recommendedCreatives,
      additionalNeeded: Math.max(0, recommendedCreatives - creativeCount),
    };
  }

  // ── Account structure: campaigns → ad sets → ads, budget-type aware ──
  const structureJson = settled(structureResult, null);
  if (structureResult.status === "rejected")
    warnings.push(`Account structure unavailable: ${structureResult.reason.message}`);

  const last7CampaignJson = settled(last7CampaignResult, null);
  if (last7CampaignResult.status === "rejected")
    warnings.push(`Campaign budget utilization unavailable: ${last7CampaignResult.reason.message}`);
  const last7AdsetJson = settled(last7AdsetResult, null);
  if (last7AdsetResult.status === "rejected")
    warnings.push(`Ad set budget utilization unavailable: ${last7AdsetResult.reason.message}`);

  const last7SpendByCampaign = {};
  for (const row of last7CampaignJson?.data || []) {
    last7SpendByCampaign[row.campaign_id] = parseFloat(row.spend || 0);
  }
  const last7SpendByAdset = {};
  for (const row of last7AdsetJson?.data || []) {
    last7SpendByAdset[row.adset_id] = parseFloat(row.spend || 0);
  }

  const campaignsRaw = structureJson?.data || [];
  // Per-campaign fetch failures are swallowed inside (allSettled) rather
  // than thrown — a campaign that can't be topped up just keeps its
  // already-fetched first page of ad sets instead of failing the report.
  await fillTruncatedAdsets(campaignsRaw, token);

  const campaigns = campaignsRaw.map((c) => {
    const adsetsRaw = c.adsets?.data || [];

    const campaignDailyBudget = toMajorUnits(c.daily_budget);
    const campaignLifetimeBudget = toMajorUnits(c.lifetime_budget);
    const isCbo = campaignDailyBudget != null || campaignLifetimeBudget != null;
    const hasAdsetBudgets = adsetsRaw.some((a) => a.daily_budget != null || a.lifetime_budget != null);
    const budgetType = isCbo ? "CBO" : hasAdsetBudgets ? "ABO" : "NONE";

    const campAgg = emptyAgg();
    const adsets = adsetsRaw.map((a) => {
      const adsetAgg = emptyAgg();
      const ads = adRows
        .filter((r) => r.adsetId === a.id)
        .map((r) => {
          addToAgg(adsetAgg, r);
          addToAgg(campAgg, r);
          return {
            id: r.id,
            name: r.name,
            status: r.status,
            spend: r.spend,
            revenue: r.revenue,
            roas: r.roas,
            purchases: r.purchases,
            frequency: r.frequency,
            thumbnailUrl: r.thumbnailUrl,
            isVideo: r.isVideo,
            videoUrl: r.videoUrl,
          };
        })
        .sort((x, y) => y.spend - x.spend);

      const adsetDailyBudget = toMajorUnits(a.daily_budget);
      const adsetLifetimeBudget = toMajorUnits(a.lifetime_budget);
      const avgDailySpend7d = (last7SpendByAdset[a.id] || 0) / 7;
      const utilizationPct =
        budgetType === "ABO" && adsetDailyBudget ? (avgDailySpend7d / adsetDailyBudget) * 100 : null;

      return {
        id: a.id,
        name: a.name,
        status: a.effective_status,
        dailyBudget: adsetDailyBudget,
        lifetimeBudget: adsetLifetimeBudget,
        spendInRange: adsetAgg.spend,
        revenueInRange: adsetAgg.revenue,
        purchasesInRange: adsetAgg.purchases,
        roasInRange: adsetAgg.spend > 0 ? adsetAgg.revenue / adsetAgg.spend : 0,
        avgDailySpend7d,
        utilizationPct,
        ...creativeRecommendation(adsetAgg, { dailyBudget: adsetDailyBudget, avgDailySpend7d, utilizationPct }),
        ads,
      };
    });

    const avgDailySpend7dCampaign = (last7SpendByCampaign[c.id] || 0) / 7;
    const campaignUtilizationPct =
      budgetType === "CBO" && campaignDailyBudget ? (avgDailySpend7dCampaign / campaignDailyBudget) * 100 : null;

    return {
      id: c.id,
      name: c.name,
      status: c.effective_status,
      objective: c.objective,
      budgetType,
      dailyBudget: campaignDailyBudget,
      lifetimeBudget: campaignLifetimeBudget,
      spendInRange: campAgg.spend,
      revenueInRange: campAgg.revenue,
      purchasesInRange: campAgg.purchases,
      roasInRange: campAgg.spend > 0 ? campAgg.revenue / campAgg.spend : 0,
      avgDailySpend7d: avgDailySpend7dCampaign,
      utilizationPct: campaignUtilizationPct,
      ...creativeRecommendation(campAgg, {
        dailyBudget: campaignDailyBudget,
        avgDailySpend7d: avgDailySpend7dCampaign,
        utilizationPct: campaignUtilizationPct,
      }),
      adsets,
    };
  });

  // ── Top spending campaigns (derived from the structure tree) ──
  const totalCampaignRevenue = campaigns.reduce((sum, c) => sum + c.revenueInRange, 0);
  const topCampaigns = [...campaigns]
    .map((c) => ({
      id: c.id,
      name: c.name,
      spend: c.spendInRange,
      revenue: c.revenueInRange,
      roas: c.roasInRange,
      revenueSharePct: totalCampaignRevenue > 0 ? (c.revenueInRange / totalCampaignRevenue) * 100 : 0,
    }))
    .sort((a, b) => b.spend - a.spend)
    .slice(0, 10);

  // ── 80% purchase-revenue pareto, at the creative level ──
  const totalRevenue = adRows.reduce((sum, r) => sum + r.revenue, 0);
  const totalSpendAll = adRows.reduce((sum, r) => sum + r.spend, 0);
  const sortedByRevenue = [...adRows].sort((a, b) => b.revenue - a.revenue);

  let cumRevenue = 0;
  let cumSpend = 0;
  const contributors = [];
  for (const r of sortedByRevenue) {
    if (r.revenue <= 0) break;
    cumRevenue += r.revenue;
    cumSpend += r.spend;
    contributors.push(r);
    if (totalRevenue > 0 && cumRevenue / totalRevenue >= 0.8) break;
  }

  const pareto = {
    contributorCount: contributors.length,
    totalAdCount: adRows.length,
    revenueSharePct: totalRevenue > 0 ? (cumRevenue / totalRevenue) * 100 : 0,
    spendSharePct: totalSpendAll > 0 ? (cumSpend / totalSpendAll) * 100 : 0,
    contributors: contributors.map((c) => ({
      id: c.id,
      name: c.name,
      status: c.status,
      campaignName: c.campaignName,
      spend: c.spend,
      revenue: c.revenue,
      roas: c.roas,
      purchases: c.purchases,
      thumbnailUrl: c.thumbnailUrl,
      isVideo: c.isVideo,
      videoUrl: c.videoUrl,
      revenueSharePct: totalRevenue > 0 ? (c.revenue / totalRevenue) * 100 : 0,
    })),
  };

  // ── Where 80% of purchase revenue comes from, by age/gender, by state, and
  // the full (uncut) split by creative type ──
  const ageGenderJson = settled(ageGenderResult, null);
  if (ageGenderResult.status === "rejected")
    warnings.push(`Age/gender breakdown unavailable: ${ageGenderResult.reason.message}`);
  const ageGenderRows = (ageGenderJson?.data || []).map((row) => {
    const { spend, revenue } = roasFromRow(row);
    return { spend, revenue, purchases: pickPurchaseCount(row.actions), age: row.age, gender: row.gender };
  });
  const purchasesByAgeGender = groupAndPareto(
    ageGenderRows,
    (r) => (r.age && r.gender ? `${r.age} · ${capitalize(r.gender)}` : null)
  );

  // Facebook doesn't return purchase/action_values data broken down by
  // region for this account (confirmed: real spend/clicks per state, but
  // zero purchase actions in any row — a Meta Aggregated Event Measurement
  // restriction on geographic breakdowns for web conversions, not a fetch
  // issue here). So this is a spend pareto, not a revenue one like the other
  // breakdowns — top 80% of spend by state, rather than purchase revenue.
  const regionJson = settled(regionResult, null);
  if (regionResult.status === "rejected")
    warnings.push(`Region breakdown unavailable: ${regionResult.reason.message}`);
  const regionRows = (regionJson?.data || []).map((row) => {
    const { spend, revenue } = roasFromRow(row);
    return { spend, revenue, purchases: pickPurchaseCount(row.actions), region: row.region };
  });
  const spendByRegion = groupAndPareto(regionRows, (r) => r.region || null, { metric: "spend" });

  // Only three possible buckets, so show the full split rather than an
  // 80%-cutoff pareto — truncating a 3-way breakdown isn't useful.
  const purchasesByCreativeType = groupAndPareto(adRows, (r) => r.creativeType, { applyCutoff: false });

  // ── Platform & placement (e.g. "Instagram · Reels", "Facebook · Feed") —
  // one combined 80%-of-revenue breakdown rather than a separate full-split
  // "by platform" table and a cut "by placement" table. ──
  const platformJson = settled(platformResult, null);
  if (platformResult.status === "rejected")
    warnings.push(`Platform/placement breakdown unavailable: ${platformResult.reason.message}`);
  const platformRows = (platformJson?.data || []).map((row) => {
    const { spend, revenue } = roasFromRow(row);
    return {
      spend,
      revenue,
      purchases: pickPurchaseCount(row.actions),
      platform: row.publisher_platform,
      position: row.platform_position,
    };
  });
  const purchasesByPlacement = groupAndPareto(platformRows, (r) => placementLabel(r.platform, r.position));

  // ── Where 80% of purchase revenue comes from, by product — reverse-
  // engineered from each ad's landing page URL, since Facebook's insights
  // API has no native per-product revenue breakdown outside of catalog/DPA
  // reporting. Catalog/dynamic-creative ads (no single fixed landing URL —
  // Facebook generates the real destination per-product at serve time) are
  // called out as their own bucket rather than silently dropped, so the
  // "how much of this is actually attributable" gap is visible. ──
  const purchasesByProduct = groupAndPareto(adRows, (r) =>
    r.creativeType === "Catalog"
      ? "Catalog / Dynamic creative (no fixed landing URL)"
      : extractLandingPageLabel(r.landingUrl) || UNKNOWN_LANDING_PAGE_LABEL
  );

  // "Unknown landing page" is shown only once it's a material share of
  // spend (>10%) — below that it's noise (a handful of untracked ads) that
  // just clutters a breakdown meant to highlight where money is going.
  // Decided by spend, not revenue, since the whole point of this bucket is
  // "spend we can't attribute to a product" — the normal 80%-of-revenue
  // cutoff above would otherwise hide it entirely whenever it has little or
  // no attributable revenue, which is exactly the case most worth flagging
  // (spend with nothing to show for it), so this overrides that cutoff's
  // decision in both directions rather than just filtering after the fact.
  const unknownLandingPageAds = adRows.filter((r) => r.creativeType !== "Catalog" && !r.landingUrl);
  const unknownLandingPageSpend = unknownLandingPageAds.reduce((sum, r) => sum + r.spend, 0);
  const unknownLandingPageSpendPct = totalSpendAll > 0 ? (unknownLandingPageSpend / totalSpendAll) * 100 : 0;
  const unknownIdx = purchasesByProduct.contributors.findIndex((c) => c.label === UNKNOWN_LANDING_PAGE_LABEL);

  if (unknownLandingPageSpendPct > UNKNOWN_LANDING_PAGE_SPEND_CUTOFF_PCT) {
    if (unknownIdx === -1 && unknownLandingPageAds.length > 0) {
      const revenue = unknownLandingPageAds.reduce((sum, r) => sum + r.revenue, 0);
      const purchases = unknownLandingPageAds.reduce((sum, r) => sum + r.purchases, 0);
      purchasesByProduct.contributors.push({
        label: UNKNOWN_LANDING_PAGE_LABEL,
        spend: unknownLandingPageSpend,
        revenue,
        roas: unknownLandingPageSpend > 0 ? revenue / unknownLandingPageSpend : 0,
        purchases,
        revenueSharePct: totalRevenue > 0 ? (revenue / totalRevenue) * 100 : 0,
        spendSharePct: unknownLandingPageSpendPct,
      });
      purchasesByProduct.contributorCount += 1;
    }
  } else if (unknownIdx !== -1) {
    purchasesByProduct.contributors.splice(unknownIdx, 1);
    purchasesByProduct.contributorCount -= 1;
  }

  // Keep the section's "X% of revenue / Y% of spend" summary honest after
  // the override above may have added or removed a row outside of
  // groupAndPareto's own 80%-of-revenue cutoff math.
  purchasesByProduct.revenueSharePct =
    totalRevenue > 0
      ? (purchasesByProduct.contributors.reduce((sum, c) => sum + c.revenue, 0) / totalRevenue) * 100
      : 0;
  purchasesByProduct.spendSharePct =
    totalSpendAll > 0
      ? (purchasesByProduct.contributors.reduce((sum, c) => sum + c.spend, 0) / totalSpendAll) * 100
      : 0;

  // The specific ads behind the "Unknown landing page" bucket above, so this
  // is debuggable (in Ads Manager, or by checking the ad's own creative)
  // rather than just a number. Capped to the highest-spend 50 — plenty to
  // investigate without bloating the payload for accounts with many of them.
  const unresolvedLandingPageAds = adRows
    .filter((r) => r.creativeType !== "Catalog" && !r.landingUrl && r.spend > 0)
    .sort((a, b) => b.spend - a.spend)
    .slice(0, 50)
    .map((r) => ({
      id: r.id,
      name: r.name,
      campaignName: r.campaignName,
      adsetName: r.adsetName,
      spend: r.spend,
      creativeType: r.creativeType,
    }));

  // ── High-frequency ads, excluding retargeting campaigns/ad sets ──
  const highFrequencyAds = adRows
    .filter(
      (r) =>
        r.frequency > 3 && !RTG_PATTERN.test(r.campaignName || "") && !RTG_PATTERN.test(r.adsetName || "")
    )
    .map((r) => ({
      id: r.id,
      name: r.name,
      status: r.status,
      campaignName: r.campaignName,
      adsetName: r.adsetName,
      frequency: r.frequency,
      thumbnailUrl: r.thumbnailUrl,
      isVideo: r.isVideo,
      videoUrl: r.videoUrl,
    }))
    .sort((a, b) => b.frequency - a.frequency);

  // ── Budget utilization + creative count, merged, split by who owns the budget ──
  // One row per active CBO campaign / ABO ad set with both concerns side by
  // side, so sorting by utilization% surfaces underspend and sorting by
  // "additional needed" surfaces creative gaps — same underlying row set.
  const budgetUtilization = {
    cboCampaigns: campaigns
      .filter((c) => c.status === "ACTIVE" && c.budgetType === "CBO")
      .map((c) => ({
        id: c.id,
        name: c.name,
        dailyBudget: c.dailyBudget,
        avgDailySpend7d: c.avgDailySpend7d,
        utilizationPct: c.utilizationPct,
        spendInRange: c.spendInRange,
        creativeCount: c.creativeCount,
        avgSpendPerCreative: c.avgSpendPerCreative,
        recommendedCreatives: c.recommendedCreatives,
        additionalNeeded: c.additionalNeeded,
      }))
      .sort((a, b) => (a.utilizationPct ?? Infinity) - (b.utilizationPct ?? Infinity)),
    aboAdsets: campaigns
      .filter((c) => c.budgetType === "ABO")
      .flatMap((c) =>
        c.adsets
          .filter((a) => a.status === "ACTIVE")
          .map((a) => ({
            id: a.id,
            name: a.name,
            campaignName: c.name,
            dailyBudget: a.dailyBudget,
            avgDailySpend7d: a.avgDailySpend7d,
            utilizationPct: a.utilizationPct,
            spendInRange: a.spendInRange,
            creativeCount: a.creativeCount,
            avgSpendPerCreative: a.avgSpendPerCreative,
            recommendedCreatives: a.recommendedCreatives,
            additionalNeeded: a.additionalNeeded,
          }))
      )
      .sort((a, b) => (a.utilizationPct ?? Infinity) - (b.utilizationPct ?? Infinity)),
  };

  // ── Pixel health (best-effort: existence + staleness only) ──
  const pixelsJson = settled(pixelsResult, null);
  if (pixelsResult.status === "rejected")
    warnings.push(`Pixel health unavailable: ${pixelsResult.reason.message}`);

  const pixels = (pixelsJson?.data || []).map((p) => {
    const lastFired = p.last_fired_time ? new Date(p.last_fired_time) : null;
    const daysSinceFired = lastFired ? (Date.now() - lastFired.getTime()) / 86400000 : null;
    return {
      id: p.id,
      name: p.name,
      lastFiredTime: p.last_fired_time || null,
      daysSinceFired,
      status: !lastFired ? "never_fired" : daysSinceFired > 3 ? "stale" : "healthy",
    };
  });

  const pixelConcerns = pixels.filter((p) => p.status !== "healthy");
  if (pixelsJson && pixels.length === 0) {
    pixelConcerns.push({ name: "No pixel connected to this ad account", status: "missing" });
  }

  // Account Structure only shows campaigns/ad sets that actually spent in
  // the selected range — the "what's live and running" view. Budget
  // Utilization above deliberately uses the unfiltered `campaigns` tree
  // instead, since a zero-spend active campaign is exactly the kind of
  // thing that section should be able to flag.
  const structureCampaigns = campaigns
    .filter((c) => c.spendInRange > 0)
    .map((c) => ({ ...c, adsets: c.adsets.filter((a) => a.spendInRange > 0) }));
  const structureAdsetCount = structureCampaigns.reduce((sum, c) => sum + c.adsets.length, 0);

  const payload = {
    dateRange: range,
    trend,
    overview,
    bestWeek,
    bestMonth,
    topCampaigns,
    pareto,
    purchasesByAgeGender,
    spendByRegion,
    purchasesByCreativeType,
    purchasesByPlacement,
    purchasesByProduct,
    unresolvedLandingPageAds,
    highFrequencyAds,
    structure: {
      campaignCount: structureCampaigns.length,
      adsetCount: structureAdsetCount,
      campaigns: structureCampaigns,
    },
    pixelHealth: { pixels, concerns: pixelConcerns },
    budgetUtilization,
    warnings,
  };

  setCachedReport(cacheKey, payload);
  res.status(200).json({ ...payload, cachedAt: Date.now(), fromCache: false });
}
