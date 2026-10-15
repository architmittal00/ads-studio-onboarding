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
export async function fetchWithTimeout(url, options = {}, timeoutMs = 65000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
