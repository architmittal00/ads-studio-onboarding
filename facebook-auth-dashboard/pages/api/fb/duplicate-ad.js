import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import { graphGet, graphPost } from "@/lib/facebookGraph";

// Same id-format guard as entity-action.js — both ids below land directly in
// a Graph API URL path or POST body.
const VALID_ID = /^\d+$/;

// Creates one new ad that's an exact replica of an existing one — the new ad
// points at the SAME creative, by id, rather than re-creating it (same
// reasoning as pages/api/fb/adsets-list.js's ?adsetId= comment, applied to a
// single ad instead of a whole ad set's worth of them): a creative is a
// standalone, reusable Graph object, and re-deriving its full spec to clone
// it would be a much larger, riskier surface than this needs — including for
// anything this app has no special handling for today (a partnership/
// branded-content ad, a dynamic creative, asset_feed_spec, …), which this
// approach reproduces correctly for free since nothing about the creative
// itself is touched. The source ad's creative id is re-fetched here rather
// than trusted from the client, so this endpoint's own Graph call is the
// only thing that decides what actually gets duplicated.
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session?.accessToken) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  const { accountId, sourceAdId, destinationAdsetId, name, status } = req.body || {};
  // Paused unless the caller explicitly asks for ACTIVE (the UI's "Launch as" choice).
  const adStatus = status === "ACTIVE" ? "ACTIVE" : "PAUSED";

  if (!accountId || !VALID_ID.test(String(sourceAdId)) || !VALID_ID.test(String(destinationAdsetId))) {
    return res.status(400).json({ error: "accountId, sourceAdId, and destinationAdsetId are required" });
  }

  const token = session.accessToken;

  try {
    const source = await graphGet(`/${sourceAdId}`, token, { fields: "name,creative{id}" });
    if (!source.creative?.id) {
      return res.status(400).json({ error: "This ad has no creative to duplicate." });
    }
    // Paused by default, same safety pattern as every other object this app
    // creates (pages/api/fb/launch-campaign.js, pages/api/fb/launch-strategy.js)
    // — a duplicate is reviewed in Ads Manager before it can spend anything —
    // unless the user chose to launch it active.
    const json = await graphPost(`/${accountId}/ads`, token, {
      name: (name && name.trim()) || `${source.name} - Copy`,
      adset_id: destinationAdsetId,
      creative: { creative_id: source.creative.id },
      status: adStatus,
    });
    res.status(200).json({ success: true, id: json.id, status: adStatus });
  } catch (err) {
    res.status(err.graphResponse ? 400 : 500).json({ error: err.message || "Request failed" });
  }
}
