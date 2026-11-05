import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import { fetchCampaignAdsets, switchBudgetMode } from "@/lib/campaignEdit";

const VALID_ID = /^\d+$/;

// Campaign "View details": switch a campaign between a campaign budget (CBO) and ad set budgets (ABO).
// GET ?id=<campaignId>  -> the campaign's ad sets with their budgets (for the switch window)
// POST { campaignId, to: "adset" | "campaign", budgets?, budget?, budgetType? } -> see lib/campaignEdit.js.
// Facebook's own error text is returned verbatim.
export default async function handler(req, res) {
  const session = await getServerSession(req, res, authOptions);
  if (!session?.accessToken) return res.status(401).json({ error: "Not authenticated" });

  try {
    if (req.method === "GET") {
      const id = String(req.query.id || "");
      if (!VALID_ID.test(id)) return res.status(400).json({ error: "id must be a numeric Facebook campaign id" });
      return res.status(200).json({ adsets: await fetchCampaignAdsets(id, session.accessToken) });
    }
    if (req.method === "POST") {
      const { campaignId, ...body } = req.body || {};
      if (!VALID_ID.test(String(campaignId))) return res.status(400).json({ error: "campaignId must be a numeric Facebook campaign id" });
      return res.status(200).json({ success: true, ...(await switchBudgetMode(session.accessToken, String(campaignId), body)) });
    }
    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    return res.status(400).json({ error: err.message || "Request failed" });
  }
}
