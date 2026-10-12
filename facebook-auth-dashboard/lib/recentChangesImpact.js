import { pickPurchaseCount, roasFromRow } from "./metrics";

// Bounds how many changes get a performance-impact lookup at all — each one
// needs up to 2 extra Insights calls (before + after). pages/api/fb/recent-changes.js's
// own changes list still shows every matching change regardless; only the
// impact signal is capped beyond this, which pages/recent-changes.js
// surfaces per-row (`impactCapped`) and in a top-of-list notice. Imported by
// both that list endpoint (to compute the cap) and the client page (to word
// the notice), so the two can never drift apart.
export const MAX_IMPACT_CHANGES = 50;

// How many changes' impact pages/recent-changes.js asks pages/api/fb/recent-changes/impact.js
// for in a single request. The list used to compute impact for every
// eligible change inline, in one request — which meant the whole page
// stayed blank until every one of those (up to 100) Graph calls finished.
// Splitting it into small batches lets the list render immediately and its
// quick-signal badges fill in progressively, batch by batch, instead.
export const IMPACT_BATCH_SIZE = 10;

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function addDaysUTC(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return isoDate(d);
}

// Facebook's Insights `time_range` only supports whole-day {since, until}
// windows (YYYY-MM-DD), not arbitrary sub-day timestamps — there's no way to
// ask for "the 24 hours immediately before/after 14:32" the way a change's
// own event_time is precise to the second. So the comparison is day-level
// instead: the single full calendar day immediately before the change's own
// day, vs. the single full calendar day immediately after it. "Too recent"
// means that *after* day hasn't fully elapsed yet (the change happened today
// or yesterday) — comparing against a still-in-progress partial day would be
// misleading, so it's skipped entirely rather than shown as a real number.
export function impactWindowFor(eventTimeIso) {
  const changeDay = isoDate(new Date(eventTimeIso));
  const dayBefore = addDaysUTC(changeDay, -1);
  const dayAfter = addDaysUTC(changeDay, 1);
  return { dayBefore, dayAfter, tooRecent: dayAfter >= isoDate(new Date()) };
}

// Spend/Purchases/ROAS — the same three values lib/insightsMetrics.js's own
// catalog already surfaces for these exact metrics, reusing lib/metrics.js's
// helpers rather than re-deriving extraction logic. `row` is undefined when
// Facebook returned no data row at all for that single day (no delivery),
// which is a real zero, not a failure — callers pass a zeroed stand-in row
// in that case so this doesn't need to special-case it.
export function extractImpactMetrics(row) {
  const { spend, roas } = roasFromRow(row);
  const purchases = pickPurchaseCount(row.actions);
  return { spend, purchases, roas };
}
