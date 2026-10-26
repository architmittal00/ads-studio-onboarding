import { requireCatalogAdsRequest } from "@/lib/catalogAds/apiGuard";
import { fetchPosts } from "@/lib/catalogAds/graphCatalog";

export default async function handler(req, res) {
  const session = await requireCatalogAdsRequest(req, res);
  if (!session) return;

  const { pageId, source, igId } = req.query;
  if (!pageId) {
    return res.status(400).json({ error: "pageId is required" });
  }

  try {
    const posts = await fetchPosts(session.accessToken, { pageId, source, igId });
    res.status(200).json({ posts });
  } catch (err) {
    res.status(err.graphResponse ? 400 : 500).json({ error: err.message });
  }
}
