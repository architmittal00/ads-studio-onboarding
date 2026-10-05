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
