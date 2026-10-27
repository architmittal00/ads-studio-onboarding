// Retry policy shared by both Graph clients (lib/facebookGraph.js and
// launch-ad/lib/graph.ts). Facebook fails transiently far more often than its
// error text suggests — "Request failed", "An unknown error occurred", rate
// limits, gateway 5xx, dropped connections — and nearly all of those succeed a
// moment later. Anything that doesn't (bad params, permissions, expired token)
// is NOT retried and its exact Facebook message is passed through untouched.
export const MAX_GRAPH_RETRIES = 3;

// Graph codes meaning "the request was rejected because of load/limits": safe
// to repeat even for writes, since nothing was executed.
const RATE_LIMIT_CODES = new Set([4, 17, 32, 341, 613]);
const isRateLimit = (code) => RATE_LIMIT_CODES.has(code) || (code >= 80000 && code <= 80014);

// Transient "try again" codes: 1 (unknown error — but not the permanent
// "reduce the amount of data" variant) and 2 (service temporarily unavailable).
function isTransientCode(error) {
  if (error.is_transient === true) return true;
  if (error.code === 2) return true;
  if (error.code === 1) return !/reduce the amount of data/i.test(error.message || "");
  return false;
}

// kind: "network" (fetch threw), "http" (non-JSON / 5xx body), "graph" (error object)
export function shouldRetryGraph({ kind, status, error, isWrite }) {
  if (kind === "graph") {
    if (isRateLimit(error?.code)) return true;
    // Writes might already have been applied when Facebook reports a generic
    // transient error, so only reads retry on those.
    return !isWrite && isTransientCode(error || {});
  }
  // Connection dropped / gateway error: a write may or may not have landed.
  if (isWrite) return false;
  if (kind === "network") return true;
  return status === 429 || status >= 500;
}

// Rate limits get longer waits than generic transient errors.
export function graphRetryDelayMs(attempt, { rateLimited } = {}) {
  const base = rateLimited ? 1500 : 500;
  return base * 2 ** attempt + Math.floor(Math.random() * 250);
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The exact text Facebook sent, never a generic replacement: message + its
// user-facing title/message + code/subcode + trace id for Meta support.
// Falls back to the raw error JSON when Facebook sent no message at all.
export function describeGraphError(error) {
  if (!error) return null;
  const parts = [error.message];
  if (error.error_user_title) parts.push(error.error_user_title);
  if (error.error_user_msg) parts.push(error.error_user_msg);
  if (!parts.some(Boolean)) parts.push(`Facebook returned an error with no message: ${JSON.stringify(error).slice(0, 300)}`);
  const meta = [];
  if (error.code != null) meta.push(`code ${error.code}`);
  if (error.error_subcode != null) meta.push(`subcode ${error.error_subcode}`);
  if (error.fbtrace_id) meta.push(`trace ${error.fbtrace_id}`);
  if (meta.length > 0) parts.push(`(${meta.join(", ")})`);
  return parts.filter(Boolean).join(" — ");
}

export function describeHttpFailure(status, bodyText) {
  const snippet = (bodyText || "").replace(/\s+/g, " ").trim().slice(0, 300);
  return `Facebook returned HTTP ${status}${snippet ? `: ${snippet}` : ""}`;
}
