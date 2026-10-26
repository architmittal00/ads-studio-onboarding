import { requireCatalogAdsRequest } from "@/lib/catalogAds/apiGuard";
import { fetchSetHealth } from "@/lib/catalogAds/graphCatalog";

export default async function handler(req, res) {
  const session = await requireCatalogAdsRequest(req, res);
  if (!session) return;

  const { setId } = req.query;
  if (!setId) {
    return res.status(400).json({ error: "setId is required" });
  }

  try {
    const health = await fetchSetHealth(session.accessToken, setId);
    res.status(200).json(health);
  } catch (err) {
    res.status(err.graphResponse ? 400 : 500).json({ error: err.message });
  }
}
