import { requireCatalogAdsRequest } from "@/lib/catalogAds/apiGuard";
import { fetchCatalogHealth } from "@/lib/catalogAds/graphCatalog";

export default async function handler(req, res) {
  const session = await requireCatalogAdsRequest(req, res);
  if (!session) return;

  const { catalogId, pixelId } = req.query;
  if (!catalogId) {
    return res.status(400).json({ error: "catalogId is required" });
  }

  try {
    const health = await fetchCatalogHealth(session.accessToken, { catalogId, pixelId });
    res.status(200).json(health);
  } catch (err) {
    res.status(err.graphResponse ? 400 : 500).json({ error: err.message });
  }
}
