import { logApiCall } from "./apiLogger";

const GRAPH_API_VERSION = "v21.0";
const BASE_URL = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

function redactToken(url) {
  return url.replace(/access_token=[^&]+/, "access_token=[REDACTED]");
}

export async function graphGet(path, accessToken, params = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      search.set(key, typeof value === "object" ? JSON.stringify(value) : String(value));
    }
  }
  search.set("access_token", accessToken);

  const url = `${BASE_URL}${path}?${search.toString()}`;
  const redactedUrl = redactToken(url);
  const start = Date.now();

  let status = null;
  let json = null;
  let errorMessage = null;

  try {
    const res = await fetch(url);
    status = res.status;
    json = await res.json();
    if (json?.error) {
      errorMessage = json.error.message;
    }
  } catch (err) {
    errorMessage = err.message;
  }

  logApiCall({
    method: "GET",
    path,
    url: redactedUrl,
    status,
    durationMs: Date.now() - start,
    error: errorMessage,
    responsePreview: json ? JSON.stringify(json).slice(0, 2000) : null,
  });

  if (errorMessage) {
    const err = new Error(errorMessage);
    err.graphResponse = json;
    throw err;
  }

  return json;
}

const ASYNC_POLL_INTERVAL_MS = 1000;
const ASYNC_POLL_TIMEOUT_MS = 15000;

// Wraps graphGet for /insights-style endpoints. Facebook sometimes decides a
// given insights query is too expensive to run synchronously — based on its
// own cost estimate (data volume, date range, breakdown cardinality — not
// reliably predictable from the request alone, and not limited to requests
// with a `breakdowns` param) — and returns `{ report_run_id }` instead of
// `{ data: [...] }`. A naive caller would read `.data` as undefined and
// silently treat that as "no data for this query", which is exactly what
// happened here: region/age-gender breakdowns (and even a plain spend-only
// query) came back async for a large account, got read as empty, and the
// report showed "no breakdown data" despite the account having plenty.
// This polls the job until it completes (or fails/times out) and fetches
// its results instead.
export async function graphGetInsights(path, accessToken, params = {}) {
  const json = await graphGet(path, accessToken, params);
  if (!json?.report_run_id) return json;

  const jobId = json.report_run_id;
  const deadline = Date.now() + ASYNC_POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, ASYNC_POLL_INTERVAL_MS));
    const status = await graphGet(`/${jobId}`, accessToken, {});
    if (status.async_status === "Job Completed") {
      return graphGet(`/${jobId}/insights`, accessToken, { limit: params.limit || 500 });
    }
    if (status.async_status === "Job Failed" || status.async_status === "Job Skipped") {
      throw new Error(`Facebook insights job ${status.async_status.toLowerCase()}`);
    }
  }
  throw new Error("Facebook insights job timed out waiting for results");
}
