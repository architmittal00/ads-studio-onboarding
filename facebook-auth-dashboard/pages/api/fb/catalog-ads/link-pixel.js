import { requireCatalogAdsRequest } from "@/lib/catalogAds/apiGuard";
import { linkPixelToCatalog } from "@/lib/catalogAds/graphCatalog";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const session = await requireCatalogAdsRequest(req, res);
  if (!session) return;

  const { catalogId, pixelId } = req.body || {};
  if (!catalogId || !pixelId) {
    return res.status(400).json({ error: "catalogId and pixelId are required" });
  }

  try {
    const result = await linkPixelToCatalog(session.accessToken, { catalogId, pixelId });
    res.status(200).json(result);
  } catch (err) {
    res.status(err.graphResponse ? 400 : 500).json({ error: err.message });
  }
}
