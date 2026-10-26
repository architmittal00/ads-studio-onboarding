import 'server-only';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { type AiStatus, type CopyLanguage, type CopyOption, type CopyRequest, type CopyResult, COPY_LIMITS } from './ai-types';
import { graph, GraphError } from './graph';

/* eslint-disable @typescript-eslint/no-explicit-any */

/*
 * Writes ad text with a Qwen model through OpenRouter. Nothing here depends on where the app is hosted.
 * For a video the AI is shown, in this order: the small low-resolution copy the browser makes while the
 * original uploads (a few MB, no audio), then the video on Meta by link, then the video's cover image.
 *
 *   OPENROUTER_API_KEY            required; without it the feature stays hidden
 *   OPENROUTER_MODEL              default qwen/qwen3.7-flash (qwen/qwen3.8-omni-flash also hears the audio)
 *   OPENROUTER_BASE_URL           default https://openrouter.ai/api/v1 (any OpenAI-compatible gateway)
 *   OPENROUTER_DATA_COLLECTION    set to "deny" to route only to providers that don't store prompts
 *   AI_MAX_VIDEO_SECONDS          default 300 (longest video the link route will watch)
 *   AI_VIDEO_COPY                 "off" = don't use the browser's low-resolution copy (it has no audio)
 */

const baseUrl = () => (process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1').replace(/\/$/, '');
const model = () => process.env.OPENROUTER_MODEL || 'qwen/qwen3.7-flash';
const maxVideoSeconds = () => Number(process.env.AI_MAX_VIDEO_SECONDS) || 300;
const TOTAL_MS = 55_000; // hosts commonly cap a request at 60 s

const videoCopyOn = () => (process.env.AI_VIDEO_COPY || '').toLowerCase() !== 'off';

export function aiStatus(): AiStatus {
  return { enabled: !!process.env.OPENROUTER_API_KEY, model: model(), maxVideoSeconds: maxVideoSeconds(), videoCopy: videoCopyOn() };
}

/* ── Reading the landing page, without letting anyone point this server at its own network ── */

export function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  if (v === 6) {
    const x = ip.toLowerCase();
    if (x === '::' || x === '::1') return true;
    if (x.startsWith('::ffff:')) {
      const rest = x.slice(7);
      if (rest.includes('.')) return isPrivateAddress(rest);
      const [hi, lo] = rest.split(':').map((h) => parseInt(h, 16));
      return isPrivateAddress(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
    }
    return /^f[cd]/.test(x) || /^fe[89ab]/.test(x);
  }
  return true;
}

async function assertPublicUrl(raw: string): Promise<URL> {
  const u = new URL(raw);
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('Only web links are allowed');
  if (u.port && u.port !== '80' && u.port !== '443') throw new Error('Unusual port');
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) throw new Error('Not a public address');
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address))) throw new Error('Not a public address');
  return u;
}

const entity = (s: string) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ');
const clean = (s: string | undefined, n: number) => entity(s || '').replace(/\s+/g, ' ').trim().slice(0, n);

export interface PageContext { title: string; description: string }

/** Title and description of the landing page. Best effort: any problem just means no extra context. */
export async function pageContext(link: string): Promise<PageContext | null> {
  if (!link) return null;
  try {
    let url = await assertPublicUrl(/^https?:\/\//i.test(link) ? link : `https://${link}`);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    try {
      for (let hop = 0; hop < 4; hop++) {
        const res = await fetch(url, { redirect: 'manual', signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AdsLauncherBot/1.0)', Accept: 'text/html' } });
        if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
          url = await assertPublicUrl(new URL(res.headers.get('location')!, url).toString()); // every hop is checked again
          continue;
        }
        if (!res.ok || !/html/i.test(res.headers.get('content-type') || '')) return null;
        // Read at most 300 KB; the title and meta tags are at the top.
        const reader = res.body?.getReader();
        if (!reader) return null;
        let html = ''; let total = 0;
        const dec = new TextDecoder();
        while (total < 300_000) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.length; html += dec.decode(value, { stream: true });
        }
        reader.cancel().catch(() => undefined);
        // Meta tags in any attribute order.
        const tags = Array.from(html.matchAll(/<meta\s[^>]*>/gi)).map((m) => m[0]);
        const attr = (tag: string, name: string) => tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i'))?.[1];
        const metaContent = (key: string) => {
          for (const t of tags) if ((attr(t, 'name') || attr(t, 'property') || '').toLowerCase() === key) return attr(t, 'content');
          return undefined;
        };
        const title = clean(metaContent('og:title') || html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1], 200);
        const description = clean(metaContent('description') || metaContent('og:description'), 400);
        return title || description ? { title, description } : null;
      }
      return null;
    } finally { clearTimeout(timer); }
  } catch { return null; }
}

/* ── What the AI is told ── */

const LANGUAGE: Record<CopyLanguage, string> = {
  EN: 'English',
  HINGLISH: 'Hinglish: Hindi written in English letters, the way people text each other in India',
  HI: 'Hindi in Devanagari script',
};

// The team's own prompt, word for word. Only its last line is extended, to say the answer must be JSON so it can be read.
const SYSTEM = `You are an expert performance marketing copywriter specializing in Meta (Facebook & Instagram) ads.
You will be given:

1. A creative asset (image or video) — analyze the visual content, identify the product, its category, visual style, and tone.


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

function userText(req: CopyRequest, page: PageContext | null, seeing: 'video' | 'image'): string {
  const host = (() => { try { return new URL(/^https?:\/\//i.test(req.link) ? req.link : `https://${req.link}`).hostname; } catch { return ''; } })();
  const lines = [
    `Creative: the attached ${seeing}.`,
    `Language: ${LANGUAGE[req.language] || LANGUAGE.EN}`,
    `Brand (Facebook Page): ${req.pageName || 'not given'}`,
    `Website: ${host || 'not given'}`,
    page?.title ? `Landing page title: ${page.title}` : '',
    page?.description ? `Landing page description: ${page.description}` : '',
    `Call-to-action button: ${req.cta || 'Shop now'}`,
    `Offer: ${req.offer.trim() || 'none given (do not invent one)'}`,
  ];
  const d = req.draft;
  if (d.message.trim() || d.headline.trim()) {
    lines.push(`Already written (improve on it, keep what is good): primary text "${d.message.trim()}", headline "${d.headline.trim()}", description "${d.description.trim()}"`);
  }
  return lines.filter(Boolean).join('\n');
}

/* ── Checking what comes back ── */

function clamp(s: unknown, n: number, keepBreaks: boolean): string {
  let t = typeof s === 'string' ? s : '';
  t = keepBreaks ? t.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim() : t.replace(/\s+/g, ' ').trim();
  if (t.length <= n) return t;
  const cut = t.slice(0, n);
  const space = cut.lastIndexOf(' ');
  return (space > n * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:\-–]+$/, '');
}

const RISKY: [RegExp, string][] = [
  [/\b(cure[sd]?|curing|heals?|healing|treat(?:s|ed|ment)?|remed(?:y|ies)|diagnos\w*)\b/i, 'sounds like a medical claim'],
  [/\b(guarantee[ds]?|100\s?%|permanent(?:ly)?|miracle|overnight|instant(?:ly)?)\b/i, 'promises an absolute or guaranteed result'],
  [/\b(clinically\s+(?:proven|tested)|(?:dermatologist|doctor)s?[\s-]+(?:approved|recommended|tested))\b/i, 'claims proof the creative may not show'],
  [/\b(no\s+side[\s-]?effects?|chemical[\s-]?free)\b/i, 'makes a safety claim'],
  [/\b(?:in|within|just|only)\s+\d+\s+(?:days?|weeks?|hours?|din|hafte?)\b/i, 'promises a timeline'],
  [/\b(?:your|aapki|aapke|aapka)\s+(?:acne|pimples?|hair\s?fall|dandruff|wrinkles|weight|skin\s+problems?|bal)\b/i, 'speaks to the viewer’s personal condition'],
  [/\b(?:are you|do you|kya aap)\b[^.?!\n]{0,40}\b(?:suffer\w*|struggl\w*|tired of|worried|pareshan)\b/i, 'speaks to the viewer’s personal condition'],
];
const OFFERISH = /\b\d+\s?%\s*(?:off|discount)|\bflat\s+\d+|(?:₹|rs\.?)\s?\d+|\bfree\s+(?:shipping|delivery)|\bbuy\s+\d+\s+get\b|\b(?:bogo|sale)\b/i;

function warningsFor(o: { primary_text: string; headline: string; description: string }, offerGiven: boolean): string[] {
  const text = `${o.primary_text}\n${o.headline}\n${o.description}`;
  const out: string[] = [];
  for (const [re, why] of RISKY) {
    const m = text.match(re);
    if (m && !out.some((w) => w.endsWith(why))) out.push(`“${m[0].trim()}” ${why}. Meta and ASCI often reject this.`);
  }
  const m = !offerGiven && text.match(OFFERISH);
  if (m) out.push(`“${m[0].trim()}” is an offer or price you didn’t give. Check it is true before using it.`);
  return out;
}

/** The three fields from the model's answer (it is also fine if it wraps them in an "options" list). */
export function parseCopy(raw: string, offerGiven: boolean): CopyOption {
  let s = (raw || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  const a = s.indexOf('{'); const b = s.lastIndexOf('}');
  if (a < 0 || b < a) throw new Error('no JSON');
  const json = JSON.parse(s.slice(a, b + 1));
  const o = Array.isArray(json?.options) ? json.options[0] : json;
  const base = {
    primary_text: clamp(o?.primary_text ?? o?.primaryText ?? o?.['Primary Text'], COPY_LIMITS.primary, true),
    headline: clamp(o?.headline ?? o?.Headline, COPY_LIMITS.headline, false),
    description: clamp(o?.description ?? o?.Description, COPY_LIMITS.description, false),
  };
  if (!base.primary_text || !base.headline) throw new Error('missing fields');
  return { ...base, warnings: warningsFor(base, offerGiven) };
}

/* ── The call ── */

class Upstream extends Error {
  constructor(message: string, public status: number, public timedOut = false) { super(message); }
}

async function ask(content: any[], ms: number): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  let res: Response;
  try {
    res = await fetch(`${baseUrl()}/chat/completions`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'HTTP-Referer': process.env.APP_URL || 'http://localhost',
        'X-Title': 'Ads Launcher',
      },
      body: JSON.stringify({
        model: model(),
        messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content }],
        temperature: 0.8,
        max_tokens: 2000,
        response_format: { type: 'json_object' },
        // Plain copywriting doesn't need the model's long thinking mode: it only adds wait.
        reasoning: { enabled: false },
        ...(process.env.OPENROUTER_DATA_COLLECTION === 'deny' ? { provider: { data_collection: 'deny' } } : {}),
      }),
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new Upstream('The AI took too long to answer.', 504, true);
    throw new Upstream(`Couldn’t reach the AI service: ${(e as Error).message}`, 502);
  } finally { clearTimeout(timer); }

  const text = await res.text();
  let json: any; try { json = JSON.parse(text); } catch { json = null; }
  if (!res.ok || json?.error) {
    const status = res.ok ? Number(json?.error?.code) || 502 : res.status;
    throw new Upstream(json?.error?.message || `The AI service returned ${res.status}`, status);
  }
  const out = json?.choices?.[0]?.message?.content;
  const textOut = typeof out === 'string' ? out : Array.isArray(out) ? out.map((p: any) => p?.text || '').join('') : '';
  if (!textOut.trim()) throw new Upstream('The AI returned nothing. Try again.', 502);
  return textOut;
}

/** An error here may be only about the video (link not reachable, format, size), so a cover image is worth trying. */
const videoProblem = (e: unknown) => e instanceof Upstream && !e.timedOut && [400, 404, 413, 415, 422, 500, 502, 503].includes(e.status);

function failure(e: unknown): never {
  if (e instanceof Upstream) {
    // Never 401 to the browser: that status means "your Facebook login expired" there.
    if (e.status === 401 || e.status === 403) throw new GraphError({ message: 'The AI service rejected the key. Check OPENROUTER_API_KEY on the server.' }, 502);
    if (e.status === 402) throw new GraphError({ message: 'The AI service account is out of credits.' }, 402);
    if (e.status === 429) throw new GraphError({ message: 'The AI service is busy right now. Try again in a moment.' }, 429);
    throw new GraphError({ message: e.message }, e.timedOut ? 504 : 502);
  }
  throw e;
}

const PROXY_MAX_CHARS = 8_000_000;
/** The browser's low-resolution copy is accepted only as plain base64 of an MP4 of sensible size. */
function validProxy(p: unknown): string {
  if (typeof p !== 'string' || !p || p.length > PROXY_MAX_CHARS || !/^[A-Za-z0-9+/]+={0,2}$/.test(p)) return '';
  const head = Buffer.from(p.slice(0, 24), 'base64');
  return head.length >= 8 && head.toString('latin1', 4, 8) === 'ftyp' ? p : '';
}

export async function generateCopy(req: CopyRequest, token: string): Promise<CopyResult> {
  if (!process.env.OPENROUTER_API_KEY) throw new GraphError({ message: 'AI writing isn’t set up on this server. Add OPENROUTER_API_KEY.' }, 503);
  if (!['IMAGE', 'VIDEO'].includes(req.kind)) throw new GraphError({ message: 'AI writing works for image and video ads.' }, 400);
  const input: CopyRequest = {
    ...req,
    proxy: req.kind === 'VIDEO' && videoCopyOn() ? validProxy(req.proxy) : '',
    pageName: String(req.pageName || '').slice(0, 120),
    link: String(req.link || '').slice(0, 500),
    cta: String(req.cta || '').slice(0, 40),
    offer: String(req.offer || '').slice(0, 300),
    language: (['EN', 'HINGLISH', 'HI'] as const).includes(req.language) ? req.language : 'EN',
    draft: { message: String(req.draft?.message || '').slice(0, 600), headline: String(req.draft?.headline || '').slice(0, 100), description: String(req.draft?.description || '').slice(0, 100) },
  };
  // Ids go into Graph paths and filters, so only the shapes Meta really uses are accepted.
  if (!/^(act_)?\d+$/.test(input.accountId)) throw new GraphError({ message: 'Invalid ad account.' }, 400);
  if (input.imageHash && !/^[a-f0-9]{16,64}$/i.test(input.imageHash)) throw new GraphError({ message: 'Invalid image.' }, 400);
  if (input.videoId && !/^\d+$/.test(input.videoId)) throw new GraphError({ message: 'Invalid video.' }, 400);
  if (input.kind === 'VIDEO' && !input.proxy && !input.videoId) throw new GraphError({ message: 'The video isn’t ready for the AI yet. Try again once it has uploaded.' }, 400);
  const act = input.accountId.startsWith('act_') ? input.accountId : `act_${input.accountId}`;
  const started = Date.now();
  const left = () => TOTAL_MS - (Date.now() - started);

  // The cover image and the landing page, in parallel. The video on Meta is looked up only if it is needed.
  const imageUrl = async (): Promise<string> => {
    if (!input.imageHash) return '';
    try {
      const r = await graph.get<{ data: { url?: string }[] }>(`${act}/adimages`, token, { hashes: [input.imageHash], fields: 'url' });
      return r.data?.[0]?.url || '';
    } catch { return ''; }
  };
  const videoInfo = async (): Promise<{ url: string; seconds: number }> => {
    try {
      const v = await graph.get<{ source?: string; length?: number }>(input.videoId, token, { fields: 'source,length' });
      return { url: v.source || '', seconds: Number(v.length) || 0 };
    } catch { return { url: '', seconds: 0 }; }
  };
  const [page, image] = await Promise.all([pageContext(input.link), imageUrl()]);
  const offerGiven = !!input.offer.trim();
  const finish = (text: string, saw: CopyResult['saw'], via?: CopyResult['via'], note?: string): CopyResult => {
    try { return { copy: parseCopy(text, offerGiven), saw, via, note, model: model() }; }
    catch { throw new GraphError({ message: 'The AI’s answer couldn’t be read. Try again.' }, 502); }
  };

  try {
    if (input.kind === 'IMAGE') {
      if (!image) throw new GraphError({ message: 'Couldn’t find this image on Meta. Upload it again.' }, 400);
      const text = await ask([{ type: 'text', text: userText(input, page, 'image') }, { type: 'image_url', image_url: { url: image } }], left());
      return finish(text, 'IMAGE');
    }

    // Video, best way first: the browser's low-resolution copy, then the video on Meta by link, then the cover image.
    const watch = async (url: string, via: 'copy' | 'link') =>
      finish(await ask([{ type: 'text', text: userText(input, page, 'video') }, { type: 'video_url', video_url: { url } }], Math.min(left(), 42_000)), 'VIDEO', via);
    const why: string[] = [];

    if (input.proxy) {
      try { return await watch(`data:video/mp4;base64,${input.proxy}`, 'copy'); }
      catch (e) {
        if (!videoProblem(e) || left() < 8000 || (!input.videoId && !image)) throw e;
        why.push('The AI couldn’t open the low-resolution copy of the video.');
      }
    }
    if (input.videoId) {
      const video = await videoInfo();
      if (video.seconds > maxVideoSeconds()) {
        if (!input.proxy) throw new GraphError({ message: `This video is ${Math.round(video.seconds / 60 * 10) / 10} minutes long. AI writing handles up to ${Math.round(maxVideoSeconds() / 60)} minutes. Write the text yourself, or use a shorter cut.` }, 400);
      } else if (video.url) {
        try { return await watch(video.url, 'link'); }
        catch (e) {
          if (!image || !videoProblem(e) || left() < 8000) throw e;
          why.push('The AI couldn’t open the video on Meta.');
        }
      } else {
        why.push('Meta didn’t give a link to the video.');
      }
    }
    if (!image) throw new GraphError({ message: 'The AI couldn’t open the video, and there is no cover image to fall back on.' }, 502);
    const text = await ask([{ type: 'text', text: userText(input, page, 'image') + '\nThis is only the video’s cover image.' }, { type: 'image_url', image_url: { url: image } }], left());
    return finish(text, 'COVER', undefined, `${why.join(' ')} This text is based on the video’s cover image only.`.trim());
  } catch (e) {
    return failure(e);
  }
}
