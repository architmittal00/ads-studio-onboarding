import { getServerSession } from "next-auth/next";
import { authOptions } from "../../auth/[...nextauth]";
import { fetchAdsInAdsetForCopy, classifyAd } from "@/lib/adCopy";

// Cross-account-copy-ready ad listing for one ad set — the Ad Set/Campaign-
// level copy flows' own version of source-ads.js, scoped by `adsetId`
// instead of `accountId` + a date range. No date/metric filtering at all:
// "copy this ad set" means every ad actually in it right now, not just ones
// with recent delivery (lib/adCopy.js's fetchAdsInAdsetForCopy is built for
// exactly this). Streams the same NDJSON `ads_batch`/`done` convention as
// source-ads.js, just without the metric columns that page's picker needs
// and this one doesn't.
export default async function handler(req, res) {
  const session = await getServerSession(req, res, authOptions);
  if (!session?.accessToken) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  const { adsetId } = req.query;
  if (!adsetId) {
    return res.status(400).json({ error: "adsetId is required" });
  }

  res.writeHead(200, { "Content-Type": "application/x-ndjson", "Cache-Control": "no-cache" });

  function shapeAd(ad) {
    const { copyable, reason, kind, isBrandedContent } = classifyAd(ad);
    return {
      id: ad.id,
      name: ad.name,
      status: ad.status,
      thumbnailUrl: ad.creative?.thumbnail_url || null,
      isVideo: !!ad.creative?.object_story_spec?.video_data?.video_id,
      copyable,
      reason,
      kind,
      isBrandedContent: !!isBrandedContent,
    };
  }

  try {
    await fetchAdsInAdsetForCopy(session.accessToken, adsetId, {
      onBatch: (batchAds) => {
        res.write(`${JSON.stringify({ type: "ads_batch", ads: batchAds.map(shapeAd) })}\n`);
      },
    });
    res.write(`${JSON.stringify({ type: "done" })}\n`);
  } catch (err) {
    // Headers already sent — same constraint/convention as source-ads.js's
    // own catch block.
    res.write(`${JSON.stringify({ type: "done", error: err.message })}\n`);
  }
  res.end();
}
