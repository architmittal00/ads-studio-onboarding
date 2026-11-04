import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import { updateAdSet } from "@/lib/adsetEdit";

const VALID_ID = /^\d+$/;

// Saves edits to one ad set from Explore's "View details" drawer (name, status, budget, bidding, schedule,
// attribution, targeting, placements). `edits` carries only what changed; see lib/adsetEdit.js for how
// targeting is merged into the existing object. Facebook's own error text is returned verbatim.
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const session = await getServerSession(req, res, authOptions);
  if (!session?.accessToken) return res.status(401).json({ error: "Not authenticated" });

  const { adsetId, edits } = req.body || {};
  if (!VALID_ID.test(String(adsetId))) return res.status(400).json({ error: "adsetId must be a numeric Facebook ad set id" });
  if (!edits || typeof edits !== "object") return res.status(400).json({ error: "edits is required" });

  try {
    const result = await updateAdSet(session.accessToken, String(adsetId), edits);
    res.status(200).json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ error: err.message || "Request failed" });
  }
}
