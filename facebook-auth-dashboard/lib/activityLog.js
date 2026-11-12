import { graphGetAllPages } from "./facebookGraph";

// An ad account's activity log over [sinceUnix, untilUnix], read as several time slices fetched IN PARALLEL.
// A page can only be requested after the previous one (cursor paging), so a busy account's log — thousands of events
// of every kind — takes one long chain of round trips; independent slices turn that chain into several shorter ones
// that run side by side. Slices are disjoint and returned newest first, so the combined list reads like the single
// query's (same shape: `{ data }`). Any slice failing fails the whole read, as before.
export function sliceCountFor(hours) {
  return Math.min(6, Math.max(2, Math.ceil(hours / 12))); // 24h → 2, 48h → 4, 72h and up → 6
}

export function activitySlices(sinceUnix, untilUnix, count) {
  const span = untilUnix - sinceUnix;
  const step = Math.ceil(span / count);
  const slices = [];
  for (let i = 0; i < count; i++) {
    const until = untilUnix - i * step;
    const since = i === count - 1 ? sinceUnix : untilUnix - (i + 1) * step + 1;
    if (since <= until) slices.push({ since, until });
  }
  return slices;
}

// `category` (e.g. "BUDGET") has Meta filter the log itself, which on a busy account is the difference between a few
// hundred events and tens of thousands.
export async function fetchActivities(accountId, token, { sinceUnix, untilUnix, fields, limit = 500, category }) {
  const slices = activitySlices(sinceUnix, untilUnix, sliceCountFor((untilUnix - sinceUnix) / 3600));
  const parts = await Promise.all(slices.map((s) => graphGetAllPages(`/${accountId}/activities`, token, { since: s.since, until: s.until, limit, fields, ...(category ? { category } : {}) })));
  return { data: parts.flatMap((p) => p.data || []) };
}
