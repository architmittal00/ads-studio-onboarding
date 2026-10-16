import { getServerSession } from "next-auth/next";
import { authOptions } from "../../auth/[...nextauth]";
import { requestPermission } from "@/lib/partnershipAds";

// Single "Request Permission" action — from the Explore grid's expanded-card
// modal or a single card's own permission badge. The caller is responsible
// for logging this locally afterward (lib/clientStorage.js's
// addPermissionRequestLogEntry) so "My Requests" can show which content
// prompted it; this endpoint only talks to Graph.
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session?.accessToken) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  const { igUserId, creatorIgId, creatorUsername } = req.body || {};
  if (!igUserId || (!creatorIgId && !creatorUsername)) {
    return res.status(400).json({ error: "igUserId and (creatorIgId or creatorUsername) are required" });
  }

  try {
    const result = await requestPermission(session.accessToken, igUserId, {
      creatorInstagramAccount: creatorIgId,
      creatorInstagramUsername: creatorIgId ? undefined : creatorUsername,
    });
    res.status(200).json({ success: !!result.success || true });
  } catch (err) {
    res.status(err.graphResponse ? 400 : 500).json({ error: err.message });
  }
}
