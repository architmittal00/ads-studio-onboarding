import { fetchWithTimeout, parseJsonResponse } from "@/lib/fetchJson";

// Shared in-memory GET cache for the account-scoped lookup lists the app asks for over
// and over (ad sets / campaigns of an account, pixels + pages). It does two things:
//  - de-dupes: components that mount together share one in-flight request instead of
//    each firing their own;
//  - remembers: opening a modal or switching tabs again within the TTL is instant.
// Memory only (gone on reload) and per tab, so it never serves another user's data.
// Failed requests and responses carrying an `error` are never kept.
// Returned objects are shared — treat them as read-only.
const DEFAULT_TTL_MS = 3 * 60 * 1000;
const store = new Map(); // url -> { promise, at }

export function cachedGet(url, { ttlMs = DEFAULT_TTL_MS, force = false } = {}) {
  const hit = store.get(url);
  if (!force && hit && Date.now() - hit.at < ttlMs) return hit.promise;
  const promise = fetchWithTimeout(url)
    .then(parseJsonResponse)
    .then((json) => {
      if (json?.error && store.get(url)?.promise === promise) store.delete(url);
      return json;
    })
    .catch((err) => {
      if (store.get(url)?.promise === promise) store.delete(url);
      throw err;
    });
  store.set(url, { promise, at: Date.now() });
  return promise;
}

// Call after something that changes these lists (a launch, duplicate or copy finished),
// so the next picker shows the new ad set / campaign. No argument clears everything;
// a prefix clears just the matching URLs.
export function invalidateCachedGets(urlPrefix) {
  for (const key of [...store.keys()]) {
    if (!urlPrefix || key.startsWith(urlPrefix)) store.delete(key);
  }
}
