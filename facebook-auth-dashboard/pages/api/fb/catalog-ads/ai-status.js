import { requireCatalogAdsRequest } from "@/lib/catalogAds/apiGuard";
import { aiStatus } from "@/lib/catalogAds/aiCopy";

// Whether AI copy is set up on this server (OPENROUTER_API_KEY) — the
// "Write the text with AI" box stays hidden when it isn't.
export default async function handler(req, res) {
  const session = await requireCatalogAdsRequest(req, res);
  if (!session) return;

  res.status(200).json(aiStatus());
}
