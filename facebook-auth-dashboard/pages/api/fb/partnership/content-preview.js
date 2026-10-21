import { getServerSession } from "next-auth/next";
import { authOptions } from "../../auth/[...nextauth]";
import { fetchContentPreview } from "@/lib/partnershipAds";

// Backs the Explore Ads grid, its Details modal, Partnership Code's preview
// modal, the launch queue list, and the launch wizard's review step — every
// place this app needs to actually show a piece of discovered content
// instead of a placeholder. See lib/partnershipAds.js's fetchContentPreview
// for the two resolution mechanisms (direct media lookup, falling back to
// Instagram's oEmbed) and why neither is guaranteed up front.
export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session?.accessToken) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  const { contentId, permalink } = req.query;
  if (!contentId && !permalink) {
    return res.status(400).json({ error: "contentId or permalink is required" });
  }

  try {
    const preview = await fetchContentPreview(session.accessToken, { contentId, permalink });
    res.status(200).json(preview || {});
  } catch (err) {
    res.status(err.graphResponse ? 400 : 500).json({ error: err.message });
  }
}
