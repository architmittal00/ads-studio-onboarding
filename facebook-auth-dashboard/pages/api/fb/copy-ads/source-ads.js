import { getServerSession } from "next-auth/next";
import { authOptions } from "../../auth/[...nextauth]";
import { fetchCopyableAds, classifyAd, DEFAULT_COPY_METRIC_KEYS } from "@/lib/adCopy";
import { deriveRowMetrics } from "@/lib/insightsMetrics";

// Account-wide ad browser for the Copy Ads feature. There's no other
// "browse every ad in an account" picker anywhere in this app — every other
// duplicate/launch flow starts from one specific, already-on-screen ad or ad
// set (see pages/api/fb/ads-list.js's own comment on why it has no list
// mode) — so this is new. Each ad is classified copyable/not up front (with
// why) so an unsupported ad (Catalog, Dynamic Creative) is shown disabled in
// the picker rather than selectable and only failing later in the copy step.
//
// Required `since`/`until` (YYYY-MM-DD) bound the pull to ads with real
// delivery in that window — see lib/adCopy.js's fetchCopyableAds for why
// this can't be optional: there is no way to list only "recent" ads
// straight off `/ads` itself (that edge's own `time_range`/`date_preset`
// params don't filter which rows come back at all, despite looking like
// they should), so skipping the range here would walk every ad the account
// has ever had, with this fields string's depth — exactly what previously
// produced both a "reduce the amount of data" error and, after a first
// (incomplete) fix, a straight FUNCTION_INVOCATION_TIMEOUT on a busier
// account. pages/copy-ads.js never lets "Load Ads" be clicked without a
// resolved range, so this 400 should only ever be hit by a direct API call.
export default async function handler(req, res) {
  const session = await getServerSession(req, res, authOptions);
  if (!session?.accessToken) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  const { accountId, since, until, metrics } = req.query;
  if (!accountId) {
    return res.status(400).json({ error: "accountId is required" });
  }
  if (!since || !until) {
    return res.status(400).json({ error: "since and until are required" });
  }

  // `metrics` is a comma-separated list of lib/insightsMetrics.js catalog
  // keys chosen by the picker's metric picker — falls back to this
  // feature's own default column set when omitted (including on a direct
  // API call with no `metrics` param at all).
  const metricKeys = typeof metrics === "string" && metrics.trim() ? metrics.split(",").map((k) => k.trim()).filter(Boolean) : DEFAULT_COPY_METRIC_KEYS;

  try {
    const { ads, insightsByAdId } = await fetchCopyableAds(session.accessToken, accountId, { since, until, metricKeys });
    const shaped = ads.map((ad) => {
      const { copyable, reason } = classifyAd(ad);
      return {
        id: ad.id,
        name: ad.name,
        status: ad.status,
        effectiveStatus: ad.effective_status,
        adsetName: ad.adset?.name || null,
        campaignName: ad.campaign?.name || null,
        thumbnailUrl: ad.creative?.thumbnail_url || null,
        isVideo: !!ad.creative?.object_story_spec?.video_data?.video_id,
        copyable,
        reason,
        ...deriveRowMetrics(insightsByAdId.get(ad.id) || {}, metricKeys, []),
      };
    });
    res.status(200).json({ ads: shaped, metricKeys });
  } catch (err) {
    res.status(err.graphResponse ? 400 : 500).json({ error: err.message });
  }
}
