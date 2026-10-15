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
