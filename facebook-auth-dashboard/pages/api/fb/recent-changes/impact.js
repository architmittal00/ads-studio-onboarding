import { getServerSession } from "next-auth/next";
import { authOptions } from "../../auth/[...nextauth]";
import { graphGetInsights } from "@/lib/facebookGraph";
import { IMPACT_BATCH_SIZE, impactWindowFor, extractImpactMetrics } from "@/lib/recentChangesImpact";

// Computes the same before/after performance-impact lookup
// pages/api/fb/recent-changes.js used to compute inline, for every eligible
// change, in one request — split out here so pages/recent-changes.js can ask
// for it in small batches right after the list itself has already rendered,
// instead of the whole list staying blank until every change's impact is
// ready. See IMPACT_BATCH_SIZE's own comment for the batch-size reasoning.
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session?.accessToken) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  const { changes } = req.body || {};
  if (!Array.isArray(changes) || changes.length === 0) {
    return res.status(400).json({ error: "changes must be a non-empty array" });
  }
  if (changes.length > IMPACT_BATCH_SIZE) {
    return res.status(400).json({ error: `Cannot request impact for more than ${IMPACT_BATCH_SIZE} changes at once (got ${changes.length})` });
  }
  for (const c of changes) {
    if (!c || typeof c.id !== "string" || typeof c.objectId !== "string" || !c.eventTime || isNaN(Date.parse(c.eventTime))) {
      return res.status(400).json({ error: "Each change needs a string id, a string objectId, and a valid eventTime" });
    }
  }

  const token = session.accessToken;
  const impactPlan = [];
  const impactCalls = [];
  for (const c of changes) {
    const { before, after, tooRecent } = impactWindowFor(c.eventTime);
    if (tooRecent) continue;
    for (const [period, range] of [["before", before], ["after", after]]) {
      impactCalls.push(
        graphGetInsights(`/${c.objectId}/insights`, token, {
          time_range: range,
          fields: "spend,actions,action_values,purchase_roas",
        })
      );
      impactPlan.push({ id: c.id, period });
    }
  }

  const impactSettled = await Promise.allSettled(impactCalls);
  const beforeById = new Map();
  const afterById = new Map();
  impactSettled.forEach((result, i) => {
    const { id, period } = impactPlan[i];
    const target = period === "before" ? beforeById : afterById;
    if (result.status !== "fulfilled") {
      target.set(id, null); // soft-fail this one side — "—" in the UI, not a failed response
      return;
    }
    // An empty data array means no delivery in that window — a real zero,
    // not a missing value, so a zeroed stand-in row flows through the normal
    // extraction path rather than needing its own special case.
    const row = (result.value.data || [])[0] || { spend: "0", actions: [], action_values: [], purchase_roas: [] };
    target.set(id, extractImpactMetrics(row));
  });

  const impact = {};
  for (const c of changes) {
    // A change this request skipped as too-recent (window not computed, no
    // before/after calls queued) still gets an explicit `null` entry so the
    // caller can tell "measured, nothing to show yet" apart from "never
    // asked about".
    impact[c.id] = beforeById.has(c.id) || afterById.has(c.id) ? { before: beforeById.get(c.id) ?? null, after: afterById.get(c.id) ?? null } : null;
  }

  res.status(200).json({ impact });
}
