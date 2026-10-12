import { graphGet } from "./facebookGraph";

// Centralizes Meta ad-interest search — previously inlined as a single-pick
// helper in campaignLaunch.js (resolveInterestId), now also backing the live
// search-as-you-type picker and the AI-recommendation matching step, both of
// which need the full result set, not just one chosen id.
export async function searchAdInterests(token, query, { limit = 25 } = {}) {
  return searchTargeting(token, "adinterest", query, { limit });
}

// Meta's `/search` endpoint is one generic targeting-search primitive shared
// across every targeting dimension it exposes search for — `type=adinterest`
// (interests, above), `type=adgeolocation` (countries/regions/cities, needs
// `location_types`), `type=adlocale` (languages) all go through the exact
// same shape. Added for the Launch tab's Location/Language pickers
// (pages/api/fb/targeting-search.js) without touching the interest-specific
// wrapper above, which the Strategy flow already depends on.
export async function searchTargeting(token, type, query, { limit = 25, ...extraParams } = {}) {
  const json = await graphGet("/search", token, { type, q: query, limit, ...extraParams });
  return json.data || [];
}

// Picks the single best match from a result set — exact (case-insensitive)
// name match if one exists, otherwise Meta's own top-ranked result. Used by
// the legacy single-query resolution path (campaignLaunch.js) and anywhere
// else that needs one answer rather than a list to choose from.
export function pickBestMatch(results, query) {
  if (results.length === 0) return null;
  const exact = results.find((r) => r.name?.toLowerCase() === query.toLowerCase());
  return exact || results[0];
}

// `/search?type=adinterest` takes exactly one `q` per call — no batch/bulk
// variant exists. Resolving ~50-80 AI-suggested names means that many calls;
// this bounds how many run at once (avoids both unacceptable serial latency
// and flooding Facebook/our own `/logs` with everything at once). No new
// dependency — a small hand-rolled worker-pool runner.
export async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;

  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }

  await Promise.all(Array(Math.min(limit, items.length)).fill(0).map(worker));
  return results;
}
