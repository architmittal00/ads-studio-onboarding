import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import { graphGet } from "@/lib/facebookGraph";

// Feed format renders both image and video creatives (including unpublished
// "dark post" ads that were never posted to the Page — common for ads built
// directly in Ads Manager) the same way they'd actually appear to a viewer,
// which is exactly the case the Handover Report's creative lightbox needs:
// the Video object's own `source`/`embed_html` fields routinely deny access
// to an ad's video file even when every other field about that ad is
// readable with the same token (see pages/api/fb/report/core.js's
// fetchVideoSources), but the Ad Previews API renders the ad through
// Facebook's own preview tool instead of exposing the raw file, so it isn't
// subject to that same restriction.
const AD_FORMAT = "DESKTOP_FEED_STANDARD";

// Called on demand (only when a video ad's lightbox is actually opened and
// its direct file URL isn't available) rather than prefetched for every
// video ad up front — an ad can have many video ads, and most will never be
// clicked, so paying for a dedicated Graph call per ad only when needed
// keeps the main report load unaffected.
export default async function handler(req, res) {
  const session = await getServerSession(req, res, authOptions);
  if (!session?.accessToken) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  const { adId } = req.query;
  if (!adId) {
    return res.status(400).json({ error: "adId is required" });
  }

  try {
    const json = await graphGet(`/${adId}/previews`, session.accessToken, { ad_format: AD_FORMAT });
    const body = json.data?.[0]?.body || "";
    const srcMatch = body.match(/src="([^"]+)"/);
    if (!srcMatch) {
      return res.status(200).json({ previewUrl: null, warning: "No live preview available for this ad." });
    }
    res.status(200).json({ previewUrl: srcMatch[1].replace(/&amp;/g, "&") });
  } catch (err) {
    res.status(err.graphResponse ? 400 : 500).json({ error: err.message });
  }
}
