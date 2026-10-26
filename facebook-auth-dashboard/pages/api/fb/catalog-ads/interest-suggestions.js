import { requireCatalogAdsRequest } from "@/lib/catalogAds/apiGuard";
import { fetchInterestSuggestions } from "@/lib/catalogAds/graphCatalog";

export default async function handler(req, res) {
  const session = await requireCatalogAdsRequest(req, res);
  if (!session) return;

  let names = [];
  try {
    names = JSON.parse(req.query.names || "[]");
  } catch {
    return res.status(400).json({ error: "names must be a JSON array" });
  }

  try {
    const interests = await fetchInterestSuggestions(session.accessToken, names);
    res.status(200).json({ interests });
  } catch (err) {
    res.status(err.graphResponse ? 400 : 500).json({ error: err.message });
  }
}
