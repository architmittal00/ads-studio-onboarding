import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import { graphGet, graphGetAllPages } from "@/lib/facebookGraph";
import { addDaysUTC, isoDate, todayInTimeZone } from "@/lib/dateRanges";

// Events a pixel received in a date range: per event the total, the last time it fired, and a
// series for charting — hourly for a range of up to 2 days, otherwise one point per day.
// Built from the pixel's hourly `stats` buckets (aggregation=event). Dates are calendar days in
// the ad account's time zone. The range comes from `range` (today | yesterday | 7 | 14 | 30)
// or from explicit `since`/`until` (YYYY-MM-DD).
const VALID_ID = /^\d+$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 31;
const HOUR = 3600 * 1000;

function dayInZone(date, timeZone) {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

function offsetAt(ms, timeZone) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" })
      .formatToParts(new Date(ms))
      .map((x) => [x.type, x.value])
  );
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - ms;
}

// The instant a calendar day begins in the given zone.
function zonedStart(dateStr, timeZone) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const utc = Date.UTC(y, m - 1, d);
  let t = utc - offsetAt(utc, timeZone);
  t = utc - offsetAt(t, timeZone);
  return t;
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const session = await getServerSession(req, res, authOptions);
  if (!session?.accessToken) return res.status(401).json({ error: "Not authenticated" });
  const { pixelId, accountId, range, since: qSince, until: qUntil } = req.query;
  if (!VALID_ID.test(String(pixelId || ""))) return res.status(400).json({ error: "pixelId is required" });
  const token = session.accessToken;

  try {
    const [account, pixel] = await Promise.all([
      /^act_\d+$/.test(String(accountId || "")) ? graphGet(`/${accountId}`, token, { fields: "timezone_name" }).catch(() => null) : null,
      graphGet(`/${pixelId}`, token, { fields: "name,last_fired_time" }),
    ]);
    let timeZone = account?.timezone_name || "UTC";
    try {
      new Intl.DateTimeFormat("en-US", { timeZone });
    } catch {
      timeZone = "UTC";
    }

    const now = Date.now();
    const today = isoDate(todayInTimeZone(timeZone));
    let since;
    let until;
    if (DATE.test(String(qSince)) && DATE.test(String(qUntil))) {
      since = qSince;
      until = qUntil;
    } else if (range === "yesterday") {
      since = until = addDaysUTC(today, -1);
    } else if (range === "today") {
      since = until = today;
    } else {
      const n = [7, 14, 30].includes(Number(range)) ? Number(range) : 7;
      since = addDaysUTC(today, -(n - 1));
      until = today;
    }
    if (until > today) until = today;
    if (since > until) return res.status(400).json({ error: "The start date must be on or before the end date." });
    const spanDays = Math.round((Date.parse(until) - Date.parse(since)) / 86400000) + 1;
    if (spanDays > MAX_DAYS) return res.status(400).json({ error: `Pick a range of at most ${MAX_DAYS} days.` });

    const startMs = zonedStart(since, timeZone);
    const endMs = Math.min(now, zonedStart(addDaysUTC(until, 1), timeZone));
    const stats = await graphGetAllPages(`/${pixelId}/stats`, token, {
      aggregation: "event",
      start_time: Math.floor(startMs / 1000),
      end_time: Math.floor(endMs / 1000),
      limit: 500,
    });

    const hourly = spanDays <= 2;
    // Chart x positions: every UTC hour of the range, or every calendar day.
    const labels = [];
    if (hourly) {
      for (let t = Math.floor(startMs / HOUR) * HOUR; t < endMs; t += HOUR) labels.push(new Date(t).toISOString());
    } else {
      for (let d = since; d <= until; d = addDaysUTC(d, 1)) labels.push(d);
    }
    const index = new Map(labels.map((l, i) => [l, i]));

    const byEvent = new Map();
    for (const bucket of stats.data || []) {
      const at = new Date(bucket.start_time);
      const idx = index.get(hourly ? at.toISOString() : dayInZone(at, timeZone));
      for (const item of bucket.data || []) {
        const count = Number(item.count) || 0;
        if (!item.value || count <= 0) continue;
        let e = byEvent.get(item.value);
        if (!e) {
          e = { name: item.value, total: 0, lastFired: null, points: labels.map(() => 0) };
          byEvent.set(item.value, e);
        }
        e.total += count;
        if (idx !== undefined) e.points[idx] += count;
        // A bucket covers the hour starting at start_time; report its start as "last fired".
        if (!e.lastFired || at > new Date(e.lastFired)) e.lastFired = at.toISOString();
      }
    }
    const events = [...byEvent.values()].sort((a, b) => b.total - a.total);
    res.status(200).json({
      pixel: {
        id: pixelId,
        name: pixel.name,
        lastFiredTime: pixel.last_fired_time || null,
        firing: !!pixel.last_fired_time && now - new Date(pixel.last_fired_time).getTime() < 24 * HOUR,
      },
      range: { since, until },
      granularity: hourly ? "hour" : "day",
      labels,
      timeZone,
      events,
    });
  } catch (err) {
    res.status(err.graphResponse ? 400 : 500).json({ error: err.message || "Request failed" });
  }
}
