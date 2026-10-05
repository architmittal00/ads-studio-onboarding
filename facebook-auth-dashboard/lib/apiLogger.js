const MAX_LOGS = 200;

// Use globalThis so logs survive hot reloads / warm serverless re-invocations
// within the same function instance. This is best-effort only — it resets on
// cold start or redeploy, since Vercel functions have no persistent disk.
const store = globalThis.__fbApiLogs || (globalThis.__fbApiLogs = []);

let counter = 0;

export function logApiCall(entry) {
  counter += 1;
  store.unshift({
    id: `${Date.now()}-${counter}`,
    timestamp: new Date().toISOString(),
    ...entry,
  });
  if (store.length > MAX_LOGS) {
    store.length = MAX_LOGS;
  }
}

export function getApiLogs() {
  return store;
}

export function clearApiLogs() {
  store.length = 0;
}
