import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import { graphGetAllPages } from "@/lib/facebookGraph";
import { levelOfEntry, parseExtraData, eventTimeToIso } from "@/lib/activityObjects";

// GET /api/fb/entity-history?accountId=act_1&level=campaign|adset|ad&entityId=123 — the Activity Log for ONE entity over
// the last 72 hours: its own changes plus everything below it (a campaign: itself, its ad sets and its ads; an ad set:
// itself and its ads; an ad: itself). Meta filters the log by object id (`oid`), so only that item's entries are read.
const HOURS = 72;
const LEVELS = ["campaign", "adset", "ad"];
const VALID_ID = /^\d+$/;
const VALID_ACCOUNT = /^act_\d+$/;
const FIELDS = "actor_name,event_type,event_time,object_id,object_name,object_type,extra_data,translated_event_type";
const MAX_EVENTS = 500;
const FALLBACK_WAIT_MS = 45000;

const ALL_STATUSES = ["ACTIVE", "PAUSED", "ARCHIVED", "ADSET_PAUSED", "CAMPAIGN_PAUSED", "DISAPPROVED", "PENDING_REVIEW", "WITH_ISSUES", "IN_PROCESS"];
const STATUS_FILTER = [{ field: "effective_status", operator: "IN", value: ALL_STATUSES }];
const MAX_CHILD_IDS = 400; // beyond this a campaign's history is partial
const PER_ID_CONCURRENCY = 10;
const TIME_BUDGET_MS = 45000;

// The entity's own id first, then everything below it (a campaign: its ad sets and ads; an ad set: its ads).
async function descendantIds(level, entityId, token) {
  const ids = [entityId];
  const edges = level === "campaign" ? ["adsets", "ads"] : level === "adset" ? ["ads"] : [];
  const results = await Promise.allSettled(edges.map((edge) => graphGetAllPages(`/${entityId}/${edge}`, token, { fields: "id", filtering: STATUS_FILTER, limit: 500 })));
  for (const r of results) if (r.status === "fulfilled") for (const row of r.value.data || []) ids.push(String(row.id));
  return [...new Set(ids)];
}

// Meta's `add_children` flag does not bring in the items below (checked on a real account), so the log is asked
// for the children by id: one call listing them in `extra_oids`, or (fallback) one call per id, a few at a time.
const EXTRA_OIDS_PER_CALL = 200;

// One call per 200 children (all at once), the entity's own id as `oid` and the children in `extra_oids`.
async function readByExtraOids(accountId, token, since, until, ids) {
  const [self, ...children] = ids;
  const groups = [];
  for (let i = 0; i < children.length; i += EXTRA_OIDS_PER_CALL) groups.push(children.slice(i, i + EXTRA_OIDS_PER_CALL));
  if (groups.length === 0) groups.push([]);
  const parts = await Promise.all(
    groups.map((group, i) =>
      graphGetAllPages(`/${accountId}/activities`, token, { since, until, limit: 500, fields: FIELDS, oid: self, ...(group.length ? { extra_oids: group } : {}) }).then((r) => r.data || [])
    )
  );
  // `oid` repeats on every call, so the entity's own entries come back once per call; keep one of each.
  const seen = new Set();
  const entries = parts.flat().filter((e) => {
    const key = `${e.object_id}:${e.event_time}:${e.event_type}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { entries, partial: false };
}

async function readPerId(accountId, token, since, until, ids) {
  const deadline = Date.now() + TIME_BUDGET_MS;
  const capped = ids.slice(0, MAX_CHILD_IDS);
  const entries = [];
  let next = 0;
  let skipped = ids.length - capped.length;
  async function worker() {
    while (next < capped.length) {
      if (Date.now() > deadline) {
        skipped += capped.length - next;
        next = capped.length;
        return;
      }
      const id = capped[next++];
      try {
        const r = await graphGetAllPages(`/${accountId}/activities`, token, { since, until, limit: 500, fields: FIELDS, oid: id });
        entries.push(...(r.data || []));
      } catch {
        skipped++;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(PER_ID_CONCURRENCY, capped.length) }, worker));
  return { entries, partial: skipped > 0 };
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
    const ids = await descendantIds(level, entityId, token);
    // `extra_oids` is one fast call (checked on a real account: same result as one call per id, about 3x quicker on a
    // 150-child campaign). If Meta ever refuses it, fall back to one call per id. ?strategy=perid forces the fallback.
    let strategy = req.query.strategy === "perid" ? "perid" : "extra";
    let read;
    if (strategy === "extra") {
      try {
        read = await readByExtraOids(accountId, token, sinceUnix, untilUnix, ids);
      } catch {
        strategy = "perid";
      }
    }
    if (!read) read = await readPerId(accountId, token, sinceUnix, untilUnix, ids);
    const { entries, partial } = read;
    const via = strategy;

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

    res.status(200).json({ entityId, level, hours: HOURS, via, children: ids.length - 1, partial, truncated: events.length > MAX_EVENTS, events: events.slice(0, MAX_EVENTS) });
  } catch (err) {
    res.status(err.graphResponse ? 400 : 500).json({ error: err.message || "Request failed" });
  }
}
