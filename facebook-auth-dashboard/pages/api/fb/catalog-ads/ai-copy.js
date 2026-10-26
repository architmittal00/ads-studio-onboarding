import { requireCatalogAdsRequest } from "@/lib/catalogAds/apiGuard";
import { generateCopy } from "@/lib/catalogAds/aiCopy";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const session = await requireCatalogAdsRequest(req, res);
  if (!session) return;

  try {
    const result = await generateCopy(req.body || {}, session.accessToken);
    res.status(200).json(result);
  } catch (err) {
    res.status(err.status || (err.graphResponse ? 400 : 500)).json({ error: err.message });
  }
}
