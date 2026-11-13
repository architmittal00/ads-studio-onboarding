import { fetchWithTimeout, readApiResponse } from "@/lib/fetchJson";

// The account's creative pool (pages/api/fb/rules/creative-pool.js) is the same for every ad set, so it is
// fetched once per account, kept for 30 minutes in memory, and shared between cards opened at the same time.
// It also takes 30+ seconds on a big account, so the last result is kept in this browser (up to 2 hours): a visit
// starts from that copy at once and refreshes it quietly, so opening a card never waits for the full read again.
const TTL_MS = 30 * 60 * 1000;
const STALE_MAX_MS = 2 * 60 * 60 * 1000;
const SKIP_REFRESH_MS = 5 * 60 * 1000; // a saved copy this fresh is not re-read at all
const STORE_PREFIX = "creative-pool:v1:";
const MAX_STORED_CHARS = 2_500_000;
const MAX_STORED_ACCOUNTS = 3;
const cache = new Map(); // accountId -> { at, promise, value }

// The saved copy belongs to ONE signed-in user: it is only read or written while the page has told us who that is
// (setCreativePoolUser), it carries that user's id, and sign-out removes every saved copy — so another person signing
// in on the same browser never sees someone else's ad numbers.
let poolUser = null;
export function setCreativePoolUser(userId) {
  const next = userId ? String(userId) : null;
  if (next === poolUser) return;
  poolUser = next;
  cache.clear();
}

export function clearSavedCreativePools() {
  cache.clear();
  try {
    for (const key of Object.keys(localStorage)) if (key.startsWith(STORE_PREFIX)) localStorage.removeItem(key);
  } catch {}
}

function readStored(accountId) {
  if (!poolUser) return null;
  try {
    const raw = localStorage.getItem(STORE_PREFIX + accountId);
    if (!raw) return null;
    const { at, u, value } = JSON.parse(raw);
    if (u !== poolUser) return null;
    if (!Array.isArray(value?.ads) || !Number.isFinite(at) || Date.now() - at > STALE_MAX_MS) return null;
    return { at, value };
  } catch {
    return null;
  }
}

function writeStored(accountId, value) {
  if (!poolUser) return;
  try {
    const raw = `{"at":${Date.now()},"u":${JSON.stringify(poolUser)},"value":${JSON.stringify(value)}}`; // `at` first, so pruning can read it without parsing
    if (raw.length > MAX_STORED_CHARS) return;
    localStorage.setItem(STORE_PREFIX + accountId, raw);
    // Keep only the most recently saved few accounts.
    const others = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(STORE_PREFIX) || key === STORE_PREFIX + accountId) continue;
      const at = Number(/^\{"at":(\d+)/.exec(localStorage.getItem(key) || "")?.[1] || 0);
      others.push({ key, at });
    }
    others.sort((x, y) => y.at - x.at);
    for (const o of others.slice(MAX_STORED_ACCOUNTS - 1)) localStorage.removeItem(o.key);
  } catch {}
}

function dropStored(accountId) {
  try {
    localStorage.removeItem(STORE_PREFIX + accountId);
  } catch {}
}

export function loadCreativePool(accountId, tz, { force = false } = {}) {
  const hit = cache.get(accountId);
  if (!force && hit && Date.now() - hit.at < TTL_MS) return hit.promise;
  const url = `/api/fb/rules/creative-pool?accountId=${encodeURIComponent(accountId)}${tz ? `&tz=${encodeURIComponent(tz)}` : ""}`;
  const fetchPool = () => fetchWithTimeout(url, { idempotent: true }, 130000).then((res) => readApiResponse(res));
  // Meta now and then refuses one of the lookups for a moment (rate limit, busy); a second go a moment later usually works.
  const fetchWithRetry = () => fetchPool().catch(() => new Promise((resolve) => setTimeout(resolve, 2000)).then(fetchPool));

  const stored = force ? null : readStored(accountId);
  if (stored) {
    const entry = { at: Date.now(), promise: Promise.resolve(stored.value), value: stored.value };
    cache.set(accountId, entry);
    if (Date.now() - stored.at > SKIP_REFRESH_MS) {
      // Refresh in the background; the next card opened gets the new numbers. A failure keeps the saved copy.
      fetchWithRetry()
        .then((fresh) => {
          entry.at = Date.now();
          entry.value = fresh;
          entry.promise = Promise.resolve(fresh);
          writeStored(accountId, fresh);
        })
        .catch(() => {});
    }
    return entry.promise;
  }

  const promise = fetchWithRetry().catch((err) => {
    cache.delete(accountId); // a failure isn't remembered
    throw err;
  });
  const entry = { at: Date.now(), promise, value: null };
  promise
    .then((v) => {
      entry.value = v;
      writeStored(accountId, v);
    })
    .catch(() => {});
  cache.set(accountId, entry);
  return promise;
}

// The pool if it has already arrived, so a card opened after a prefetch renders at once instead of flashing a loader.
export function peekCreativePool(accountId) {
  const hit = cache.get(accountId);
  return hit && Date.now() - hit.at < TTL_MS && Array.isArray(hit.value?.ads) ? hit.value : null;
}

export function clearCreativePool(accountId) {
  cache.delete(accountId);
  dropStored(accountId); // the ad set's ads just changed, so a saved copy would be out of date
}

// The target ad set's own ads need their names (language), landing pages, creative kinds and thumbnails to learn what
// that ad set spends on. A few ads, so one small call, kept per set of ads.
const extras = new Map();
export function loadAdsetExtras(adIds) {
  const key = [...adIds].sort().join(",");
  if (!key) return Promise.resolve({ info: {} });
  const hit = extras.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.promise;
  const entry = { at: Date.now(), promise: null, value: null };
  const promise = fetchWithTimeout("/api/fb/ad-creative-info", { idempotent: true, method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ adIds }) }, 60000)
    .then((res) => readApiResponse(res))
    .then((json) => ({ info: json.info || {} }))
    .catch(() => ({ info: {} }));
  entry.promise = promise;
  promise.then((v) => (entry.value = v));
  extras.set(key, entry);
  return promise;
}

export function peekAdsetExtras(adIds) {
  const hit = extras.get([...adIds].sort().join(","));
  return hit && Date.now() - hit.at < TTL_MS ? hit.value : null;
}

// Warm everything the "Add a creative" cards need — the pool, then each target ad set's own-ads lookup — so opening a card
// is instant. Safe to call repeatedly (both loads are cached).
export function prefetchPushData(accountId, tz, adsetIds = []) {
  return loadCreativePool(accountId, tz)
    .then((pool) => Promise.all(adsetIds.map((id) => loadAdsetExtras(pool.ads.filter((a) => a.adsetId === id).map((a) => a.id)))))
    .catch(() => {});
}
