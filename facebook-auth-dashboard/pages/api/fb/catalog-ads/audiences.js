import { requireCatalogAdsRequest } from "@/lib/catalogAds/apiGuard";
import { fetchSavedAudiences, fetchCustomAudiences } from "@/lib/catalogAds/graphCatalog";

// One route for both audience kinds (?type=saved|custom), same grouping
// convention as this app's other *-list.js routes that switch on a query
// param rather than one file per mode.
export default async function handler(req, res) {
  const session = await requireCatalogAdsRequest(req, res);
  if (!session) return;

  const { accountId, type } = req.query;
  if (!accountId) {
    return res.status(400).json({ error: "accountId is required" });
  }
  if (type !== "saved" && type !== "custom") {
    return res.status(400).json({ error: "type must be 'saved' or 'custom'" });
  }

  try {
    const audiences =
      type === "saved" ? await fetchSavedAudiences(session.accessToken, accountId) : await fetchCustomAudiences(session.accessToken, accountId);
    res.status(200).json({ audiences });
  } catch (err) {
    res.status(err.graphResponse ? 400 : 500).json({ error: err.message });
  }
}
