import { requireCatalogAdsRequest } from "@/lib/catalogAds/apiGuard";
import { graphPostFile } from "@/lib/facebookGraph";

// Video chunks arrive as a raw request body (not JSON — see
// components/catalogads/videoUpload.js's client-side uploader), each under
// Vercel's ~4.5 MB request-body limit, and go to Meta as multipart. Next's
// JSON body parser has to be turned off for this one route so the raw bytes
// reach the handler untouched.
export const config = { api: { bodyParser: false } };

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const session = await requireCatalogAdsRequest(req, res);
  if (!session) return;

  const { accountId, session: uploadSessionId, offset } = req.query;
  if (!accountId || !uploadSessionId || offset === undefined) {
    return res.status(400).json({ error: "accountId, session and offset are required" });
  }

  try {
    const chunk = await readRawBody(req);
    const json = await graphPostFile(
      `/${accountId}/advideos`,
      session.accessToken,
      { upload_phase: "transfer", upload_session_id: uploadSessionId, start_offset: offset },
      { field: "video_file_chunk", data: chunk, filename: "chunk" }
    );
    res.status(200).json(json);
  } catch (err) {
    res.status(err.graphResponse ? 400 : 500).json({ error: err.message });
  }
}
