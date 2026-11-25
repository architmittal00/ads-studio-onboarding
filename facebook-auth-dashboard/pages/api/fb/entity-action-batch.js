import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import { graphPost } from "@/lib/facebookGraph";
import { entityActionRow, recordRecActions } from "@/lib/recLogDb";

const VALID_ENTITY_ID = /^\d+$/;
// Meta's Batch API takes at most 50 operations per request.
const MAX_BATCH = 50;

// Pause many ads with one Graph call instead of one call per ad (the single-entity route is
// /api/fb/entity-action). The client sends up to 50 ids at a time; each id gets its own result, so
// a few failures (an ad already deleted, no permission) don't stop the rest.
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  if (!session?.accessToken) return res.status(401).json({ error: "Not authenticated" });

  // `rec` (optional): present only for pauses that come from a recommendation; `names` maps id -> ad name for the log.
  const { entityIds, action, rec, names } = req.body || {};
  if (action !== "pause") return res.status(400).json({ error: "action must be pause" });
  if (!Array.isArray(entityIds) || entityIds.length === 0 || entityIds.length > MAX_BATCH) {
    return res.status(400).json({ error: `entityIds must be a list of 1–${MAX_BATCH} ids` });
  }
  if (!entityIds.every((id) => typeof id === "string" && VALID_ENTITY_ID.test(id))) {
    return res.status(400).json({ error: "entityIds must be numeric Facebook object ids" });
  }

  try {
    const batch = entityIds.map((id) => ({ method: "POST", relative_url: `${id}?status=PAUSED` }));
    const responses = await graphPost("", session.accessToken, { batch });
    const results = entityIds.map((id, i) => {
      const item = Array.isArray(responses) ? responses[i] : null;
      // A null entry means Meta didn't run that operation (batch timed out): nothing was applied for it.
      if (!item) return { id, ok: false, error: "Meta didn't process this one in time — try it again." };
      let body = null;
      try {
        body = JSON.parse(item.body);
      } catch {
        // leave null
      }
      if (item.code === 200 && body && !body.error) return { id, ok: true };
      return { id, ok: false, error: body?.error?.error_user_msg || body?.error?.message || `Request failed (${item.code})` };
    });
    if (rec) {
      await recordRecActions(
        session,
        results.map((r) => {
          // `names[id]` is the ad's name, or { name, ruleId, ruleName, custom } when ads in one batch come from different rules.
          const n = names?.[r.id];
          const own = n && typeof n === "object" ? { entityName: n.name, ruleId: n.ruleId, ruleName: n.ruleName, custom: n.custom } : { entityName: n };
          return entityActionRow({ entityId: r.id, action: "pause", rec: { ...rec, entityType: "ad", ...Object.fromEntries(Object.entries(own).filter(([, v]) => v != null)) }, error: r.ok ? null : r.error });
        })
      );
    }
    res.status(200).json({ results });
  } catch (err) {
    res.status(err.graphResponse ? 400 : 500).json({ error: err.message || "Request failed" });
  }
}
