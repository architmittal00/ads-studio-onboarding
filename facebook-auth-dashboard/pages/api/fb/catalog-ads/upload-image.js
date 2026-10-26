import { requireCatalogAdsRequest } from "@/lib/catalogAds/apiGuard";
import { graphPost } from "@/lib/facebookGraph";

// Next's default API body-parser cap (1 MB) is well under a base64-encoded
// 3 MB image (~4 MB) — raised here to cover it, same ceiling the 3 MB/
// 4,200,000-char check below already assumes.
export const config = { api: { bodyParser: { sizeLimit: "5mb" } } };

// Image for a new standard ad: stored in the ad account's image library,
// referenced by hash.
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const session = await requireCatalogAdsRequest(req, res);
  if (!session) return;

  const { accountId, name, bytes } = req.body || {};
  if (!accountId || !bytes) {
    return res.status(400).json({ error: "accountId and bytes are required" });
  }
  if (bytes.length > 4_200_000) {
    return res.status(400).json({ error: "Image is too large. Use an image under 3 MB." });
  }

  try {
    const json = await graphPost(`/${accountId}/adimages`, session.accessToken, { bytes, name: name || "image" });
    const first = Object.values(json.images || {})[0];
    if (!first) throw new Error("Facebook did not return an image hash.");
    res.status(200).json({ hash: first.hash, url: first.url });
  } catch (err) {
    res.status(err.graphResponse ? 400 : 500).json({ error: err.message });
  }
}
