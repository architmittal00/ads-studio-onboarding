import { fetchWithTimeout, parseJsonResponse } from "@/lib/fetchJson";

// The account's creative pool (pages/api/fb/rules/creative-pool.js) is the same for every ad set, so it is
// fetched once per account, kept for 30 minutes in memory, and shared between cards opened at the same time.
const TTL_MS = 30 * 60 * 1000;
const cache = new Map(); // accountId -> { at, promise }

export function loadCreativePool(accountId, tz, { force = false } = {}) {
  const hit = cache.get(accountId);
  if (!force && hit && Date.now() - hit.at < TTL_MS) return hit.promise;
  const promise = fetchWithTimeout(`/api/fb/rules/creative-pool?accountId=${encodeURIComponent(accountId)}${tz ? `&tz=${encodeURIComponent(tz)}` : ""}`, { idempotent: true }, 130000)
    .then((res) => parseJsonResponse(res))
    .catch((err) => {
      cache.delete(accountId); // a failure isn't remembered
      throw err;
    });
  cache.set(accountId, { at: Date.now(), promise });
  return promise;
}

export function clearCreativePool(accountId) {
  cache.delete(accountId);
}
