import { requireCatalogAdsRequest } from "@/lib/catalogAds/apiGuard";
import { fetchProducts } from "@/lib/catalogAds/graphCatalog";

export default async function handler(req, res) {
  const session = await requireCatalogAdsRequest(req, res);
  if (!session) return;

  const { catalogId, setId } = req.query;
  if (!catalogId && !setId) {
    return res.status(400).json({ error: "catalogId or setId is required" });
  }

  try {
    const products = await fetchProducts(session.accessToken, { catalogId, setId });
    res.status(200).json({ products });
  } catch (err) {
    res.status(err.graphResponse ? 400 : 500).json({ error: err.message });
  }
}
