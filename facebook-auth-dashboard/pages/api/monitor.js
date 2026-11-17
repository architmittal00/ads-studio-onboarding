import { getServerSession } from "next-auth/next";
import { authOptions } from "./auth/[...nextauth]";
import { monitorConfigured, readMonitorItems, addMonitorItem, removeMonitorItem, importMonitorItems } from "@/lib/monitorDb";

// GET  /api/monitor                          -> { items }
// POST /api/monitor { action: "add", item }  -> { ok, added }
// POST /api/monitor { action: "remove", key }-> { ok }
// POST /api/monitor { action: "import", items } -> { ok, imported }   (one-time carry-over from the browser)
// The owner is always the Google email of the signed-in session: nothing the browser sends can pick another owner.
const MAX_MONITORED = 500;
const LEVELS = ["campaign", "adset", "ad"];
const MIN_TIME = Date.parse("2020-01-01");

const text = (v, max) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

function cleanItem(raw, { keepTime }) {
  if (!raw || typeof raw !== "object" || !LEVELS.includes(raw.level)) return null;
  const entityId = text(raw.entityId, 64);
  const accountId = text(raw.accountId, 64);
  if (!entityId || !accountId) return null;
  const at = keepTime && Number.isFinite(raw.addedAt) ? Math.min(Math.max(raw.addedAt, MIN_TIME), Date.now()) : Date.now();
  return {
    key: `${raw.level}:${entityId}`,
    level: raw.level,
    entityId,
    accountId,
    name: text(raw.name, 300),
    campaignName: text(raw.campaignName, 300),
    adsetName: text(raw.adsetName, 300),
    source: text(raw.source, 40),
    addedAtIso: new Date(at).toISOString(),
  };
}

export default async function handler(req, res) {
  const session = await getServerSession(req, res, authOptions);
  const email = session?.googleEmail ? String(session.googleEmail).toLowerCase() : null;
  if (!email) return res.status(401).json({ error: "Sign in with Google to use Monitor" });
  res.setHeader("Cache-Control", "no-store");
  if (!monitorConfigured()) return res.status(503).json({ error: "Database is not configured" });

  try {
    if (req.method === "GET") return res.status(200).json({ items: await readMonitorItems(email) });

    if (req.method === "POST") {
      const origin = req.headers.origin;
      if (origin && new URL(origin).host !== req.headers.host) return res.status(403).json({ error: "Cross-site request" });
      const { action } = req.body || {};

      if (action === "add") {
        const item = cleanItem(req.body.item, { keepTime: false });
        if (!item) return res.status(400).json({ error: "Not a valid item" });
        if ((await readMonitorItems(email)).length >= MAX_MONITORED) return res.status(400).json({ error: "Monitor list is full" });
        return res.status(200).json({ ok: true, added: await addMonitorItem(email, item) });
      }

      if (action === "remove") {
        const key = text(req.body.key, 140);
        if (!key) return res.status(400).json({ error: "Missing key" });
        await removeMonitorItem(email, key);
        return res.status(200).json({ ok: true });
      }

      if (action === "import") {
        const list = Array.isArray(req.body.items) ? req.body.items.slice(0, MAX_MONITORED) : null;
        if (!list) return res.status(400).json({ error: "Not a list" });
        const items = [...new Map(list.map((i) => cleanItem(i, { keepTime: true })).filter(Boolean).map((i) => [i.key, i])).values()];
        return res.status(200).json({ ok: true, imported: await importMonitorItems(email, items) });
      }

      return res.status(400).json({ error: "Unknown action" });
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("monitor failed:", err?.message);
    return res.status(500).json({ error: "Could not reach the Monitor database" });
  }
}
