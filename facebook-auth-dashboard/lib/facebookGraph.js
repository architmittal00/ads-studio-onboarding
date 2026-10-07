import { logApiCall } from "./apiLogger";

// v23.0: the minimum version carrying the unified Advantage+ automation-lever
// fields (targeting_automation.advantage_audience, etc.) used by the
// campaign-launch write calls — Meta retired the old smart_promotion_type
// flag these replace (campaign creation on it blocked from v24.0, fully
// removed in v25.0). Bumping this affects every existing read call too, not
// just the new write ones — see the Strategy "launch" feature's rollout notes.
const GRAPH_API_VERSION = "v23.0";
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

// Write counterpart to graphGet — used by the campaign-launch flow to create
// campaigns, ad sets, and audiences. Same logging/error shape so launch
// failures show up in /logs exactly like a failed read would. Params go in
// the POST body (form-encoded), not the query string.
export async function graphPost(path, accessToken, params = {}) {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      body.set(key, typeof value === "object" ? JSON.stringify(value) : String(value));
    }
  }
  body.set("access_token", accessToken);

  const url = `${BASE_URL}${path}`;
  const redactedUrl = redactToken(`${url}?${body.toString()}`);
  const start = Date.now();

  let status = null;
  let json = null;
  let errorMessage = null;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    status = res.status;
    json = await res.json();
    if (json?.error) {
      errorMessage = json.error.message;
    }
  } catch (err) {
    errorMessage = err.message;
  }

  logApiCall({
    method: "POST",
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

// Fetches one additional page from a `paging.next` URL — already a complete,
// signed URL (includes access_token and every query param from the original
// request), so this talks to `fetch` directly rather than going through
// graphGet's path/params builder. Logged the same way as any other call so a
// paginated fetch shows up in /logs like every other request.
async function fetchPageByUrl(nextUrl, path) {
  const redactedUrl = redactToken(nextUrl);
  const start = Date.now();

  let status = null;
  let json = null;
  let errorMessage = null;

  try {
    const res = await fetch(nextUrl);
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
    path: `${path} (next page)`,
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

// Safety cap on how many pages a single list/insights query will follow
// before giving up and returning what it has. At a 500-row page size that's
// 25,000 rows — comfortably past any real ad account's ad/campaign count —
// so this only ever kicks in to stop a runaway loop (e.g. a malformed cursor
// Facebook keeps re-issuing), not as a real limit on legitimate accounts.
const MAX_PAGES = 50;

// Follows `paging.next` until the list is exhausted (or MAX_PAGES is hit),
// concatenating `data` across every page. Facebook's list/insights endpoints
// default to a few hundred rows per page and say nothing on their own about
// how many more exist — a caller that reads just `.data` from the first
// response silently gets a truncated result for any account with more rows
// than one page holds. This is the fix for that, applied once here instead
// of at every call site.
async function collectAllPages(firstPageJson, path) {
  let page = firstPageJson;
  const allData = [...(page?.data || [])];
  let pages = 1;
  while (page?.paging?.next && pages < MAX_PAGES) {
    page = await fetchPageByUrl(page.paging.next, path);
    allData.push(...(page?.data || []));
    pages += 1;
  }
  return { ...page, data: allData };
}

// Like graphGet, but follows pagination to completion — use for any
// list-shaped connection (campaigns, ad sets, custom audiences, ad accounts,
// Pages, …) where returning only the first page would silently under-report
// for any account bigger than one page.
export async function graphGetAllPages(path, accessToken, params = {}) {
  const firstPage = await graphGet(path, accessToken, params);
  return collectAllPages(firstPage, path);
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
//
// Either path (sync or async) only ever hands back one page on its own —
// an insights query with many rows (e.g. level:"ad" on an account with
// hundreds of active ads) spans multiple pages just like any other list
// endpoint, so both branches run through collectAllPages() before
// returning, same as graphGetAllPages() does for plain list connections.
export async function graphGetInsights(path, accessToken, params = {}) {
  const json = await graphGet(path, accessToken, params);
  if (!json?.report_run_id) return collectAllPages(json, path);

  const jobId = json.report_run_id;
  const deadline = Date.now() + ASYNC_POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, ASYNC_POLL_INTERVAL_MS));
    const status = await graphGet(`/${jobId}`, accessToken, {});
    if (status.async_status === "Job Completed") {
      const firstPage = await graphGet(`/${jobId}/insights`, accessToken, { limit: params.limit || 500 });
      return collectAllPages(firstPage, `/${jobId}/insights`);
    }
    if (status.async_status === "Job Failed" || status.async_status === "Job Skipped") {
      throw new Error(`Facebook insights job ${status.async_status.toLowerCase()}`);
    }
  }
  throw new Error("Facebook insights job timed out waiting for results");
}
