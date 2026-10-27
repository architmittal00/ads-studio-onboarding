import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import { updateAd } from "@/lib/adEdit";

const VALID_ID = /^\d+$/;

// Edits one ad from Explore's "View details" drawer: name, status, swapping in
// another existing creative, or new copy (primary texts / headlines /
// descriptions / CTA / website URL). See lib/adEdit.js for how copy edits work
// (a new creative is created and attached — Meta can't edit one in place) and
// which ads can't be edited. Facebook's own error text is returned verbatim.
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const session = await getServerSession(req, res, authOptions);
  if (!session?.accessToken) return res.status(401).json({ error: "Not authenticated" });

  const { adId, name, status, copy, creativeId } = req.body || {};
  if (!VALID_ID.test(String(adId))) return res.status(400).json({ error: "adId must be a numeric Facebook ad id" });

  try {
    const result = await updateAd(session.accessToken, String(adId), { name, status, copy, creativeId });
    res.status(200).json({ success: true, ...result });
  } catch (err) {
    res.status(err.graphResponse ? 400 : 400).json({ error: err.message || "Request failed" });
  }
}
