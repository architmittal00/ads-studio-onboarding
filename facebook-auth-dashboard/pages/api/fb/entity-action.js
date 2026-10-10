import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import { graphPost } from "@/lib/facebookGraph";
import { toMinorUnits } from "@/lib/campaignLaunch";

// Facebook object ids are plain numeric strings — this is the one thing
// standing between a user-supplied `entityId` and it landing directly in a
// Graph API URL path (see graphPost's `/${entityId}` call below), so it's
// validated strictly rather than just checked for truthiness.
const VALID_ENTITY_ID = /^\d+$/;
const VALID_ACTIONS = ["pause", "activate", "set_daily_budget", "set_lifetime_budget"];

// One row-level write action from Explore's results table (pages/explore.js's
// RowActions component) — pause/activate an entity, or set a new daily/
// lifetime budget on it. Deliberately one entity per call (not a batch) even
// though the client's multi-select already exists for copy-ID: a mutating
// action is higher-stakes than a clipboard copy, and the client asks for
// confirmation (with the exact Facebook-bound value shown) before ever
// calling this per entity, one at a time — see components/RowActions.js.
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session?.accessToken) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  const { entityId, action, value } = req.body || {};

  if (typeof entityId !== "string" || !VALID_ENTITY_ID.test(entityId)) {
    return res.status(400).json({ error: "entityId must be a numeric Facebook object id" });
  }
  if (!VALID_ACTIONS.includes(action)) {
    return res.status(400).json({ error: `action must be one of: ${VALID_ACTIONS.join(", ")}` });
  }

  const isBudgetAction = action === "set_daily_budget" || action === "set_lifetime_budget";
  if (isBudgetAction) {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
      return res.status(400).json({ error: "value must be a positive number for a budget action" });
    }
  }

  const token = session.accessToken;
  const params =
    action === "pause"
      ? { status: "PAUSED" }
      : action === "activate"
      ? { status: "ACTIVE" }
      : action === "set_daily_budget"
      ? { daily_budget: toMinorUnits(value) }
      : { lifetime_budget: toMinorUnits(value) };

  try {
    await graphPost(`/${entityId}`, token, params);
    res.status(200).json({ success: true });
  } catch (err) {
    // Same shape as every other write-failure response in this app (see
    // pages/api/fb/launch-strategy.js) — Facebook's own error message is
    // shown to the user verbatim, not replaced with a generic failure text.
    res.status(err.graphResponse ? 400 : 500).json({ error: err.message || "Request failed" });
  }
}
