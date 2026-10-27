// Shared date-range math for Explore's query spec and its date-range picker
// (components/DateRangeMenu.js) — pulled out of pages/explore.js so both can
// resolve the same preset the same way without one importing page-level code
// from the other.

export const RANGE_PRESETS = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "last_3d", label: "Last 3 Days" },
  { key: "last_7d", label: "Last 7 Days" },
  { key: "last_14d", label: "Last 14 Days" },
  { key: "last_30d", label: "Last 30 Days" },
  { key: "last_90d", label: "Last 90 Days" },
  { key: "last_365d", label: "Last 365 Days" },
  { key: "this_month", label: "This Month" },
  { key: "last_month", label: "Last Month" },
  { key: "custom", label: "Custom" },
];

export function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

export function addDaysUTC(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return isoDate(d);
}

// Meta reports every ad account in that account's own time zone (the
// `timezone_name` field, e.g. "America/Los_Angeles"), so "today" — and with it
// "Last 7 Days", "Yesterday", "This Month" — is the account's calendar day, not
// the viewer's or UTC's. At 2 PM India time it is still the previous day in
// the US, so the same preset resolves to a different window per account.
// A missing/invalid zone falls back to UTC (the previous behaviour).
export function resolveTimeZone(timeZone) {
  if (!timeZone) return "UTC";
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone });
    return timeZone;
  } catch {
    return "UTC";
  }
}

// The calendar date it currently is in `timeZone`, as a Date at 00:00 UTC of
// that date — same shape todayUTC() always returned, so every addDaysUTC /
// isoDate caller keeps working unchanged.
export function todayInTimeZone(timeZone, now = new Date()) {
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: resolveTimeZone(timeZone), year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return new Date(`${ymd}T00:00:00Z`);
}

export function todayUTC(timeZone) {
  if (timeZone) return todayInTimeZone(timeZone);
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

// Short label for the UI, e.g. "Asia/Kolkata (UTC+5:30)".
export function formatTimeZoneLabel(timeZone, now = new Date()) {
  const tz = resolveTimeZone(timeZone);
  const part = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "longOffset" }).formatToParts(now).find((p) => p.type === "timeZoneName")?.value || "";
  const offset = part.replace("GMT", "UTC").replace(/^UTC$/, "UTC+0");
  return `${tz.replace(/_/g, " ")} (${offset})`;
}

// Mirrors pages/report.js's own lastNDaysRangeUTC() (and lib/adCreativeDetails.js's
// server-side lastNDaysRange()) exactly: "Last N Days" means the N full days
// immediately before today, not including today itself — today's own data is
// still accumulating throughout the day and isn't a complete, comparable day
// the way Ads Manager's "Last N days" picker also treats it. "Today" and
// "Yesterday" are separate, explicit presets and are unaffected by this.
function lastNDaysRangeExcludingToday(n, today) {
  const until = addDaysUTC(isoDate(today), -1);
  return { since: addDaysUTC(until, -(n - 1)), until };
}

// Every preset resolves to a concrete {since, until} — "custom" is the only
// one that depends on user input rather than "now".
export function computeRange(preset, customSince, customUntil, timeZone) {
  const today = todayUTC(timeZone);
  switch (preset) {
    case "today":
      return { since: isoDate(today), until: isoDate(today) };
    case "yesterday": {
      const y = addDaysUTC(isoDate(today), -1);
      return { since: y, until: y };
    }
    case "last_3d":
      return lastNDaysRangeExcludingToday(3, today);
    case "last_7d":
      return lastNDaysRangeExcludingToday(7, today);
    case "last_14d":
      return lastNDaysRangeExcludingToday(14, today);
    case "last_30d":
      return lastNDaysRangeExcludingToday(30, today);
    case "last_90d":
      return lastNDaysRangeExcludingToday(90, today);
    case "last_365d":
      return lastNDaysRangeExcludingToday(365, today);
    // Unlike every "Last N Days" preset above, month-to-date includes today
    // — the natural reading of "This Month" is "so far," not "excluding
    // whatever's still accumulating," the way a trailing N-day window is.
    case "this_month": {
      const todayIso = isoDate(today);
      return { since: `${todayIso.slice(0, 7)}-01`, until: todayIso };
    }
    // The full previous calendar month (1st through its last day) — unlike
    // "This Month," always a complete, comparable period rather than a
    // still-accumulating one.
    case "last_month": {
      const firstOfThisMonth = `${isoDate(today).slice(0, 7)}-01`;
      const lastOfPrevMonth = addDaysUTC(firstOfThisMonth, -1);
      return { since: `${lastOfPrevMonth.slice(0, 7)}-01`, until: lastOfPrevMonth };
    }
    case "custom":
      return customSince && customUntil ? { since: customSince, until: customUntil } : null;
    default:
      return null;
  }
}

export function inclusiveDayCount(since, until) {
  return Math.round((new Date(`${until}T00:00:00Z`) - new Date(`${since}T00:00:00Z`)) / 86400000) + 1;
}
