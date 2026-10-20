import { graphGet, graphGetInsights } from "./facebookGraph";
import { lastNDaysRange, chunk } from "./adCreativeDetails";

// Finds which of an ad account's existing ads are Partnership (branded
// content) ads — this is what lets "My Partnership Ads" show ads created
// manually in Ads Manager, not just ones launched through this app.
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
//
// `since`/`until` bound this to ads with real delivery in that window —
// CORRECTION (reported as the Overview/My Partnership Ads tabs throwing
// "Unexpected token 'A', "An error o"... is not valid JSON", see
// lib/fetchJson.js's own comment on what that actually means): this
// function used to call graphGetAllPages(`/${adAccountId}/ads`) with no
// bound at all — up to MAX_PAGES × 500 = 25,000 ads, each with this
// function's own nested creative fields, walked in one request. For any
// account with real history that's exactly the kind of query that exceeds
// Vercel's function timeout, which serves its own generic non-JSON error
// page — the client-side symptom reported, not a real app error. Fixed the
// same way lib/adCopy.js's fetchCopyableAds already was for the identical
// problem: a cheap `/insights`, ad_id-only query first (which genuinely
// respects `time_range`, unlike `/ads` itself) to find which ads had
// delivery in the window, then this function's heavier per-ad fields only
// for that bounded candidate set. Same accepted trade-off Copy Ads already
// documents: an ad with zero delivery in the window won't show up here even
// if it's a real partnership ad — there's no other server-side-bounded way
// to ask this API for "active" ads. Defaults to the last 30 days when
// omitted, matching pages/api/fb/partnership/mine.js's own pre-existing
// (hardcoded) 30-day assumption for its metrics, so neither existing caller
// changes behavior by not passing a range explicitly.
const PARTNERSHIP_AD_FIELDS =
  "id,name,status,effective_status,adset{id,name},campaign{id,name}," +
  "creative{id,facebook_branded_content,instagram_branded_content,branded_content,effective_object_story_id,instagram_permalink_url}";
const AD_ID_CHUNK_SIZE = 50;

export async function fetchPartnershipAds(token, adAccountId, { since, until } = {}) {
  const range = since && until ? { since, until } : lastNDaysRange(30, new Date());

  const insights = await graphGetInsights(`/${adAccountId}/insights`, token, {
    level: "ad",
    fields: "ad_id",
    time_range: range,
    limit: 500,
  });
  const adIds = [...new Set((insights.data || []).map((row) => row.ad_id).filter(Boolean))];
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
      status: ad.effective_status || ad.status,
      campaignId: ad.campaign?.id || null,
      campaignName: ad.campaign?.name || null,
      adsetId: ad.adset?.id || null,
      adsetName: ad.adset?.name || null,
      creativeId: ad.creative?.id || null,
      instagramPermalinkUrl: ad.creative?.instagram_permalink_url || null,
    }));
}
