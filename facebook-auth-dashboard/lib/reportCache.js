export const REPORT_CACHE_TTL_MS = 30 * 60 * 1000;

// globalThis survives warm serverless re-invocations within the same
// function instance — best-effort only, resets on cold start/redeploy,
// same caveat as lib/apiLogger.js.
const store = globalThis.__fbReportCache || (globalThis.__fbReportCache = new Map());

export function getCachedReport(key) {
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > REPORT_CACHE_TTL_MS) return null;
  return entry;
}

export function setCachedReport(key, data) {
  store.set(key, { data, fetchedAt: Date.now() });
}
