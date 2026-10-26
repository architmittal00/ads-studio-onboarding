import { requireCatalogAdsRequest } from "@/lib/catalogAds/apiGuard";
import { fetchCatalogPerformance } from "@/lib/catalogAds/graphCatalog";

export default async function handler(req, res) {
  const session = await requireCatalogAdsRequest(req, res);
  if (!session) return;

  const { accountId, since, until } = req.query;
  if (!accountId || !since || !until) {
    return res.status(400).json({ error: "accountId, since, and until are required" });
  }

  try {
    const ads = await fetchCatalogPerformance(session.accessToken, { accountId, since, until });
    res.status(200).json({ ads });
  } catch (err) {
    res.status(err.graphResponse ? 400 : 500).json({ error: err.message });
  }
}
