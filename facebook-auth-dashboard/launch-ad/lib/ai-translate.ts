import 'server-only';
import { baseUrl, failure, Upstream } from './ai-copy';
import { type TranslateLanguage, type TranslateRequest, type TranslateResult, TRANSLATE_LANGUAGES } from './ai-types';
import { GraphError } from './graph';

/* eslint-disable @typescript-eslint/no-explicit-any */

/*
 * Translates the ad text (primary text, headline, description) from English into Hindi, Telugu, Tamil, Malayalam or
 * Kannada with a Gemini model through OpenRouter. Same key as the AI copywriter; the model is separate because
 * translation is a different job from writing:
 *
 *   OPENROUTER_API_KEY            required
 *   OPENROUTER_TRANSLATE_MODEL    default google/gemini-2.5-flash
 */

export const translateModel = () => process.env.OPENROUTER_TRANSLATE_MODEL || 'google/gemini-2.5-flash';
const TIMEOUT_MS = 45_000;
const LIMITS = { message: 2000, headline: 200, description: 300 };
const HEADLINE_SOFT = 40;

/** The Unicode block of each script, to check the answer really came back in the language asked for. */
const SCRIPT: Record<TranslateLanguage, RegExp> = {
  HI: /[ऀ-ॿ]/,
  TE: /[ఀ-౿]/,
  TA: /[஀-௿]/,
  ML: /[ഀ-ൿ]/,
  KN: /[ಀ-೿]/,
};

const SYSTEM = [
  'You are a professional Indian-language ad localiser. You translate Meta (Facebook / Instagram) ad text from English.',
  'Rules:',
  '- Translate faithfully. Do not add, remove or change any claim, offer, price, discount, number or deadline.',
  '- Keep brand names, product names, URLs, hashtags, emojis and currency symbols (₹) exactly as they are. Numbers stay as digits.',
  '- Write natural, conversational copy as a native speaker would write an ad, not a word-for-word translation. Use the standard script of the target language.',
  '- Keep each field about as short as the English one; the headline must stay short (aim for 40 characters or fewer).',
  '- Keep line breaks and the order of the text. An empty field stays an empty string.',
  'Answer with ONLY a JSON object: {"primary_text": "...", "headline": "...", "description": "..."}.',
].join('\n');

async function ask(user: string): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
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
        model: translateModel(),
        messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }],
        temperature: 0.2,
        max_tokens: 3000,
        response_format: { type: 'json_object' },
        ...(process.env.OPENROUTER_DATA_COLLECTION === 'deny' ? { provider: { data_collection: 'deny' } } : {}),
      }),
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new Upstream('The translation took too long. Try again.', 504, true);
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

/** The three fields from the model's answer (tolerates a code fence around the JSON). */
export function parseTranslation(raw: string): { primary_text: string; headline: string; description: string } {
  const s = (raw || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  const a = s.indexOf('{'); const b = s.lastIndexOf('}');
  if (a < 0 || b < a) throw new Error('no JSON');
  const o = JSON.parse(s.slice(a, b + 1));
  const f = (v: unknown, n: number) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
  return { primary_text: f(o.primary_text ?? o.primaryText, LIMITS.message), headline: f(o.headline, LIMITS.headline), description: f(o.description, LIMITS.description) };
}

export async function translateCopy(req: TranslateRequest): Promise<TranslateResult> {
  if (!process.env.OPENROUTER_API_KEY) throw new GraphError({ message: 'Translation isn’t set up on this server. Add OPENROUTER_API_KEY.' }, 503);
  const lang = TRANSLATE_LANGUAGES.find((l) => l.key === req.language);
  if (!lang) throw new GraphError({ message: 'Pick Hindi, Telugu, Tamil, Malayalam or Kannada.' }, 400);
  const draft = {
    message: String(req.draft?.message || '').slice(0, LIMITS.message),
    headline: String(req.draft?.headline || '').slice(0, LIMITS.headline),
    description: String(req.draft?.description || '').slice(0, LIMITS.description),
  };
  if (!draft.message.trim() && !draft.headline.trim() && !draft.description.trim()) throw new GraphError({ message: 'Write the English text first.' }, 400);

  const user = `Translate this ad text from English into ${lang.english}.\n\n${JSON.stringify({ primary_text: draft.message, headline: draft.headline, description: draft.description })}`;
  let text: string;
  try { text = await ask(user); } catch (e) { return failure(e); }
  let out: ReturnType<typeof parseTranslation>;
  try { out = parseTranslation(text); } catch { throw new GraphError({ message: 'The translation couldn’t be read. Try again.' }, 502); }

  // Each field that had English text must have come back with that language's script in it.
  const missing = (en: string, tr: string) => !!en.trim() && !SCRIPT[lang.key].test(tr);
  if (missing(draft.message, out.primary_text) || (!!draft.headline.trim() && !out.headline.trim())) {
    throw new GraphError({ message: `The AI didn’t return ${lang.english}. Try again.` }, 502);
  }
  const warnings: string[] = [];
  if (out.headline.length > HEADLINE_SOFT) warnings.push(`The headline is ${out.headline.length} characters; Meta may cut it off after about ${HEADLINE_SOFT}. Shorten it if it matters.`);
  if (missing(draft.headline, out.headline) || missing(draft.description, out.description)) warnings.push(`Part of the headline or description stayed in English (a brand name or number, or the AI skipped it). Check it.`);
  return { copy: { ...out, warnings }, model: translateModel() };
}
