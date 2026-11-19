import { getServerSession } from "next-auth/next";
import { authOptions } from "../../auth/[...nextauth]";
import { graphGetInsights } from "@/lib/facebookGraph";
import { resolveGraphFields, deriveRowMetrics } from "@/lib/insightsMetrics";

// "ad" is reachable only via components/EntityDrillDown.js's own per-row
// comparison table (RCA on the ads inside a changed ad set/campaign) — the
// top-level change itself is always logged against a campaign or ad set, per
// VALID_LEVELS' original two entries.
const VALID_LEVELS = ["campaign", "adset", "ad"];

// The "Day by day" view's span around the investigated day.
const DAILY_DAYS_BEFORE = 7;
const DAILY_DAYS_AFTER = 7;

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function addDaysUTC(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return isoDate(d);
}

// Inclusive day count between two YYYY-MM-DD strings.
function dayCount(since, until) {
  return Math.round((new Date(`${until}T00:00:00Z`) - new Date(`${since}T00:00:00Z`)) / 86400000) + 1;
}

// `customMetrics`/`customEvents` travel as JSON-encoded query params (this
// endpoint is a GET, unlike pages/api/fb/explore-insights.js's POST body) —
// same per-entry shape Explore's own buildQuerySpecFromView sends:
// `{id, numeratorKey, denominatorKey}` / `{id, accountId, actionType}`.
function parseJsonArrayParam(raw) {
  if (!raw || typeof raw !== "string") return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// A fixed-length "N days after the change" window (3 Days Post Change, 7
// Days Post Change): starts the day after the change and runs N days,
// capped at today — so it shows a real, growing partial total from the first
// post-change day onward instead of hiding as "not enough data" until the
// full N days have elapsed. Only `null` (no window at all) when not even one
// post-change day exists yet, i.e. the change happened today itself — there
// is no "after" data to show, partial or otherwise, until at least tomorrow.
function daysAfterChangeWindow(changeDay, sinceChangeStart, today, days) {
  if (sinceChangeStart > today) return null;
  const until = addDaysUTC(changeDay, days) > today ? today : addDaysUTC(changeDay, days);
  return { since: sinceChangeStart, until, partial: until === today };
}

// Six comparison windows for one entity around one change — three anchored
// to the change itself and always fully in the past (never unavailable), and
// three anchored to the change's own aftermath, two of them fixed-length and
// growing in step with today until each is fully elapsed, one uncapped and
// growing with how long ago the change happened. All whole-day, matching the
// same Insights time_range constraint pages/api/fb/recent-changes.js's bulk
// impact computation already works around (no sub-day windows on this API).
function buildWindows(eventTimeIso) {
  const changeDay = isoDate(new Date(eventTimeIso));
  const today = isoDate(new Date());

  const sinceChangeStart = addDaysUTC(changeDay, 1);
  // Always runs through *today* — per explicit ask, a change should show
  // whatever has accrued so far even on the same day it happened, not stop
  // at "yesterday" and wait for a full day to close. `since` degrades to the
  // change's own day only in the one edge case where `sinceChangeStart`
  // itself is still in the future (the change happened today, so "the day
  // after" doesn't exist yet) — without this fallback the window would be
  // empty rather than showing the change day's own partial data.
  const sinceChangeSince = sinceChangeStart <= today ? sinceChangeStart : changeDay;

  return {
    sevenDaysBefore: { since: addDaysUTC(changeDay, -7), until: addDaysUTC(changeDay, -1) },
    threeDaysBefore: { since: addDaysUTC(changeDay, -3), until: addDaysUTC(changeDay, -1) },
    oneDayBefore: { since: addDaysUTC(changeDay, -1), until: addDaysUTC(changeDay, -1) },
    // `overlapsChange` here means the window's first day is the change's own
    // day — i.e. the change happened today and there's no later day to start
    // from yet, so this necessarily mixes pre- and post-change delivery.
    // `partial` means the window's last day is today, which hasn't finished
    // yet — the number is real but still accruing, not a clean closed total.
    // Since this window always runs through today, it is always partial.
    sinceChange: {
      since: sinceChangeSince,
      until: today,
      partial: true,
      overlapsChange: sinceChangeSince <= changeDay,
    },
    threeDaysAfter: daysAfterChangeWindow(changeDay, sinceChangeStart, today, 3),
    sevenDaysAfter: daysAfterChangeWindow(changeDay, sinceChangeStart, today, 7),
  };
}

// Per-change, on-demand drill-down — a single entity lookup across up to 6
// windows for a user-chosen metric set, not a bulk list (unlike
// pages/api/fb/recent-changes.js's own impact computation), so no MAX_*
// cap or vercel.json maxDuration entry is needed here.
export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session?.accessToken) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  const { objectId, level, eventTime } = req.query;
  if (!objectId || typeof objectId !== "string") {
    return res.status(400).json({ error: "objectId is required" });
  }
  if (!VALID_LEVELS.includes(level)) {
    return res.status(400).json({ error: `level must be one of: ${VALID_LEVELS.join(", ")}` });
  }
  if (!eventTime || isNaN(Date.parse(eventTime))) {
    return res.status(400).json({ error: "eventTime is required and must be a valid date" });
  }
  const metricKeys = String(req.query.metricKeys || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (metricKeys.length === 0) {
    return res.status(400).json({ error: "At least one metric is required" });
  }
  const customMetrics = parseJsonArrayParam(req.query.customMetrics);
  const customEvents = parseJsonArrayParam(req.query.customEvents);

  const token = session.accessToken;
  const fields = resolveGraphFields(metricKeys, [], level, customMetrics, customEvents).join(",");

  if (req.query.mode === "daily") {
    // One row per calendar day, a week either side of the investigated day (capped at today), for the same metric
    // selection — the "Day by day" view next to the before/after windows below.
    const changeDay = isoDate(new Date(eventTime));
    const today = isoDate(new Date());
    const since = addDaysUTC(changeDay, -DAILY_DAYS_BEFORE);
    const afterEnd = addDaysUTC(changeDay, DAILY_DAYS_AFTER);
    const until = afterEnd > today ? today : afterEnd;
    try {
      const result = await graphGetInsights(`/${objectId}/insights`, token, { time_range: { since, until }, time_increment: 1, fields: `${fields},date_start`, limit: 500 });
      const byDay = new Map((result.data || []).map((row) => [row.date_start, row]));
      const days = [];
      for (let d = since; d <= until; d = addDaysUTC(d, 1)) {
        // A day with no delivery has no row — a real zero, same convention as the windows.
        days.push({ date: d, metrics: deriveRowMetrics(byDay.get(d) || {}, metricKeys, [], customMetrics, customEvents) });
      }
      return res.status(200).json({ days, changeDay, today, metricKeys });
    } catch (err) {
      return res.status(502).json({ error: err?.message || "Request failed" });
    }
  }

  const windows = buildWindows(eventTime);

  const windowNames = Object.keys(windows).filter((name) => windows[name] !== null);
  const settled = await Promise.allSettled(
    windowNames.map((name) => {
      // Graph's `time_range` param only accepts `since`/`until` — passing
      // the whole window object (which also carries this endpoint's own
      // `overlapsChange`/`partial` bookkeeping flags) fails outright with
      // "(#100) Invalid keys ... were found in param time_range" for any
      // window that has either flag set (sinceChange always carries
      // `partial`) — confirmed live via that exact error message.
      const { since, until } = windows[name];
      return graphGetInsights(`/${objectId}/insights`, token, { time_range: { since, until }, fields });
    })
  );

  const results = {};
  settled.forEach((result, i) => {
    const name = windowNames[i];
    const { since, until, overlapsChange, partial } = windows[name];
    const days = dayCount(since, until);
    if (result.status !== "fulfilled") {
      results[name] = { since, until, days, overlapsChange, partial, metrics: null, error: result.reason?.message || "Request failed" };
      return;
    }
    // An empty data array means no delivery that window — a real zero, not
    // a missing value, same convention as the bulk impact computation.
    const row = (result.value.data || [])[0] || {};
    results[name] = { since, until, days, overlapsChange, partial, metrics: deriveRowMetrics(row, metricKeys, [], customMetrics, customEvents) };
  });

  res.status(200).json({ windows: results, metricKeys });
}
