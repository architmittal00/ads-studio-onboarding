const CACHE_PREFIX = "fb-dashboard:cache:";

// Shared TTL cache for anything fetched from our own /api/fb/* routes that's
// safe to reuse across tabs/reloads for a while — the account list, report
// payloads, dashboard insights, strategy signals, and Explore's custom
// queries all go through this one implementation instead of each page
// inventing its own (localStorage, not sessionStorage/memory, specifically so
// it survives a reload and is shared across tabs in the same browser — the
// gap the old per-tab in-memory caches like report.js's `useRef(new Map())`
// left). Same try/catch-and-silently-fall-back convention as
// lib/clientStorage.js.
export const DEFAULT_CACHE_TTL_MS = 30 * 60 * 1000;

export function getCachedEntry(key, ttlMs = DEFAULT_CACHE_TTL_MS) {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const entry = JSON.parse(raw);
    if (!entry || typeof entry.fetchedAt !== "number") return null;
    if (Date.now() - entry.fetchedAt > ttlMs) return null;
    return entry;
  } catch {
    return null;
  }
}

// `prefix` + `maxEntriesForPrefix` are only needed for a cache key space that
// can grow unboundedly over a browsing session (Explore's query-shaped keys)
// — pruning the oldest entries under that prefix keeps localStorage from
// accumulating stale entries forever. Fixed keys (the account list, one
// report per account+range) don't need this since TTL alone bounds them.
export function setCachedEntry(key, data, { prefix, maxEntriesForPrefix } = {}) {
  try {
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ data, fetchedAt: Date.now() }));
    if (prefix && maxEntriesForPrefix) pruneCachePrefix(prefix, maxEntriesForPrefix);
  } catch {
    // Private browsing / blocked storage / quota exceeded — silently ignore,
    // same as every other localStorage write in this app.
  }
}

export function clearCachedEntry(key) {
  try {
    localStorage.removeItem(CACHE_PREFIX + key);
  } catch {
    // Private browsing / blocked storage — silently ignore.
  }
}

// Keeps at most `maxEntries` cache entries whose key starts with `prefix`,
// evicting the oldest (by fetchedAt) first. Best-effort: any entry that
// fails to parse is treated as the oldest (evicted first) rather than
// aborting the whole prune.
function pruneCachePrefix(prefix, maxEntries) {
  const fullPrefix = CACHE_PREFIX + prefix;
  const entries = [];
  for (let i = 0; i < localStorage.length; i++) {
    const storageKey = localStorage.key(i);
    if (!storageKey || !storageKey.startsWith(fullPrefix)) continue;
    let fetchedAt = -1;
    try {
      fetchedAt = JSON.parse(localStorage.getItem(storageKey))?.fetchedAt ?? -1;
    } catch {
      // leave at -1 so it's evicted first
    }
    entries.push({ storageKey, fetchedAt });
  }
  if (entries.length <= maxEntries) return;
  entries.sort((a, b) => b.fetchedAt - a.fetchedAt);
  for (const { storageKey } of entries.slice(maxEntries)) {
    localStorage.removeItem(storageKey);
  }
}

export function formatAge(ms) {
  const mins = Math.round(ms / 60000);
  if (mins < 1) return "just now";
  if (mins === 1) return "1 minute ago";
  if (mins < 60) return `${mins} minutes ago`;
  const hours = Math.round(mins / 60);
  return `${hours} hour${hours > 1 ? "s" : ""} ago`;
}
