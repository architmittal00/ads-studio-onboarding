import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { graphGet } from "@/lib/facebookGraph";

// AI-written ad copy via OpenRouter — ported from sr-ads-launch's
// src/lib/ai-copy.ts, trimmed to the IMAGE path only (video ads, and the
// browser-made low-resolution video copy it fed the AI, are a later phase —
// see components/catalogads/StandardAdFields.js). Everything here (the
// SSRF-safe landing-page fetch, the risky-claim checks, the JSON parsing)
// is kept verbatim since none of it is video-specific.

const COPY_LIMITS = { primary: 600, headline: 40, description: 250 };

function baseUrl() {
  return (process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1").replace(/\/$/, "");
}
function model() {
  return process.env.OPENROUTER_MODEL || "qwen/qwen3.7-flash";
}

export function aiStatus() {
  return { enabled: !!process.env.OPENROUTER_API_KEY, model: model() };
}

/* ── Reading the landing page, without letting anyone point this server at its own network ── */

export function isPrivateAddress(ip) {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  if (v === 6) {
    const x = ip.toLowerCase();
    if (x === "::" || x === "::1") return true;
    if (x.startsWith("::ffff:")) {
      const rest = x.slice(7);
      if (rest.includes(".")) return isPrivateAddress(rest);
      const [hi, lo] = rest.split(":").map((h) => parseInt(h, 16));
      return isPrivateAddress(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
    }
    return /^f[cd]/.test(x) || /^fe[89ab]/.test(x);
  }
  return true;
}

async function assertPublicUrl(raw) {
  const u = new URL(raw);
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("Only web links are allowed");
  if (u.port && u.port !== "80" && u.port !== "443") throw new Error("Unusual port");
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new Error("Not a public address");
  }
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address))) throw new Error("Not a public address");
  return u;
}

const entity = (s) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ");
const clean = (s, n) => entity(s || "").replace(/\s+/g, " ").trim().slice(0, n);

// Title and description of the landing page. Best effort: any problem just means no extra context.
export async function pageContext(link) {
  if (!link) return null;
  try {
    let url = await assertPublicUrl(/^https?:\/\//i.test(link) ? link : `https://${link}`);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    try {
      for (let hop = 0; hop < 4; hop++) {
        const res = await fetch(url, {
          redirect: "manual",
          signal: ctrl.signal,
          headers: { "User-Agent": "Mozilla/5.0 (compatible; AdsLauncherBot/1.0)", Accept: "text/html" },
        });
        if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
          url = await assertPublicUrl(new URL(res.headers.get("location"), url).toString());
          continue;
        }
        if (!res.ok || !/html/i.test(res.headers.get("content-type") || "")) return null;
        const reader = res.body?.getReader();
        if (!reader) return null;
        let html = "";
        let total = 0;
        const dec = new TextDecoder();
        while (total < 300_000) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.length;
          html += dec.decode(value, { stream: true });
        }
        reader.cancel().catch(() => undefined);
        const tags = Array.from(html.matchAll(/<meta\s[^>]*>/gi)).map((m) => m[0]);
        const attr = (tag, name) => tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i"))?.[1];
        const metaContent = (key) => {
          for (const t of tags) if ((attr(t, "name") || attr(t, "property") || "").toLowerCase() === key) return attr(t, "content");
          return undefined;
        };
        const title = clean(metaContent("og:title") || html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1], 200);
        const description = clean(metaContent("description") || metaContent("og:description"), 400);
        return title || description ? { title, description } : null;
      }
      return null;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null;
  }
}

/* ── What the AI is told ── */

const LANGUAGE = {
  EN: "English",
  HINGLISH: "Hinglish: Hindi written in English letters, the way people text each other in India",
  HI: "Hindi in Devanagari script",
};

// The team's own prompt, word for word, trimmed of its video-creative framing.
const SYSTEM = `You are an expert performance marketing copywriter specializing in Meta (Facebook & Instagram) ads.
You will be given:

1. A creative asset (image) — analyze the visual content, identify the product, its category, visual style, and tone.


Using the input, generate ad copy that is:

* Relevant to the product shown in the creative
* Aligned with the landing page content and offer
* Optimized for Meta ad performance
* Concise, compelling, and action-driven

Generate the following fields:

* Primary Text: 1-3 sentences. Hook the audience, highlight the key benefit or offer.
* Headline: Max 40 characters. Short, punchy, benefit-driven.
* Description: 1-2 sentences. Supporting context or secondary benefit.

Return only the three fields, as JSON in exactly this form: {"primary_text": "", "headline": "", "description": ""}. No explanations.`;

function userText(req, page) {
  const host = (() => {
    try {
      return new URL(/^https?:\/\//i.test(req.link) ? req.link : `https://${req.link}`).hostname;
    } catch {
      return "";
    }
  })();
  const lines = [
    "Creative: the attached image.",
    `Language: ${LANGUAGE[req.language] || LANGUAGE.EN}`,
    `Brand (Facebook Page): ${req.pageName || "not given"}`,
    `Website: ${host || "not given"}`,
    page?.title ? `Landing page title: ${page.title}` : "",
    page?.description ? `Landing page description: ${page.description}` : "",
    `Call-to-action button: ${req.cta || "Shop now"}`,
    `Offer: ${req.offer.trim() || "none given (do not invent one)"}`,
  ];
  const d = req.draft;
  if (d.message.trim() || d.headline.trim()) {
    lines.push(
      `Already written (improve on it, keep what is good): primary text "${d.message.trim()}", headline "${d.headline.trim()}", description "${d.description.trim()}"`
    );
  }
  return lines.filter(Boolean).join("\n");
}

/* ── Checking what comes back ── */

function clamp(s, n, keepBreaks) {
  let t = typeof s === "string" ? s : "";
  t = keepBreaks ? t.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim() : t.replace(/\s+/g, " ").trim();
  if (t.length <= n) return t;
  const cut = t.slice(0, n);
  const space = cut.lastIndexOf(" ");
  return (space > n * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:\-–]+$/, "");
}

const RISKY = [
  [/\b(cure[sd]?|curing|heals?|healing|treat(?:s|ed|ment)?|remed(?:y|ies)|diagnos\w*)\b/i, "sounds like a medical claim"],
  [/\b(guarantee[ds]?|100\s?%|permanent(?:ly)?|miracle|overnight|instant(?:ly)?)\b/i, "promises an absolute or guaranteed result"],
  [/\b(clinically\s+(?:proven|tested)|(?:dermatologist|doctor)s?[\s-]+(?:approved|recommended|tested))\b/i, "claims proof the creative may not show"],
  [/\b(no\s+side[\s-]?effects?|chemical[\s-]?free)\b/i, "makes a safety claim"],
  [/\b(?:in|within|just|only)\s+\d+\s+(?:days?|weeks?|hours?|din|hafte?)\b/i, "promises a timeline"],
  [/\b(?:your|aapki|aapke|aapka)\s+(?:acne|pimples?|hair\s?fall|dandruff|wrinkles|weight|skin\s+problems?|bal)\b/i, "speaks to the viewer's personal condition"],
  [/\b(?:are you|do you|kya aap)\b[^.?!\n]{0,40}\b(?:suffer\w*|struggl\w*|tired of|worried|pareshan)\b/i, "speaks to the viewer's personal condition"],
];
const OFFERISH = /\b\d+\s?%\s*(?:off|discount)|\bflat\s+\d+|(?:₹|rs\.?)\s?\d+|\bfree\s+(?:shipping|delivery)|\bbuy\s+\d+\s+get\b|\b(?:bogo|sale)\b/i;

function warningsFor(o, offerGiven) {
  const text = `${o.primary_text}\n${o.headline}\n${o.description}`;
  const out = [];
  for (const [re, why] of RISKY) {
    const m = text.match(re);
    if (m && !out.some((w) => w.endsWith(why))) out.push(`"${m[0].trim()}" ${why}. Meta and ASCI often reject this.`);
  }
  const m = !offerGiven && text.match(OFFERISH);
  if (m) out.push(`"${m[0].trim()}" is an offer or price you didn't give. Check it is true before using it.`);
  return out;
}

export function parseCopy(raw, offerGiven) {
  const s = (raw || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  const a = s.indexOf("{");
  const b = s.lastIndexOf("}");
  if (a < 0 || b < a) throw new Error("no JSON");
  const json = JSON.parse(s.slice(a, b + 1));
  const o = Array.isArray(json?.options) ? json.options[0] : json;
  const base = {
    primary_text: clamp(o?.primary_text ?? o?.primaryText ?? o?.["Primary Text"], COPY_LIMITS.primary, true),
    headline: clamp(o?.headline ?? o?.Headline, COPY_LIMITS.headline, false),
    description: clamp(o?.description ?? o?.Description, COPY_LIMITS.description, false),
  };
  if (!base.primary_text || !base.headline) throw new Error("missing fields");
  return { ...base, warnings: warningsFor(base, offerGiven) };
}

/* ── The call ── */

class Upstream extends Error {
  constructor(message, status, timedOut = false) {
    super(message);
    this.status = status;
    this.timedOut = timedOut;
  }
}

async function ask(content, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  let res;
  try {
    res = await fetch(`${baseUrl()}/chat/completions`, {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "HTTP-Referer": process.env.NEXTAUTH_URL || "http://localhost",
        "X-Title": "Catalog Ads",
      },
      body: JSON.stringify({
        model: model(),
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content },
        ],
        temperature: 0.8,
        max_tokens: 2000,
        response_format: { type: "json_object" },
        reasoning: { enabled: false },
        ...(process.env.OPENROUTER_DATA_COLLECTION === "deny" ? { provider: { data_collection: "deny" } } : {}),
      }),
    });
  } catch (e) {
    if (e.name === "AbortError") throw new Upstream("The AI took too long to answer.", 504, true);
    throw new Upstream(`Couldn't reach the AI service: ${e.message}`, 502);
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  if (!res.ok || json?.error) {
    const status = res.ok ? Number(json?.error?.code) || 502 : res.status;
    throw new Upstream(json?.error?.message || `The AI service returned ${res.status}`, status);
  }
  const out = json?.choices?.[0]?.message?.content;
  const textOut = typeof out === "string" ? out : Array.isArray(out) ? out.map((p) => p?.text || "").join("") : "";
  if (!textOut.trim()) throw new Upstream("The AI returned nothing. Try again.", 502);
  return textOut;
}

function failure(e) {
  if (e instanceof Upstream) {
    if (e.status === 401 || e.status === 403) {
      const err = new Error("The AI service rejected the key. Check OPENROUTER_API_KEY on the server.");
      err.status = 502;
      throw err;
    }
    if (e.status === 402) {
      const err = new Error("The AI service account is out of credits.");
      err.status = 402;
      throw err;
    }
    if (e.status === 429) {
      const err = new Error("The AI service is busy right now. Try again in a moment.");
      err.status = 429;
      throw err;
    }
    const err = new Error(e.message);
    err.status = e.timedOut ? 504 : 502;
    throw err;
  }
  throw e;
}

export async function generateCopy(req, token) {
  if (!process.env.OPENROUTER_API_KEY) {
    const err = new Error("AI writing isn't set up on this server. Add OPENROUTER_API_KEY.");
    err.status = 503;
    throw err;
  }
  const input = {
    accountId: String(req.accountId || ""),
    imageHash: String(req.imageHash || ""),
    pageName: String(req.pageName || "").slice(0, 120),
    link: String(req.link || "").slice(0, 500),
    cta: String(req.cta || "").slice(0, 40),
    offer: String(req.offer || "").slice(0, 300),
    language: ["EN", "HINGLISH", "HI"].includes(req.language) ? req.language : "EN",
    draft: {
      message: String(req.draft?.message || "").slice(0, 600),
      headline: String(req.draft?.headline || "").slice(0, 100),
      description: String(req.draft?.description || "").slice(0, 100),
    },
  };
  if (!/^(act_)?\d+$/.test(input.accountId)) {
    const err = new Error("Invalid ad account.");
    err.status = 400;
    throw err;
  }
  if (!input.imageHash || !/^[a-f0-9]{16,64}$/i.test(input.imageHash)) {
    const err = new Error("Invalid image.");
    err.status = 400;
    throw err;
  }
  const act = input.accountId.startsWith("act_") ? input.accountId : `act_${input.accountId}`;
  const started = Date.now();
  const left = () => 55_000 - (Date.now() - started);

  const imageUrl = async () => {
    try {
      const r = await graphGet(`/${act}/adimages`, token, { hashes: [input.imageHash], fields: "url" });
      return r.data?.[0]?.url || "";
    } catch {
      return "";
    }
  };
  const [page, image] = await Promise.all([pageContext(input.link), imageUrl()]);
  const offerGiven = !!input.offer.trim();

  try {
    if (!image) {
      const err = new Error("Couldn't find this image on Meta. Upload it again.");
      err.status = 400;
      throw err;
    }
    const text = await ask([{ type: "text", text: userText(input, page) }, { type: "image_url", image_url: { url: image } }], left());
    try {
      return { copy: parseCopy(text, offerGiven), saw: "IMAGE", model: model() };
    } catch {
      const err = new Error("The AI's answer couldn't be read. Try again.");
      err.status = 502;
      throw err;
    }
  } catch (e) {
    return failure(e);
  }
}
