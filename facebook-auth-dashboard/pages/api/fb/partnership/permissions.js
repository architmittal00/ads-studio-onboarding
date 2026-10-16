import { getServerSession } from "next-auth/next";
import { authOptions } from "../../auth/[...nextauth]";
import { listPermissions } from "@/lib/partnershipAds";

// Backs the My Requests tab — the full, live list of this IG account's
// branded-content permission records (one row per creator who was ever
// asked, see lib/partnershipAds.js's listPermissions for why this is
// creator-level, not content-level). Always the source of truth for status;
// pages/partnership-ads.js's own local request log only ever decorates this
// with context Graph doesn't return (which content prompted the request).
export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session?.accessToken) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  const { igUserId } = req.query;
  if (!igUserId) {
    return res.status(400).json({ error: "igUserId is required" });
  }

  try {
    const permissions = await listPermissions(session.accessToken, igUserId);
    res.status(200).json({ permissions });
  } catch (err) {
    res.status(err.graphResponse ? 400 : 500).json({ error: err.message });
  }
}
