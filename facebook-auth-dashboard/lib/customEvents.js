import { getCachedEntry, setCachedEntry } from "./clientCache";

// Same cache prefix pages/explore.js's own custom-conversions fetch effect
// uses (its local CUSTOM_EVENTS_CACHE_PREFIX) — kept as the identical
// literal so a discovery made from either place (Explore's query panel, the
// Investigate drawer's metric picker) is reused by the other, without
// needing Explore's own already-working fetch effect to import anything
// from here.
export const CUSTOM_EVENTS_CACHE_PREFIX = "explore-custom-conversions:";
const CUSTOM_EVENTS_CACHE_MAX_ENTRIES = 20;

// Account-discovered Custom Conversions (Events Manager-formalized CAPI/
// pixel custom events, see /api/fb/custom-conversions) for one or more
// accounts, with the same 30-min cache every other /api/fb/* fetch in this
// app uses. Resolves from cache synchronously-fast when already known;
// otherwise fetches and caches before resolving.
export async function fetchCustomEvents(accountIds) {
  const sorted = [...new Set(accountIds)].sort();
  if (sorted.length === 0) return [];
  const cacheKey = CUSTOM_EVENTS_CACHE_PREFIX + JSON.stringify(sorted);
  const cached = getCachedEntry(cacheKey);
  if (cached) return cached.data.customEvents || [];
  const res = await fetch(`/api/fb/custom-conversions?accountIds=${sorted.join(",")}`);
  const json = await res.json();
  if (json.error) return [];
  setCachedEntry(cacheKey, json, { prefix: CUSTOM_EVENTS_CACHE_PREFIX, maxEntriesForPrefix: CUSTOM_EVENTS_CACHE_MAX_ENTRIES });
  return json.customEvents || [];
}
