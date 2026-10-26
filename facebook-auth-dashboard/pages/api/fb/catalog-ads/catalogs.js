import { requireCatalogAdsRequest } from "@/lib/catalogAds/apiGuard";
import { fetchCatalogs } from "@/lib/catalogAds/graphCatalog";

export default async function handler(req, res) {
  const session = await requireCatalogAdsRequest(req, res);
  if (!session) return;

  const { accountId } = req.query;
  if (!accountId) {
    return res.status(400).json({ error: "accountId is required" });
  }

  try {
    const catalogs = await fetchCatalogs(session.accessToken, accountId);
    res.status(200).json({ catalogs });
  } catch (err) {
    res.status(err.graphResponse ? 400 : 500).json({ error: err.message });
  }
}
