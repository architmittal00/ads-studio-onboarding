import { getServerSession } from "next-auth/next";
import { authOptions } from "../../auth/[...nextauth]";
import { fetchCopyableAds, classifyAd } from "@/lib/adCopy";

// Account-wide ad browser for the Copy Ads feature. There's no other
// "browse every ad in an account" picker anywhere in this app — every other
// duplicate/launch flow starts from one specific, already-on-screen ad or ad
// set (see pages/api/fb/ads-list.js's own comment on why it has no list
// mode) — so this is new. Each ad is classified copyable/not up front (with
// why) so an unsupported ad (Catalog, Dynamic Creative) is shown disabled in
// the picker rather than selectable and only failing later in the copy step.
//
// Optional `since`/`until` (YYYY-MM-DD) narrow the pull to ads active in
// that window — for any account with real history, an unfiltered pull of
// every ad ever created with this fields string's depth is exactly what
// trips Meta's "Please reduce the amount of data you're asking for" error.
// pages/copy-ads.js defaults to a bounded preset rather than leaving this
// unset, precisely to avoid landing back in that error by default.
export default async function handler(req, res) {
  const session = await getServerSession(req, res, authOptions);
  if (!session?.accessToken) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  const { accountId, since, until } = req.query;
  if (!accountId) {
    return res.status(400).json({ error: "accountId is required" });
  }

  try {
    const ads = await fetchCopyableAds(session.accessToken, accountId, { since, until });
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
        copyable,
        reason,
      };
    });
    res.status(200).json({ ads: shaped });
  } catch (err) {
    res.status(err.graphResponse ? 400 : 500).json({ error: err.message });
  }
}
