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
    const storageKey = CACHE_PREFIX + key;
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;
    const entry = JSON.parse(raw);
    // An expired (or unparseable-as-a-real-entry) hit is removed right here,
    // not just treated as a miss — previously this only ever returned `null`
    // and left the dead entry sitting in localStorage forever, since nothing
    // else ever revisits an exact-same-shaped key once its query stops being
    // re-run. Over weeks of real usage across 50+ users this is what let
    // localStorage quietly fill up with months-old, already-unusable
    // entries. See sweepAllKnownCaches() below for the complementary
    // one-shot cleanup of entries that were already stale before this fix
    // shipped, for keys nobody ever looks up again.
    if (!entry || typeof entry.fetchedAt !== "number" || Date.now() - entry.fetchedAt > ttlMs) {
      localStorage.removeItem(storageKey);
      return null;
    }
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

// Removes every entry under `prefix` whose own `fetchedAt` is already past
// `ttlMs` (or that fails to parse at all) — unlike getCachedEntry's own
// expiry check, this doesn't wait for something to look that exact key up
// again first. A one-off query (a custom date range picked once, say) would
// otherwise sit expired-but-undeleted forever, since nothing will ever
// generate that exact cache key a second time to trigger the lazy check.
function sweepExpiredEntries(prefix, ttlMs) {
  const fullPrefix = CACHE_PREFIX + prefix;
  const now = Date.now();
  const expiredKeys = [];
  for (let i = 0; i < localStorage.length; i++) {
    const storageKey = localStorage.key(i);
    if (!storageKey || !storageKey.startsWith(fullPrefix)) continue;
    let fetchedAt = null;
    try {
      fetchedAt = JSON.parse(localStorage.getItem(storageKey))?.fetchedAt;
    } catch {
      // Unparseable — treat the same as expired, below.
    }
    if (typeof fetchedAt !== "number" || now - fetchedAt > ttlMs) expiredKeys.push(storageKey);
  }
  for (const storageKey of expiredKeys) localStorage.removeItem(storageKey);
}

// Every cache family that can accumulate more than a handful of entries over
// time, with how many of its (still-fresh) entries are worth keeping around.
// Hardcoded here, rather than each consumer registering itself on import, so
// a sweep is guaranteed complete regardless of which page a visitor happens
// to load first — a per-module "register on import" approach would only
// sweep whichever caches that page's own code path actually touched.
// Keep this in sync with every `setCachedEntry(key, data, { prefix, ... })`
// call site in the app (currently: pages/explore.js, pages/recent-changes.js,
// lib/customEvents.js, components/InvestigateDrawer.js,
// components/EntityDrillDown.js).
const KNOWN_CACHE_FAMILIES = [
  { prefix: "explore:", maxEntries: 50 },
  { prefix: "recent-changes:", maxEntries: 50 },
  { prefix: "explore-custom-conversions:", maxEntries: 20 },
  { prefix: "recent-changes-investigate:", maxEntries: 40 },
  { prefix: "recent-changes-drilldown-investigate:", maxEntries: 40 },
];

// Run once per app load (see pages/_app.js) — self-heals existing bloat for
// every visitor the moment this ships, rather than relying on a manual
// localStorage.clear() or each person stumbling onto this on their own.
// Sweeps TTL-expired entries first (the actual fix for "a 6-day-old entry
// sits there forever"), then re-enforces each family's own max-entries cap
// on whatever fresh entries remain — belt and suspenders with the cap
// setCachedEntry already applies on every write, and the only cap at all for
// the two investigate caches below, which never passed one before.
export function sweepAllKnownCaches(ttlMs = DEFAULT_CACHE_TTL_MS) {
  try {
    for (const { prefix, maxEntries } of KNOWN_CACHE_FAMILIES) {
      sweepExpiredEntries(prefix, ttlMs);
      pruneCachePrefix(prefix, maxEntries);
    }
  } catch {
    // Private browsing / blocked storage — silently ignore, same as every
    // other localStorage access in this app.
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
