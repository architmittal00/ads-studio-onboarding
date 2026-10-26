import { requireCatalogAdsRequest } from "@/lib/catalogAds/apiGuard";
import { graphPost } from "@/lib/facebookGraph";

const MAX_VIDEO_BYTES = 1_000_000_000;

// Resumable video upload to the ad account's video library — start and
// finish phases only; the chunk transfer in between is its own route
// (upload-video-chunk.js, since it needs a raw-bytes request body instead
// of JSON).
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const session = await requireCatalogAdsRequest(req, res);
  if (!session) return;

  const { accountId, phase, size, session: uploadSessionId, name } = req.body || {};
  if (!accountId || !phase) {
    return res.status(400).json({ error: "accountId and phase are required" });
  }

  try {
    if (phase === "start") {
      const bytes = Number(size);
      if (!(bytes > 0) || bytes > MAX_VIDEO_BYTES) {
        return res.status(400).json({ error: "Use a video under 1 GB." });
      }
      const json = await graphPost(`/${accountId}/advideos`, session.accessToken, { upload_phase: "start", file_size: bytes });
      return res.status(200).json(json);
    }
    if (phase === "finish") {
      if (!uploadSessionId) return res.status(400).json({ error: "session is required to finish an upload" });
      const json = await graphPost(`/${accountId}/advideos`, session.accessToken, {
        upload_phase: "finish",
        upload_session_id: uploadSessionId,
        title: name || "Video",
      });
      return res.status(200).json(json);
    }
    return res.status(400).json({ error: "Unknown upload phase" });
  } catch (err) {
    res.status(err.graphResponse ? 400 : 500).json({ error: err.message });
  }
}
