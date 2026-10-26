import { requireCatalogAdsRequest } from "@/lib/catalogAds/apiGuard";
import { graphGet } from "@/lib/facebookGraph";

// Meta processes an uploaded video before it can be used in an ad — polled
// client-side (components/catalogads/videoUpload.js) until ready/error.
export default async function handler(req, res) {
  const session = await requireCatalogAdsRequest(req, res);
  if (!session) return;

  const { videoId } = req.query;
  if (!videoId) {
    return res.status(400).json({ error: "videoId is required" });
  }

  try {
    const json = await graphGet(`/${videoId}`, session.accessToken, { fields: "status" });
    res.status(200).json({ status: json.status?.video_status || "processing", progress: json.status?.processing_progress ?? null });
  } catch (err) {
    res.status(err.graphResponse ? 400 : 500).json({ error: err.message });
  }
}
