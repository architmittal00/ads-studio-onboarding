import { getServerSession } from "next-auth/next";
import { authOptions } from "../../auth/[...nextauth]";
import { graphGetInsights } from "@/lib/facebookGraph";
import { resolveGraphFields, deriveRowMetrics } from "@/lib/insightsMetrics";

// "ad" is reachable only via components/EntityDrillDown.js's own per-row
// comparison table (RCA on the ads inside a changed ad set/campaign) — the
// top-level change itself is always logged against a campaign or ad set, per
// VALID_LEVELS' original two entries.
const VALID_LEVELS = ["campaign", "adset", "ad"];

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

// Six comparison windows for one entity around one change — three anchored
// to the change itself (always fully in the past, never unavailable), one
// that grows with how long ago the change happened, and two anchored to
// *now* instead of the change (most useful for an older change, where
// "Since Change" alone would average over a long, diluted period and not
// show where things stand today). All whole-day, matching the same Insights
// time_range constraint pages/api/fb/recent-changes.js's bulk impact
// computation already works around (no sub-day windows exist on this API).
function buildWindows(eventTimeIso) {
  const changeDay = isoDate(new Date(eventTimeIso));
  const today = isoDate(new Date());
  const yesterday = addDaysUTC(today, -1);

  const sinceChangeStart = addDaysUTC(changeDay, 1);
  const sinceChangeAvailable = sinceChangeStart <= yesterday;

  const last3DaysSince = addDaysUTC(today, -3);
  const last7DaysSince = addDaysUTC(today, -7);

  return {
    sevenDaysBefore: { since: addDaysUTC(changeDay, -7), until: addDaysUTC(changeDay, -1) },
    threeDaysBefore: { since: addDaysUTC(changeDay, -3), until: addDaysUTC(changeDay, -1) },
    oneDayBefore: { since: addDaysUTC(changeDay, -1), until: addDaysUTC(changeDay, -1) },
    sinceChange: sinceChangeAvailable ? { since: sinceChangeStart, until: yesterday } : null,
    // `overlapsChange` flags a now-anchored window whose start falls on or
    // before the change's own day — it mixes pre-change and post-change
    // delivery into one number, which would misleadingly read as a clean
    // "since the change" value. Only possible for a change more recent than
    // the window is long (e.g. a change from 2 days ago inside a "Last 7
    // Days" window) — components/InvestigateDrawer.js shows a muted
    // explanation instead of the number when this is set.
    last3Days: { since: last3DaysSince, until: yesterday, overlapsChange: last3DaysSince <= changeDay },
    last7Days: { since: last7DaysSince, until: yesterday, overlapsChange: last7DaysSince <= changeDay },
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
  const windows = buildWindows(eventTime);

  const windowNames = Object.keys(windows).filter((name) => windows[name] !== null);
  const settled = await Promise.allSettled(
    windowNames.map((name) =>
      graphGetInsights(`/${objectId}/insights`, token, { time_range: windows[name], fields })
    )
  );

  const results = {};
  settled.forEach((result, i) => {
    const name = windowNames[i];
    const { since, until, overlapsChange } = windows[name];
    const days = dayCount(since, until);
    if (result.status !== "fulfilled") {
      results[name] = { since, until, days, overlapsChange, metrics: null, error: result.reason?.message || "Request failed" };
      return;
    }
    // An empty data array means no delivery that window — a real zero, not
    // a missing value, same convention as the bulk impact computation.
    const row = (result.value.data || [])[0] || {};
    results[name] = { since, until, days, overlapsChange, metrics: deriveRowMetrics(row, metricKeys, [], customMetrics, customEvents) };
  });
  if (windows.sinceChange === null) {
    results.sinceChange = { since: null, until: null, days: 0, metrics: null, tooRecent: true };
  }

  res.status(200).json({ windows: results, metricKeys });
}
