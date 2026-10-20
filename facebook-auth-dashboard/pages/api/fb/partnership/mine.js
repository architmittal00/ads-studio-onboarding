import { getServerSession } from "next-auth/next";
import { authOptions } from "../../auth/[...nextauth]";
import { graphGetInsights } from "@/lib/facebookGraph";
import { fetchPartnershipAds } from "@/lib/partnershipDetection";
import { lookupContent } from "@/lib/partnershipAds";
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
// The Content Discovery API's own direct-lookup cap on how many permalinks
// one call can resolve at once (same limit lib/partnershipAds.js's
// lookupContent documents for ad_codes/permalinks/content_ids).
const PERMALINK_LOOKUP_CHUNK_SIZE = 50;

// CORRECTION (reported live: "most ads are classified as unknown" — i.e.
// creatorUsername came back null for nearly every ad): this Map used to be
// keyed by the exact, byte-for-byte `permalink` string, on both sides —
// Meta's own echoed-back `item.permalink` from the Content Discovery lookup
// is not guaranteed to be byte-identical to the ad creative's own
// `instagram_permalink_url` even when they're the same post (protocol,
// `www.`, a trailing slash, or a tracking query string are all things Meta's
// various endpoints are inconsistent about including), so a strict Map.get
// silently missed real matches far more often than it should have.
// normalizePermalink reduces both sides to the same bare host+path before
// comparing, which is safe regardless of which side (if either) included
// the extra noise. This is the one concrete, confirmable-from-code fix;
// it does NOT rule out the separate possibility that the Content Discovery
// API's own "advertisable content" index simply doesn't have a record for
// some of these ads at all (e.g. ads sourced outside this app's own
// permission-request flow) — that would still show as no match, and can
// only be confirmed against a real account. See PROJECT_STATUS.md.
function normalizePermalink(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    return `${u.hostname.replace(/^www\./, "")}${u.pathname.replace(/\/+$/, "")}`.toLowerCase();
  } catch {
    return url.replace(/\/+$/, "").toLowerCase();
  }
}

// Resolves each ad's underlying creator (display name/ig id) by matching its
// creative's own `instagram_permalink_url` back through the Content
// Discovery API's permalink lookup — there's no `creator`/`author` field on
// an Ad or AdCreative object directly, so this is the only path from "an ad
// that happens to be branded content" to "whose content it actually is."
// Best-effort: an ad whose permalink doesn't resolve (deleted post, access
// restriction, lookup failure) just keeps `creatorUsername: null` rather
// than failing the whole request.
//
// Reported "persists" after the permalink-normalization fix (see
// normalizePermalink's own comment) — so that wasn't the whole story.
// `lookupError` is the other, previously-silent failure mode: every chunk's
// own Promise.allSettled rejection used to just be `continue`d past with no
// trace at all (the identical anti-pattern already corrected once in
// lib/adCopy.js's fetchCopyableAds and again in pages/api/fb/partnership/overview.js's
// rollupForAdIds) — so a genuinely failing lookupContent call (bad
// permission, wrong business, malformed param) would look exactly like
// "found no matches," indistinguishable from the handler's own perspective.
// Surfaced now (only when NOTHING resolved at all — a partial failure that
// still produced real matches isn't worth alarming over) so the per-ad
// `creatorUnresolvedReason` built in the handler below can say which of the
// real, distinct causes actually applies instead of a single flat "—".
async function resolveCreators(token, businessId, igUserId, ads) {
  const byPermalink = new Map();
  const withPermalink = ads.filter((a) => a.instagramPermalinkUrl);
  if (!businessId || !igUserId || withPermalink.length === 0) {
    return { byPermalink, lookupError: null };
  }

  const chunks = chunk(
    withPermalink.map((a) => a.instagramPermalinkUrl),
    PERMALINK_LOOKUP_CHUNK_SIZE
  );
  const results = await Promise.allSettled(chunks.map((permalinks) => lookupContent(token, businessId, { igUserId, permalinks })));
  let lookupError = null;
  for (const result of results) {
    if (result.status !== "fulfilled") {
      lookupError = lookupError || result.reason?.message || "Content lookup failed";
      continue;
    }
    for (const item of result.value) {
      const key = normalizePermalink(item.permalink);
      if (key) byPermalink.set(key, item.author);
    }
  }
  return { byPermalink, lookupError: byPermalink.size === 0 ? lookupError : null };
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session?.accessToken) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  const { accountId, businessId, igUserId, since, until } = req.query;
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
      resolveCreators(token, businessId, igUserId, ads).catch((err) => ({ byPermalink: new Map(), lookupError: err.message })),
    ]);
    const { byPermalink: creatorsByPermalink, lookupError } = creatorResolution;

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
    // ad's creator can be missing — previously every one of these collapsed
    // into the same flat "—" with no way to tell "this ad has no permalink
    // at all" from "the lookup call itself is failing" from "the lookup
    // genuinely has no record for this content." See resolveCreators' own
    // comment above and PROJECT_STATUS.md for which of these turns out to be
    // the actual dominant cause on a real account — not yet known from here.
    const summary = { resolved: 0, noPermalink: 0, noAccountSelected: 0, lookupFailed: 0, noMatch: 0 };
    const enriched = ads.map((ad) => {
      const key = normalizePermalink(ad.instagramPermalinkUrl);
      const author = key ? creatorsByPermalink.get(key) : null;
      let creatorUnresolvedReason = null;
      if (author) {
        summary.resolved += 1;
      } else if (!ad.instagramPermalinkUrl) {
        creatorUnresolvedReason = "This ad's creative has no Instagram permalink to look up.";
        summary.noPermalink += 1;
      } else if (!businessId || !igUserId) {
        creatorUnresolvedReason = "No Instagram Business Account selected — pick one (e.g. on the Explore Ads tab) to resolve creator names.";
        summary.noAccountSelected += 1;
      } else if (lookupError) {
        creatorUnresolvedReason = `The creator lookup itself failed: ${lookupError}`;
        summary.lookupFailed += 1;
      } else {
        creatorUnresolvedReason = "No matching content found for this permalink in the Partnership Ads content index.";
        summary.noMatch += 1;
      }
      return {
        ...ad,
        ...(metricsByAdId.get(ad.adId) || {}),
        creatorUsername: author?.display_name || null,
        creatorIgId: author?.ig_user_id || null,
        creatorUnresolvedReason,
      };
    });
    res.status(200).json({ ads: enriched, creatorResolutionSummary: summary });
  } catch (err) {
    res.status(err.graphResponse ? 400 : 500).json({ error: err.message });
  }
}
