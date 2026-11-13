import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import { graphGetAllPages } from "@/lib/facebookGraph";
import { fetchActivities } from "@/lib/activityLog";
import { levelOfEntry, parseExtraData, eventTimeToIso } from "@/lib/activityObjects";

// GET /api/fb/entity-history?accountId=act_1&level=campaign|adset|ad&entityId=123 — the Activity Log for ONE entity over
// the last 72 hours: its own changes plus everything below it (a campaign: itself, its ad sets and its ads; an ad set:
// itself and its ads; an ad: itself). Meta filters the log to that object (oid + add_children); if it refuses that, the
// account's 72-hour log is read and filtered here instead (slower, so it is capped).
const HOURS = 72;
const LEVELS = ["campaign", "adset", "ad"];
const VALID_ID = /^\d+$/;
const VALID_ACCOUNT = /^act_\d+$/;
const FIELDS = "actor_name,event_type,event_time,object_id,object_name,object_type,extra_data,translated_event_type";
const MAX_EVENTS = 500;
const FALLBACK_WAIT_MS = 45000;

async function descendantIds(level, entityId, token) {
  const ids = new Set([entityId]);
  const lists = level === "campaign" ? ["adsets", "ads"] : level === "adset" ? ["ads"] : [];
  const results = await Promise.allSettled(lists.map((edge) => graphGetAllPages(`/${entityId}/${edge}`, token, { fields: "id", limit: 500 })));
  for (const r of results) if (r.status === "fulfilled") for (const row of r.value.data || []) ids.add(row.id);
  return ids;
}

async function withCap(promise, ms) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => (timer = setTimeout(() => reject(new Error("The activity log took too long to read for this account.")), ms)))]);
  } finally {
    clearTimeout(timer);
  }
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const session = await getServerSession(req, res, authOptions);
  if (!session?.accessToken) return res.status(401).json({ error: "Not authenticated" });

  const { accountId, level, entityId } = req.query;
  if (!VALID_ACCOUNT.test(String(accountId || ""))) return res.status(400).json({ error: "accountId must be an ad account id like act_123" });
  if (!LEVELS.includes(level)) return res.status(400).json({ error: `level must be one of: ${LEVELS.join(", ")}` });
  if (!VALID_ID.test(String(entityId || ""))) return res.status(400).json({ error: "entityId is required" });

  const token = session.accessToken;
  const untilUnix = Math.floor(Date.now() / 1000);
  const sinceUnix = untilUnix - HOURS * 3600;

  try {
    let entries;
    let via = "filtered";
    try {
      const r = await graphGetAllPages(`/${accountId}/activities`, token, { since: sinceUnix, until: untilUnix, limit: 500, fields: FIELDS, oid: entityId, add_children: "true" });
      entries = r.data || [];
    } catch {
      via = "account-log";
      const [ids, log] = await withCap(Promise.all([descendantIds(level, entityId, token), fetchActivities(accountId, token, { sinceUnix, untilUnix, fields: FIELDS })]), FALLBACK_WAIT_MS);
      entries = (log.data || []).filter((e) => ids.has(String(e.object_id)));
    }

    const events = entries
      .map((e) => ({
        id: `${e.object_id}:${e.event_time}:${e.event_type}`,
        time: eventTimeToIso(e.event_time),
        actor: e.actor_name || "Unknown",
        level: levelOfEntry(e.object_type, e.event_type, e.translated_event_type),
        objectId: String(e.object_id),
        objectName: e.object_name || null,
        label: e.translated_event_type || e.event_type || "Change",
        eventType: e.event_type || null,
        extraData: parseExtraData(e.extra_data),
      }))
      .filter((e) => e.time)
      .sort((a, b) => new Date(b.time) - new Date(a.time));

    res.status(200).json({ entityId, level, hours: HOURS, via, truncated: events.length > MAX_EVENTS, events: events.slice(0, MAX_EVENTS) });
  } catch (err) {
    res.status(err.graphResponse ? 400 : 500).json({ error: err.message || "Request failed" });
  }
}
