import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import { fetchAdDetails, fetchPostLandingUrls } from "@/lib/adCreativeDetails";

const MAX_AD_IDS = 100;

// POST /api/fb/ad-creative-info { adIds } — name, landing page, creative kind (Partnership / Catalog / Carousel /
// Video / Image) and thumbnail for a handful of ads, in one round trip. Backs the Recommendations push list, which
// needs these for the target ad set's own ads to learn what that ad set spends on.
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const session = await getServerSession(req, res, authOptions);
  if (!session?.accessToken) return res.status(401).json({ error: "Not authenticated" });
  const { adIds } = req.body || {};
  if (!Array.isArray(adIds) || adIds.length === 0) return res.status(400).json({ error: "adIds is required" });
  const ids = [...new Set(adIds.map(String).filter((id) => /^\d+$/.test(id)))].slice(0, MAX_AD_IDS);

  try {
    const details = await fetchAdDetails(ids, session.accessToken);
    const postIds = [...new Set(Object.values(details).map((d) => d.postId).filter(Boolean))];
    let postUrls = {};
    try {
      postUrls = await fetchPostLandingUrls(postIds, session.accessToken);
    } catch {}
    const info = {};
    for (const id of ids) {
      const d = details[id];
      if (!d) continue;
      info[id] = {
        name: d.name,
        landing: d.landingUrl || (d.postId ? postUrls[d.postId] : null) || null,
        kind: d.kind,
        thumbnailUrl: d.thumbnailUrl,
        isVideo: !!d.videoId,
      };
    }
    res.status(200).json({ info });
  } catch (err) {
    res.status(err.graphResponse ? 400 : 500).json({ error: err.message });
  }
}
