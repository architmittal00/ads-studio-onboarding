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
// Phones get the mobile feed render: Meta lays the ad out for a ~335px-wide
// frame, which fits a phone screen, instead of squeezing the 500px desktop one.
const ALLOWED_FORMATS = new Set(["DESKTOP_FEED_STANDARD", "MOBILE_FEED_STANDARD"]);

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
    const requested = typeof req.query.format === "string" ? req.query.format : AD_FORMAT;
    const adFormat = ALLOWED_FORMATS.has(requested) ? requested : AD_FORMAT;
    const json = await graphGet(`/${adId}/previews`, session.accessToken, { ad_format: adFormat });
    const body = json.data?.[0]?.body || "";
    const srcMatch = body.match(/src="([^"]+)"/);
    if (!srcMatch) {
      return res.status(200).json({ previewUrl: null, warning: "No live preview available for this ad." });
    }
    // The iframe's own natural size, so the client can scale it to fit instead
    // of clipping content that was laid out for a wider frame.
    const width = Number(body.match(/width="(\d+)"/)?.[1]) || null;
    const height = Number(body.match(/height="(\d+)"/)?.[1]) || null;
    res.status(200).json({ previewUrl: srcMatch[1].replace(/&amp;/g, "&"), width, height, format: adFormat });
  } catch (err) {
    res.status(err.graphResponse ? 400 : 500).json({ error: err.message });
  }
}
