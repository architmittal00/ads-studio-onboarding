import { getServerSession } from "next-auth/next";
import { authOptions } from "../../auth/[...nextauth]";
import { graphGet, graphGetInsights } from "@/lib/facebookGraph";
import { fetchPartnershipAds } from "@/lib/partnershipDetection";
import { roasFromRow, pickPurchaseCount, pickPurchaseValue } from "@/lib/metrics";
import { lastNDaysRange, chunk } from "@/lib/adCreativeDetails";

// Backs the "My Partnership Ads" tab and feeds the Overview tab's own
// rollup. Detection (which ads are partnership ads at all) is a live Graph
// check, not a locally-tracked log — see lib/partnershipDetection.js's own
// comment for why, and for what to do if that check turns out not to work
// against a real account. Performance is a plain 30-day Insights lookup
// filtered to exactly those ad ids, same metric derivation
// (roasFromRow/pickPurchaseCount) every other report in this app already
// uses — not reinvented here.
const INSIGHTS_FIELDS = "ad_id,spend,actions,action_values,purchase_roas,ctr,cpm";
const INSIGHTS_CHUNK_SIZE = 50;
const IG_MEDIA_CHUNK_SIZE = 50;
// caption/timestamp/like_count/comments_count/media_url are standard,
// documented fields on the IG Media node (unlike profile_picture_url, which
// only exists on an IG User node — see resolveCreatorAvatars below) — added
// so Creator Hub/My Partnership Ads can show the actual post behind each ad,
// not just its resolved username.
const IG_MEDIA_FIELDS = "id,username,permalink,media_type,media_url,caption,timestamp,like_count,comments_count";
// business_discovery can only look up one username per call (it's a nested
// field on the IG User node, not a batchable id), so this is a cap on how
// many distinct creators get an avatar lookup per request, not a chunk size
// — a generous ceiling for how many unique creators one account's branded
// content realistically has in a single window, not a hard product limit.
const MAX_AVATAR_LOOKUPS = 30;

// CORRECTION, second one (the first — permalink string normalization —
// didn't fix it either, confirmed live): the whole Content Discovery
// ("partnership-ads-advertisable-content") permalink-lookup approach is
// gone. The user supplied two working curls that resolve a creator in two
// much simpler hops, neither needing a Business id or an Instagram Business
// Account selected at all:
//   1. GET /{ad_id}?fields=creative{effective_instagram_media_id,
//      source_instagram_media_id} — the Instagram media id actually behind
//      this ad's creative (lib/partnershipDetection.js's own ad-fields fetch
//      now requests these two directly, no separate call needed for this
//      step).
//   2. GET /{media_id}?fields=username,permalink,media_type — a plain,
//      direct object lookup on that media id. No Business/Content-Discovery
//      scoping at all; this is just "read this object's own username
//      field," the same mechanism any other Graph object field read in this
//      app uses.
// `effective_instagram_media_id` is preferred when present;
// `source_instagram_media_id` (same ad-fields fetch) is the fallback — the
// user's own curl fetched both, implying the first isn't always populated.
async function resolveCreatorsByMediaId(token, ads) {
  const byMediaId = new Map();
  const mediaIds = [...new Set(ads.map((a) => a.instagramMediaId).filter(Boolean))];
  if (mediaIds.length === 0) return { byMediaId, lookupError: null };

  const idChunks = chunk(mediaIds, IG_MEDIA_CHUNK_SIZE);
  const results = await Promise.allSettled(idChunks.map((ids) => graphGet("", token, { ids: ids.join(","), fields: IG_MEDIA_FIELDS })));
  // A failed chunk must not look identical to "no creator found" — see this
  // file's own git history for the earlier, now-removed version of this
  // function, which hit exactly that silent-failure anti-pattern once
  // already (same class of bug lib/adCopy.js's fetchCopyableAds and
  // pages/api/fb/partnership/overview.js's rollupForAdIds were each
  // corrected for too).
  let lookupError = null;
  for (const result of results) {
    if (result.status !== "fulfilled") {
      lookupError = lookupError || result.reason?.message || "Instagram media lookup failed";
      continue;
    }
    for (const media of Object.values(result.value || {})) {
      if (media?.id && media.username) byMediaId.set(media.id, media);
    }
  }
  return { byMediaId, lookupError: byMediaId.size === 0 ? lookupError : null };
}

// Best-effort creator avatars via Instagram's Business Discovery field
// (`GET /{ig-user-id}?fields=business_discovery.username(...){...}`) — the
// ONLY way to get a creator's profile picture at all, since (confirmed
// against Meta's Graph API reference) `profile_picture_url` is a field of
// the IG User node, not the IG Media node resolveCreatorsByMediaId already
// reads; a media object genuinely cannot carry it.
//
// This needs *some* Instagram Business Account id to query through (any one
// this access token manages — it doesn't have to relate to the ads/creators
// being looked up at all, Business Discovery is a public-data lookup by
// username), which is exactly the dependency Overview/My Partnership
// Ads/Creator Hub deliberately dropped as a *requirement* in favor of the
// media-id mechanism above (see this file's git history). So `igUserId` here
// stays fully optional, read-only, and silent-on-failure: callers without a
// connected Instagram Business Account, or where this lookup fails entirely,
// get every row back with no avatar/follower data and no error surfaced —
// never a blocker on seeing ads or creator names, which resolveCreatorsByMediaId
// already handles on its own.
async function resolveCreatorAvatars(token, igUserId, usernames) {
  const byUsername = new Map();
  if (!igUserId || usernames.length === 0) return byUsername;

  const capped = usernames.slice(0, MAX_AVATAR_LOOKUPS);
  const results = await Promise.allSettled(
    capped.map((username) =>
      graphGet(`/${igUserId}`, token, {
        fields: `business_discovery.username(${username}){profile_picture_url,followers_count,name}`,
      }).then((json) => ({ username, discovery: json.business_discovery }))
    )
  );
  for (const result of results) {
    if (result.status !== "fulfilled" || !result.value.discovery) continue;
    const { username, discovery } = result.value;
    byUsername.set(username, {
      profilePictureUrl: discovery.profile_picture_url || null,
      followersCount: discovery.followers_count ?? null,
      displayName: discovery.name || null,
    });
  }
  return byUsername;
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session?.accessToken) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  // igUserId is optional and purely cosmetic — see resolveCreatorAvatars'
  // own comment for why this is never required for the rest of this route.
  const { accountId, since, until, igUserId } = req.query;
  if (!accountId) {
    return res.status(400).json({ error: "accountId is required" });
  }

  const token = session.accessToken;
  // Optional — defaults to the last 30 days, same as this route's own
  // previously-hardcoded window (see lib/partnershipDetection.js's
  // fetchPartnershipAds for why it now needs a bounded range at all).
  const range = since && until ? { since, until } : lastNDaysRange(30, new Date());
  try {
    const ads = await fetchPartnershipAds(token, accountId, range);
    if (ads.length === 0) {
      return res.status(200).json({ ads: [] });
    }

    const idChunks = chunk(
      ads.map((a) => a.adId),
      INSIGHTS_CHUNK_SIZE
    );
    const [insightsResults, creatorResolution] = await Promise.all([
      Promise.allSettled(
        idChunks.map((ids) =>
          graphGetInsights(`/${accountId}/insights`, token, {
            level: "ad",
            fields: INSIGHTS_FIELDS,
            filtering: [{ field: "ad.id", operator: "IN", value: ids }],
            time_range: range,
            limit: 500,
          })
        )
      ),
      resolveCreatorsByMediaId(token, ads).catch((err) => ({ byMediaId: new Map(), lookupError: err.message })),
    ]);
    const { byMediaId, lookupError } = creatorResolution;

    // Avatar lookup runs after creator resolution — it needs the resolved
    // usernames, not the media ids. Failures here never touch
    // creatorUnresolvedReason/summary above; this is additive enrichment
    // only (see resolveCreatorAvatars' own comment).
    const resolvedUsernames = [...new Set([...byMediaId.values()].map((m) => m.username).filter(Boolean))];
    const avatarsByUsername = await resolveCreatorAvatars(token, igUserId, resolvedUsernames).catch(() => new Map());

    const metricsByAdId = new Map();
    for (const result of insightsResults) {
      if (result.status !== "fulfilled") continue;
      for (const row of result.value.data || []) {
        const { spend, roas } = roasFromRow(row);
        const purchases = pickPurchaseCount(row.actions);
        const purchaseValue = pickPurchaseValue(row.action_values);
        metricsByAdId.set(row.ad_id, {
          spend,
          roas,
          purchases,
          purchaseValue,
          cpr: purchases > 0 ? spend / purchases : null,
          ctr: row.ctr != null ? parseFloat(row.ctr) : null,
          cpm: row.cpm != null ? parseFloat(row.cpm) : null,
        });
      }
    }

    // `creatorUnresolvedReason` distinguishes the real, distinct causes an
    // ad's creator can still be missing — "no instagram media id on this ad
    // at all" (a standard, non-branded-content-sourced ad or one whose
    // branded-content permission predates this field being set) is a
    // meaningfully different situation from "the media lookup call itself
    // failed" or "the media id no longer resolves" (deleted post, revoked
    // access).
    const summary = { resolved: 0, noMediaId: 0, lookupFailed: 0, noMatch: 0 };
    const enriched = ads.map((ad) => {
      const media = ad.instagramMediaId ? byMediaId.get(ad.instagramMediaId) : null;
      let creatorUnresolvedReason = null;
      if (media?.username) {
        summary.resolved += 1;
      } else if (!ad.instagramMediaId) {
        creatorUnresolvedReason = "This ad's creative has no linked Instagram media id (effective_instagram_media_id/source_instagram_media_id).";
        summary.noMediaId += 1;
      } else if (lookupError) {
        creatorUnresolvedReason = `The Instagram media lookup itself failed: ${lookupError}`;
        summary.lookupFailed += 1;
      } else {
        creatorUnresolvedReason = "Could not read this Instagram media's username (deleted post, or access no longer granted).";
        summary.noMatch += 1;
      }
      const avatar = media?.username ? avatarsByUsername.get(media.username) : null;
      return {
        ...ad,
        ...(metricsByAdId.get(ad.adId) || {}),
        creatorUsername: media?.username || null,
        creatorUnresolvedReason,
        creatorProfilePictureUrl: avatar?.profilePictureUrl || null,
        creatorFollowersCount: avatar?.followersCount ?? null,
        postCaption: media?.caption || null,
        postTimestamp: media?.timestamp || null,
        postLikeCount: media?.like_count ?? null,
        postCommentsCount: media?.comments_count ?? null,
      };
    });
    res.status(200).json({ ads: enriched, creatorResolutionSummary: summary });
  } catch (err) {
    res.status(err.graphResponse ? 400 : 500).json({ error: err.message });
  }
}
