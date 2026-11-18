import { logApiCall } from "./apiLogger";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
// Env-overridable rather than hardcoded — OpenRouter's model slugs change
// over time (e.g. a newer "Gemini 3.8 Flash" already existed as of Sept
// 2026), and this should be bumpable without a code change. Verify the
// current slug against https://openrouter.ai/models before relying on it.
const DEFAULT_MODEL = process.env.OPENROUTER_MODEL || "google/gemini-2.5-flash";

const MAX_AI_SUGGESTIONS_PROCESSED = 80;
const MIN_USABLE_SUGGESTIONS = 20;

const SYSTEM_PROMPT =
  'You are a Meta Ads targeting strategist. Output ONLY JSON in this exact shape: {"interests": ["...", ...]} — ' +
  "at least 50 distinct, short (5 words or fewer) plain-language interest/category names suitable for typing " +
  "directly into Meta Ads Manager's Detailed Targeting > Interests search box. Include both broad categories and " +
  "narrower/adjacent ones (ingredients, related brands or creators, complementary categories, buyer lifestyle " +
  "interests). Avoid near-duplicates of each other. No prose, no markdown, no numbering — JSON only.";

function tryParseJson(str) {
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

// Defensive parsing: models don't always honor `response_format` exactly —
// handles a markdown-fenced response, a bare array instead of {interests:[]},
// and trims/dedupes/caps the result regardless of how the model formatted it.
export function parseSuggestions(content) {
  const warnings = [];
  let parsed = tryParseJson(content);
  if (!parsed) {
    const match = content.match(/\{[\s\S]*\}/);
    if (match) parsed = tryParseJson(match[0]);
  }

  let rawList = null;
  if (Array.isArray(parsed)) rawList = parsed;
  else if (parsed && Array.isArray(parsed.interests)) rawList = parsed.interests;

  if (!rawList) {
    return { suggestions: [], warnings: ["Could not parse the AI response as JSON"] };
  }

  const seen = new Set();
  const suggestions = [];
  for (const item of rawList) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (!trimmed || trimmed.length > 60) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    suggestions.push(trimmed);
    if (suggestions.length >= MAX_AI_SUGGESTIONS_PROCESSED) break;
  }

  if (suggestions.length < MIN_USABLE_SUGGESTIONS) {
    warnings.push(`AI returned only ${suggestions.length} usable suggestion(s) (expected 50+) — proceeding anyway`);
  }

  return { suggestions, warnings };
}

// Calls OpenRouter's OpenAI-compatible chat/completions endpoint with a
// Gemini model to turn brand signal (top landing pages, or brand-URL text)
// into candidate Meta interest/category names. Logged through the same
// ring buffer as every Graph API call for /logs consistency — the key lives
// in the Authorization header, not the URL, so unlike Facebook's token
// (query-string, needs redaction) the logged `url` here is inherently
// secret-free; never pass raw headers/init into logApiCall.
export async function getInterestSuggestions({ promptContext }) {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY is not configured");
  }

  const start = Date.now();
  let status = null;
  let json = null;
  let errorMessage = null;

  try {
    const res = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: promptContext },
        ],
        temperature: 0.7,
        max_tokens: 2000,
        response_format: { type: "json_object" },
      }),
    });
    status = res.status;
    json = await res.json();
    if (json?.error) errorMessage = json.error.message || JSON.stringify(json.error);
  } catch (err) {
    errorMessage = err.message;
  }

  logApiCall({
    method: "POST",
    path: "openrouter:chat/completions",
    url: OPENROUTER_URL,
    status,
    durationMs: Date.now() - start,
    error: errorMessage,
    responsePreview: json ? JSON.stringify(json).slice(0, 2000) : null,
  });

  if (errorMessage) {
    throw new Error(`OpenRouter request failed: ${errorMessage}`);
  }

  const content = json?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("OpenRouter returned no content");
  }

  const { suggestions, warnings } = parseSuggestions(content);
  if (suggestions.length === 0) {
    throw new Error("AI did not return usable suggestions — try again");
  }

  return { suggestions, raw: content, warnings };
}

// A single JSON-returning chat call (used by the custom-rules translator). Temperature 0 by default so the same sentence
// gives the same answer. Logged like every other call; the key only ever sits in the Authorization header.
export async function chatJson({ system, user, model = DEFAULT_MODEL, temperature = 0, maxTokens = 1500, label = "chat", retries = 0 }) {
  if (!process.env.OPENROUTER_API_KEY) throw openRouterError("not_configured", "OPENROUTER_API_KEY is not configured");
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 800));
    try {
      return await chatJsonOnce({ system, user, model, temperature, maxTokens, label });
    } catch (err) {
      lastErr = err;
      // Only a hiccup is worth another go: a timeout, a rate limit, a server error or an empty answer.
      if (!["timeout", "busy", "upstream", "empty"].includes(err.kind)) break;
    }
  }
  throw lastErr;
}

// Errors carry a `kind` so the caller can tell the person what actually went wrong without leaking provider detail.
function openRouterError(kind, message) {
  const err = new Error(message);
  err.kind = kind;
  return err;
}

function kindOf(status, message) {
  const text = String(message || "");
  if (/abort|timeout|timed out/i.test(text)) return "timeout";
  if (status === 401 || status === 403 || /invalid.*key|no auth|unauthorized/i.test(text)) return "auth";
  if (status === 402 || /credit|insufficient|billing|quota/i.test(text)) return "credits";
  if (status === 429 || /rate.?limit|too many/i.test(text)) return "busy";
  if (status === 404 || /no endpoints|not a valid model|model.*not found/i.test(text)) return "model";
  if (status >= 500 || /provider returned error|overloaded|unavailable/i.test(text)) return "upstream";
  return "other";
}

async function chatJsonOnce({ system, user, model, temperature, maxTokens, label }) {
  const start = Date.now();
  let status = null;
  let json = null;
  let errorMessage = null;
  try {
    const res = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature,
        max_tokens: maxTokens,
        response_format: { type: "json_object" },
      }),
      signal: AbortSignal.timeout(45000),
    });
    status = res.status;
    json = await res.json();
    if (json?.error) errorMessage = json.error.message || JSON.stringify(json.error);
    else if (!res.ok) errorMessage = `HTTP ${res.status}`;
  } catch (err) {
    errorMessage = err.message;
  }
  logApiCall({
    method: "POST",
    path: `openrouter:${label}`,
    url: OPENROUTER_URL,
    status,
    durationMs: Date.now() - start,
    error: errorMessage,
    responsePreview: json ? JSON.stringify(json).slice(0, 1000) : null,
  });
  if (errorMessage) throw openRouterError(kindOf(status, errorMessage), `OpenRouter request failed: ${errorMessage}`);
  const content = json?.choices?.[0]?.message?.content;
  if (!content) throw openRouterError("empty", `OpenRouter returned no content (finish: ${json?.choices?.[0]?.finish_reason || "unknown"})`);
  return { content, model: json.model || model };
}

export const RULES_MODEL = process.env.OPENROUTER_RULES_MODEL || DEFAULT_MODEL;
