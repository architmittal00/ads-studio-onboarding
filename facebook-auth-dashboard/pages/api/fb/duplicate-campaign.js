import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import { graphPost } from "@/lib/facebookGraph";

const VALID_ID = /^\d+$/;

// Duplicates a whole campaign (its ad sets and ads) inside the same account using
// Meta's own copy endpoint, so targeting, budgets, creatives and everything this app
// has no special handling for are reproduced exactly. Created paused unless the caller
// asks for ACTIVE. An optional `name` renames the new campaign afterwards.
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session?.accessToken) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  const { sourceCampaignId, name, status } = req.body || {};
  if (!VALID_ID.test(String(sourceCampaignId))) {
    return res.status(400).json({ error: "sourceCampaignId is required" });
  }

  const token = session.accessToken;
  try {
    const copy = await graphPost(`/${sourceCampaignId}/copies`, token, {
      deep_copy: true,
      status_option: status === "ACTIVE" ? "ACTIVE" : "PAUSED",
    });
    const newId = copy.copied_campaign_id || copy.ad_object_ids?.[0]?.copied_id || copy.id;
    if (!newId) {
      return res.status(502).json({ error: "Meta did not return the new campaign id." });
    }
    const newName = typeof name === "string" ? name.trim() : "";
    let renameError = null;
    if (newName) {
      try {
        await graphPost(`/${newId}`, token, { name: newName });
      } catch (err) {
        renameError = err.message;
      }
    }
    res.status(200).json({ success: true, id: newId, renameError });
  } catch (err) {
    res.status(err.graphResponse ? 400 : 500).json({ error: err.message || "Request failed" });
  }
}
