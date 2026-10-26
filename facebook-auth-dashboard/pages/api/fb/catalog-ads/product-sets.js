import { requireCatalogAdsRequest } from "@/lib/catalogAds/apiGuard";
import { fetchProductSets } from "@/lib/catalogAds/graphCatalog";

export default async function handler(req, res) {
  const session = await requireCatalogAdsRequest(req, res);
  if (!session) return;

  const { catalogId } = req.query;
  if (!catalogId) {
    return res.status(400).json({ error: "catalogId is required" });
  }

  try {
    const productSets = await fetchProductSets(session.accessToken, catalogId);
    res.status(200).json({ productSets });
  } catch (err) {
    res.status(err.graphResponse ? 400 : 500).json({ error: err.message });
  }
}
