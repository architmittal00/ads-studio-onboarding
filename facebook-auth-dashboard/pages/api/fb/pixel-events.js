import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import { graphGet, graphGetAllPages } from "@/lib/facebookGraph";

// Events a pixel received in the last 7 days: per event the 7-day total, the last time it
// fired, and a count per day. Built from the pixel's hourly `stats` buckets
// (aggregation=event), so "last fired" is accurate to the hour. Days are in the
// ad account's time zone.
const VALID_ID = /^\d+$/;
const DAYS = 7;

function dayInZone(date, timeZone) {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const session = await getServerSession(req, res, authOptions);
  if (!session?.accessToken) return res.status(401).json({ error: "Not authenticated" });
  const { pixelId, accountId } = req.query;
  if (!VALID_ID.test(String(pixelId || ""))) return res.status(400).json({ error: "pixelId is required" });
  const token = session.accessToken;

  try {
    const end = new Date();
    const start = new Date(end.getTime() - DAYS * 24 * 3600 * 1000);
    const [account, pixel, stats] = await Promise.all([
      /^act_\d+$/.test(String(accountId || "")) ? graphGet(`/${accountId}`, token, { fields: "timezone_name" }).catch(() => null) : null,
      graphGet(`/${pixelId}`, token, { fields: "name,last_fired_time" }),
      graphGetAllPages(`/${pixelId}/stats`, token, {
        aggregation: "event",
        start_time: Math.floor(start.getTime() / 1000),
        end_time: Math.floor(end.getTime() / 1000),
        limit: 500,
      }),
    ]);
    const timeZone = account?.timezone_name || "UTC";

    // The last DAYS calendar days ending today, oldest first.
    const days = [];
    for (let i = DAYS - 1; i >= 0; i--) days.push(dayInZone(new Date(end.getTime() - i * 24 * 3600 * 1000), timeZone));

    const byEvent = new Map();
    for (const bucket of stats.data || []) {
      const at = new Date(bucket.start_time);
      const day = dayInZone(at, timeZone);
      const dayIdx = days.indexOf(day);
      for (const item of bucket.data || []) {
        const count = Number(item.count) || 0;
        if (!item.value || count <= 0) continue;
        let e = byEvent.get(item.value);
        if (!e) {
          e = { name: item.value, total: 0, lastFired: null, daily: days.map(() => 0) };
          byEvent.set(item.value, e);
        }
        e.total += count;
        if (dayIdx >= 0) e.daily[dayIdx] += count;
        // A bucket covers the hour starting at start_time; report its start as "last fired".
        if (!e.lastFired || at > new Date(e.lastFired)) e.lastFired = at.toISOString();
      }
    }
    const events = [...byEvent.values()].sort((a, b) => b.total - a.total);
    res.status(200).json({
      pixel: { id: pixelId, name: pixel.name, lastFiredTime: pixel.last_fired_time || null,
        firing: !!pixel.last_fired_time && end.getTime() - new Date(pixel.last_fired_time).getTime() < 24 * 3600 * 1000 },
      days,
      timeZone,
      events,
    });
  } catch (err) {
    res.status(err.graphResponse ? 400 : 500).json({ error: err.message || "Request failed" });
  }
}
