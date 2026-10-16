import { getServerSession } from "next-auth/next";
import { authOptions } from "../../auth/[...nextauth]";
import { lookupContent } from "@/lib/partnershipAds";

// Single-item direct lookup — the Partnership Code tab's "Fetch Ad" (by
// ad_code) and the pre-launch re-verification step (a later addition, by
// permalink/content id) both go through here.
export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session?.accessToken) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  const { businessId, igUserId, adCode, permalink, contentId } = req.query;
  if (!businessId || !igUserId) {
    return res.status(400).json({ error: "businessId and igUserId are required" });
  }
  if (!adCode && !permalink && !contentId) {
    return res.status(400).json({ error: "One of adCode, permalink, or contentId is required" });
  }

  try {
    const items = await lookupContent(session.accessToken, businessId, {
      igUserId,
      adCodes: adCode ? [adCode] : undefined,
      permalinks: permalink ? [permalink] : undefined,
      contentIds: contentId ? [contentId] : undefined,
    });
    if (items.length === 0) {
      return res.status(404).json({ error: "No matching content found. Check the code and try again." });
    }
    res.status(200).json({ item: items[0] });
  } catch (err) {
    res.status(err.graphResponse ? 400 : 500).json({ error: err.message });
  }
}
