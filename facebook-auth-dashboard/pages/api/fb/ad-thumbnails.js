import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import { fetchAdDetails } from "@/lib/adCreativeDetails";

const MAX_AD_IDS = 1000;

// Thumbnail/video-flag lookup for an exact list of ad ids, split out of
// /api/fb/explore-insights so a top-level Ad-level Explore query can render
// its metrics table the moment the Insights data itself is back, instead of
// also waiting on this (much slower, one-Graph-call-per-50-ads) creative
// lookup — see pages/explore.js's own fetchAdThumbnails()/loadThumbnails for
// how the client fires this in the background and merges the result in once
// it arrives. fetchAdDetails() itself is unchanged and still used
// synchronously by every other includeCreative caller (drill-down expand,
// components/EntityDrillDown.js), where the id list is small enough that the
// wait was never the problem.
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session?.accessToken) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  const { adIds } = req.body || {};
  if (!Array.isArray(adIds) || adIds.length === 0) {
    return res.status(400).json({ error: "adIds is required" });
  }
  const cleanIds = [...new Set(adIds.map(String).map((id) => id.trim()).filter(Boolean))].slice(0, MAX_AD_IDS);

  try {
    const detailsByAdId = await fetchAdDetails(cleanIds, session.accessToken);
    const thumbnails = {};
    for (const id of cleanIds) {
      thumbnails[id] = { thumbnailUrl: detailsByAdId[id]?.thumbnailUrl ?? null, isVideo: !!detailsByAdId[id]?.videoId };
    }
    res.status(200).json({ thumbnails });
  } catch (err) {
    res.status(err.graphResponse ? 400 : 500).json({ error: err.message });
  }
}
