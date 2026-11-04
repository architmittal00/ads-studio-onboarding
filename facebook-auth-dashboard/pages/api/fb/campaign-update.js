import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import { updateCampaign } from "@/lib/campaignEdit";

const VALID_ID = /^\d+$/;

// Saves edits to one campaign from Explore's "View details" drawer (name, status, budget, bid strategy, spend
// cap, stop time). `edits` carries only what changed; see lib/campaignEdit.js. Facebook's own error text is
// returned verbatim.
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const session = await getServerSession(req, res, authOptions);
  if (!session?.accessToken) return res.status(401).json({ error: "Not authenticated" });

  const { campaignId, edits } = req.body || {};
  if (!VALID_ID.test(String(campaignId))) return res.status(400).json({ error: "campaignId must be a numeric Facebook campaign id" });
  if (!edits || typeof edits !== "object") return res.status(400).json({ error: "edits is required" });

  try {
    const result = await updateCampaign(session.accessToken, String(campaignId), edits);
    res.status(200).json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ error: err.message || "Request failed" });
  }
}
