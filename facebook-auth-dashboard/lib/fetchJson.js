// A plain `res.json()` throws an opaque "Unexpected token 'A', "An error
// o"... is not valid JSON" the instant a response isn't actually JSON — most
// commonly Vercel's own HTML/plain-text error page for a serverless function
// that timed out or crashed outright (e.g. FUNCTION_INVOCATION_TIMEOUT),
// never this app's own `{error: "..."}` shape. That raw parse error then
// gets shown to the user verbatim wherever a caller does
// `.catch((err) => setError(err.message))`, reading as a cryptic crash
// instead of "the request timed out." Reading the body as text first and
// parsing it ourselves turns that into a real, readable message.
export async function parseJsonResponse(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    if (res.ok) throw new Error("Server returned an invalid response");
    throw new Error(`Request failed (${res.status}): ${text.slice(0, 200) || res.statusText}`);
  }
}

// Parse an /api/* response and throw when it failed, always with the real
// reason: the server's own `error` text (which for Facebook failures is
// Facebook's exact message), else the HTTP status plus whatever body came
// back. Replaces the `await res.json()` + `json.error || "Request failed"`
// pattern, which threw a cryptic JSON parse error on a non-JSON failure page
// and a bare "Request failed" when the body had no `error`.
export async function readApiResponse(res) {
  const json = await parseJsonResponse(res);
  if (!res.ok) {
    const detail = json?.error ?? (json && Object.keys(json).length ? JSON.stringify(json).slice(0, 300) : res.statusText);
    throw new Error(typeof detail === "string" && detail ? detail : `Request failed (${res.status})`);
  }
  return json;
}

// The Error for a failed (non-ok) response whose body hasn't been read yet —
// the server's own `error` text (Facebook's exact message for Graph failures),
// else the HTTP status plus the start of whatever came back.
export async function responseError(res) {
  const text = await res.text().catch(() => "");
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // not JSON (e.g. a gateway/timeout page) — fall through to the snippet
  }
  if (json?.error) return new Error(typeof json.error === "string" ? json.error : JSON.stringify(json.error).slice(0, 300));
  const snippet = text.replace(/\s+/g, " ").trim().slice(0, 200);
  return new Error(`Request failed (${res.status})${snippet ? `: ${snippet}` : res.statusText ? `: ${res.statusText}` : ""}`);
}

// Delay before client retry n (0-based): 0.7s, 1.5s, 3s.
const CLIENT_RETRY_DELAYS_MS = [700, 1500, 3000];
const RETRYABLE_STATUSES = new Set([502, 503]);

// Plain `fetch` has no upper bound of its own — if the connection stalls
// (the server hangs, or a network layer in between just stops sending
// anything back) the returned promise can sit forever, which is exactly what
// a spinner driven by it looks like to a user: "loading" with no end. This
// wraps `fetch` with an AbortController so that case fails over to a real
// rejection instead, same as a normal network error a caller's own `.catch`
// already handles. `timeoutMs` defaults comfortably above every relevant
// endpoint's own `maxDuration` in vercel.json, so the server's own timeout
// (which returns a real, if unhappy, response) fires first in the ordinary
// slow case — this is a backstop for the connection never responding at all.
//
// Also retries (up to `retries` more times, 3 by default) the failures that
// succeed a moment later — a dropped connection or a 502/503 from the edge —
// but only for requests that are safe to repeat: GETs by default, anything
// else only when the caller passes `{ idempotent: true }` (e.g. read-only
// POSTs). A timeout (abort) is never retried: it already waited the full
// window and the server was still working.
export async function fetchWithTimeout(url, options = {}, timeoutMs = 65000) {
  const { retries = 3, idempotent, ...fetchOptions } = options;
  const method = (fetchOptions.method || "GET").toUpperCase();
  const canRetry = idempotent ?? method === "GET";
  for (let attempt = 0; ; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...fetchOptions, signal: controller.signal });
      if (canRetry && attempt < retries && RETRYABLE_STATUSES.has(res.status)) {
        await new Promise((r) => setTimeout(r, CLIENT_RETRY_DELAYS_MS[Math.min(attempt, 2)]));
        continue;
      }
      return res;
    } catch (err) {
      if (canRetry && attempt < retries && err?.name !== "AbortError") {
        await new Promise((r) => setTimeout(r, CLIENT_RETRY_DELAYS_MS[Math.min(attempt, 2)]));
        continue;
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}
