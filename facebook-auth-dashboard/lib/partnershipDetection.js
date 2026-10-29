import { graphGet, graphGetInsights } from "./facebookGraph";
import { normalizeStatus } from "./statusNormalize";
import { lastNDaysRange, chunk } from "./adCreativeDetails";

// `effective_instagram_media_id`/`source_instagram_media_id` are what
// pages/api/fb/partnership/mine.js's creator resolution now reads — a plain
// GET on that media id directly returns its own `username`, no Business id
// or Content Discovery scoping needed at all (replaced the old
// `instagram_permalink_url`-based approach, which never reliably resolved
// against a real account — see mine.js's own comment for the full history).
const PARTNERSHIP_AD_FIELDS =
  "id,name,status,effective_status,adset{id,name},campaign{id,name}," +
  "creative{id,thumbnail_url,facebook_branded_content,instagram_branded_content,branded_content,effective_object_story_id,effective_instagram_media_id,source_instagram_media_id}";
const AD_ID_CHUNK_SIZE = 50;

// Which ads in this account had real delivery (spend/impressions) in a
// window — a cheap `/insights`, `ad_id`-only query, which genuinely respects
// `time_range` (unlike `/ads` itself, see fetchPartnershipAds's own history
// below). Exported on its own so a caller that needs the FULL candidate set
// — not just the partnership subset fetchPartnershipAds filters down to —
// can get it without a second, duplicate discovery call. `overview.js` is
// exactly that caller: it needs "every ad with delivery in this window" to
// compute the Normal-ads side as partnership's own complement, not Meta's
// `NOT_IN` filtering (see that file's own comment on why `NOT_IN` turned out
// not to be reliable here).
export async function discoverDeliveringAdIds(token, adAccountId, range) {
  const insights = await graphGetInsights(`/${adAccountId}/insights`, token, {
    level: "ad",
    fields: "ad_id",
    time_range: range,
    limit: 500,
  });
  return [...new Set((insights.data || []).map((row) => row.ad_id).filter(Boolean))];
}

// Fetches this function's own heavier per-ad fields for an already-known set
// of ad ids and filters down to the ones that are actually Partnership
// (branded content) ads — split out from fetchPartnershipAds below so a
// caller that's already run discoverDeliveringAdIds itself (overview.js)
// doesn't pay for that discovery query twice.
//
// The mechanism: facebook_branded_content / instagram_branded_content /
// branded_content are the exact params pages/api/fb/partnership/launch.js
// (and Meta's own Ads Manager, presumably) sets when creating a branded-
// content creative — see lib/partnershipAds.js's createBrandedCreative. Most
// Graph API object fields are readable back with the same name they're
// written with, so asking for them here should, in principle, surface every
// ad whose creative has them set, regardless of who created it. CONFIRMED
// against a real account (Copy Ads' own picker correctly flags these same
// ads as "Partnership ad — from existing post").
export async function classifyPartnershipAds(token, adIds) {
  if (adIds.length === 0) return [];

  const idChunks = chunk(adIds, AD_ID_CHUNK_SIZE);
  const results = await Promise.allSettled(
    idChunks.map((ids) => graphGet("", token, { ids: ids.join(","), fields: PARTNERSHIP_AD_FIELDS }))
  );
  const ads = [];
  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    for (const ad of Object.values(result.value || {})) {
      if (ad?.id) ads.push(ad);
    }
  }

  return ads
    .filter((ad) => {
      const c = ad.creative;
      return !!c && (c.facebook_branded_content || c.instagram_branded_content || c.branded_content);
    })
    .map((ad) => ({
      adId: ad.id,
      name: ad.name,
      status: normalizeStatus(ad.effective_status) || ad.status,
      campaignId: ad.campaign?.id || null,
      campaignName: ad.campaign?.name || null,
      adsetId: ad.adset?.id || null,
      adsetName: ad.adset?.name || null,
      creativeId: ad.creative?.id || null,
      // Prefer `effective_instagram_media_id` — `source_instagram_media_id`
      // is the fallback the user's own curl also fetched, implying the
      // effective one isn't always populated.
      instagramMediaId: ad.creative?.effective_instagram_media_id || ad.creative?.source_instagram_media_id || null,
      thumbnailUrl: ad.creative?.thumbnail_url || null,
    }));
}

// `since`/`until` bound this to ads with real delivery in that window —
// CORRECTION (reported as the Overview/My Partnership Ads tabs throwing
// "Unexpected token 'A', "An error o"... is not valid JSON", see
// lib/fetchJson.js's own comment on what that actually means): this
// function used to call graphGetAllPages(`/${adAccountId}/ads`) with no
// bound at all — up to MAX_PAGES × 500 = 25,000 ads, each with this
// function's own nested creative fields, walked in one request. For any
// account with real history that's exactly the kind of query that exceeds
// Vercel's function timeout, which serves its own generic non-JSON error
// page — the client-side symptom reported, not a real app error. Fixed by
// discovering the bounded candidate set first (discoverDeliveringAdIds
// above), then fetching this function's heavier per-ad fields only for
// that set (classifyPartnershipAds above). Same accepted trade-off Copy Ads
// already documents: an ad with zero delivery in the window won't show up
// here even if it's a real partnership ad — there's no other server-side-
// bounded way to ask this API for "active" ads. Defaults to the last 30
// days when omitted, matching pages/api/fb/partnership/mine.js's own
// pre-existing (hardcoded) 30-day assumption for its metrics, so neither
// existing caller changes behavior by not passing a range explicitly.
export async function fetchPartnershipAds(token, adAccountId, { since, until } = {}) {
  const range = since && until ? { since, until } : lastNDaysRange(30, new Date());
  const adIds = await discoverDeliveringAdIds(token, adAccountId, range);
  return classifyPartnershipAds(token, adIds);
}
