import { createHmac } from "crypto";
import { logApiCall } from "./apiLogger";
import { MAX_GRAPH_RETRIES, shouldRetryGraph, graphRetryDelayMs, sleep, describeGraphError, describeHttpFailure } from "./graphRetry";

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

// Added for Catalog Ads (lib/catalogAds/): every call sr-ads-launch made to
// Graph included this, and the business-owned-catalog edges it needs
// (owned_product_catalogs, client_product_catalogs) are exactly the kind of
// business-scoped call Meta's "Require App Secret Proof" setting is meant to
// guard. Every existing call in this file has worked fine without it so far,
// so this is additive — sent whenever FACEBOOK_APP_SECRET is configured
// (always, in this app) rather than gated to only the new catalog calls, to
// keep one request-building code path instead of two.
function appSecretProof(accessToken) {
  const secret = process.env.FACEBOOK_APP_SECRET;
  if (!secret) return null;
  return createHmac("sha256", secret).update(accessToken).digest("hex");
}

// One Graph request with up to MAX_GRAPH_RETRIES retries (see lib/graphRetry.js
// for exactly which failures qualify). Every attempt is logged to /logs.
// On final failure the thrown Error carries Facebook's exact message
// (`describeGraphError`), the raw response (`graphResponse`) and how many
// attempts were made.
async function graphRequest({ method, path, url, redactedUrl, init, isWrite }) {
  let lastErr;
  for (let attempt = 0; attempt <= MAX_GRAPH_RETRIES; attempt++) {
    const start = Date.now();
    let status = null;
    let json = null;
    let errorMessage = null;
    let kind = null; // "network" | "http" | "graph"
    let fbError = null;

    try {
      const res = await fetch(url, init);
      status = res.status;
      const text = await res.text();
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
      if (json?.error) {
        kind = "graph";
        fbError = json.error;
        errorMessage = describeGraphError(json.error);
      } else if (json === null || !res.ok) {
        kind = "http";
        errorMessage = describeHttpFailure(status, text);
      }
    } catch (err) {
      kind = "network";
      errorMessage = `Couldn't reach Facebook: ${err.message}`;
    }

    logApiCall({
      method,
      path: attempt > 0 ? `${path} (retry ${attempt})` : path,
      url: redactedUrl,
      status,
      durationMs: Date.now() - start,
      error: errorMessage,
      responsePreview: json ? JSON.stringify(json).slice(0, 2000) : null,
    });

    if (!errorMessage) return json;

    lastErr = new Error(attempt > 0 ? `${errorMessage} [failed after ${attempt + 1} attempts]` : errorMessage);
    lastErr.graphResponse = json;
    lastErr.attempts = attempt + 1;
    if (attempt < MAX_GRAPH_RETRIES && shouldRetryGraph({ kind, status, error: fbError, isWrite })) {
      await sleep(graphRetryDelayMs(attempt, { rateLimited: kind === "graph" && fbError?.code != null && fbError.code !== 1 && fbError.code !== 2 }));
      continue;
    }
    throw lastErr;
  }
  throw lastErr;
}

export async function graphGet(path, accessToken, params = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      search.set(key, typeof value === "object" ? JSON.stringify(value) : String(value));
    }
  }
  search.set("access_token", accessToken);
  const proof = appSecretProof(accessToken);
  if (proof) search.set("appsecret_proof", proof);

  const url = `${BASE_URL}${path}?${search.toString()}`;
  return graphRequest({ method: "GET", path, url, redactedUrl: redactToken(url), init: undefined, isWrite: false });
}

// Write counterpart to graphGet — used by the campaign-launch flow to create
// campaigns, ad sets, and audiences. Same logging/error shape so launch
// failures show up in /logs exactly like a failed read would. Params go in
// the POST body (form-encoded), not the query string. Writes are retried only
// for rate-limit rejections (nothing was executed), never for ambiguous
// failures that might have been applied.
export async function graphPost(path, accessToken, params = {}) {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      body.set(key, typeof value === "object" ? JSON.stringify(value) : String(value));
    }
  }
  body.set("access_token", accessToken);
  const proof = appSecretProof(accessToken);
  if (proof) body.set("appsecret_proof", proof);

  const url = `${BASE_URL}${path}`;
  return graphRequest({
    method: "POST",
    path,
    url,
    redactedUrl: redactToken(`${url}?${body.toString()}`),
    init: { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body },
    isWrite: true,
  });
}

// Multipart POST with one binary field — added for Catalog Ads' video-chunk
// upload (lib/catalogAds/videoUpload.js), the first binary upload this app
// sends to Graph (image uploads go through graphPost's own base64 `bytes`
// param instead, Meta's own convention for /adimages). `file` is
// `{field, data, filename}` — `data` a Buffer/Blob, `filename` whatever Meta
// logs for it (not meaningful here beyond that).
export async function graphPostFile(path, accessToken, params = {}, file) {
  const form = new FormData();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      form.set(key, typeof value === "object" ? JSON.stringify(value) : String(value));
    }
  }
  form.set("access_token", accessToken);
  const proof = appSecretProof(accessToken);
  if (proof) form.set("appsecret_proof", proof);
  form.set(file.field, new Blob([file.data]), file.filename);

  const url = `${BASE_URL}${path}`;
  return graphRequest({
    method: "POST",
    path,
    url,
    redactedUrl: redactToken(`${url}?${new URLSearchParams({ ...params, [file.field]: `<${file.data.length} bytes>` }).toString()}`),
    init: { method: "POST", body: form },
    isWrite: true,
  });
}

// Fetches one additional page from a `paging.next` URL — already a complete,
// signed URL (includes access_token and every query param from the original
// request), so this skips graphGet's path/params builder. Logged and retried
// like any other call.
async function fetchPageByUrl(nextUrl, path) {
  return graphRequest({ method: "GET", path: `${path} (next page)`, url: nextUrl, redactedUrl: redactToken(nextUrl), init: undefined, isWrite: false });
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
// `timeoutMs` overrides the default 15s async-job poll window — plumbed
// through as a sibling param, never spread into `params` itself, since
// `params` travels verbatim onto Facebook's own query string. Defaults to
// `ASYNC_POLL_TIMEOUT_MS` for every existing caller (no behavior change);
// pages/api/fb/explore-insights.js is the one caller that raises it, for its
// heaviest shape (ad-level × a time-increment query — see that file's own
// comment on why that specific combination is the most likely to need it).
export async function graphGetInsights(path, accessToken, params = {}, { timeoutMs } = {}) {
  const json = await graphGet(path, accessToken, params);
  if (!json?.report_run_id) return collectAllPages(json, path);

  const jobId = json.report_run_id;
  const deadline = Date.now() + (timeoutMs ?? ASYNC_POLL_TIMEOUT_MS);
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
