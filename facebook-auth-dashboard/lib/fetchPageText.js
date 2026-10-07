const FETCH_TIMEOUT_MS = 8000;
const MAX_BYTES = 500_000; // stop reading a huge page well before it matters
const MAX_TEXT_LENGTH = 3000; // keeps the AI prompt a sane size

// A plain chat/completions call can't browse the web itself — for the
// brand-URL fallback (accounts with no usable landing-page history), this
// does the one HTTP fetch server-side and extracts readable text so the AI
// has something concrete to reason about instead of just a bare domain.
export async function fetchPageText(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Invalid URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("URL must be http:// or https://");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(parsed.toString(), {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; FacebookAdsDashboardBot/1.0)" },
    });
    if (!res.ok) throw new Error(`Fetch failed with status ${res.status}`);

    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("text/html")) {
      throw new Error(`Unexpected content type: ${contentType || "unknown"}`);
    }

    const reader = res.body?.getReader();
    let html = "";
    if (reader) {
      const decoder = new TextDecoder();
      let bytesRead = 0;
      while (bytesRead < MAX_BYTES) {
        const { done, value } = await reader.read();
        if (done) break;
        bytesRead += value.length;
        html += decoder.decode(value, { stream: true });
      }
      reader.cancel().catch(() => {});
    } else {
      html = await res.text();
    }

    return extractReadableText(html);
  } finally {
    clearTimeout(timeout);
  }
}

function extractReadableText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TEXT_LENGTH);
}
