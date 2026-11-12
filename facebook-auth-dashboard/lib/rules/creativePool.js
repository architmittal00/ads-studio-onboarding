import { fetchWithTimeout, parseJsonResponse } from "@/lib/fetchJson";

// The account's creative pool (pages/api/fb/rules/creative-pool.js) is the same for every ad set, so it is
// fetched once per account, kept for 30 minutes in memory, and shared between cards opened at the same time.
const TTL_MS = 30 * 60 * 1000;
const cache = new Map(); // accountId -> { at, promise, value }

export function loadCreativePool(accountId, tz, { force = false } = {}) {
  const hit = cache.get(accountId);
  if (!force && hit && Date.now() - hit.at < TTL_MS) return hit.promise;
  const promise = fetchWithTimeout(`/api/fb/rules/creative-pool?accountId=${encodeURIComponent(accountId)}${tz ? `&tz=${encodeURIComponent(tz)}` : ""}`, { idempotent: true }, 130000)
    .then((res) => parseJsonResponse(res))
    .catch((err) => {
      cache.delete(accountId); // a failure isn't remembered
      throw err;
    });
  const entry = { at: Date.now(), promise, value: null };
  promise.then((v) => (entry.value = v)).catch(() => {});
  cache.set(accountId, entry);
  return promise;
}

// The pool if it has already arrived, so a card opened after a prefetch renders at once instead of flashing a loader.
export function peekCreativePool(accountId) {
  const hit = cache.get(accountId);
  return hit && Date.now() - hit.at < TTL_MS ? hit.value : null;
}

export function clearCreativePool(accountId) {
  cache.delete(accountId);
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
    .then((res) => parseJsonResponse(res))
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
