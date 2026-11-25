'use client';
import { Languages } from 'lucide-react';
import { useState } from 'react';
import { useAiStatus } from '@/launch-ad/lib/ai-client';
import { type TranslateLanguage, type TranslateResult, TRANSLATE_LANGUAGES } from '@/launch-ad/lib/ai-types';
import { apiPost, errorText } from '@/launch-ad/lib/client-api';
import type { FormState } from '@/launch-ad/lib/types';
import { Segmented } from './ui';

type Text = { message: string; headline: string; description: string };
const textOf = (ad: FormState['ad']): Text => ({ message: ad.message, headline: ad.headline, description: ad.description });
const same = (a: Text, b: Text) => a.message === b.message && a.headline === b.headline && a.description === b.description;
const nameOf = (k?: TranslateLanguage) => TRANSLATE_LANGUAGES.find((l) => l.key === k)?.english || '';

/**
 * Regional ads: check the English text first, then translate it (Hindi, Telugu, Tamil, Malayalam, Kannada). The
 * translation is shown first and only replaces the fields when the person chooses to use it; the English is kept so
 * another language can be tried, or the English brought back.
 */
export default function AiTranslate({ ad, setAd }: { ad: FormState['ad']; setAd: (p: Partial<FormState['ad']>) => void }) {
  const status = useAiStatus();
  const [language, setLanguage] = useState<TranslateLanguage>('HI');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ lang: TranslateLanguage; from: Text; r: TranslateResult } | null>(null);
  // Set once a translation is in the fields: the English it came from, and what was put in.
  const [applied, setApplied] = useState<{ english: Text; put: Text; lang: TranslateLanguage } | null>(null);

  if (!status?.translate) return null; // not set up on this server

  const current = textOf(ad);
  // After "Use this translation" the fields hold the regional text; translating again starts from the English it came
  // from, unless the person has edited the fields since (then what is in them is the source).
  const stillApplied = !!applied && same(current, applied.put);
  const source: Text = stillApplied ? applied!.english : current;
  const hasText = !!(source.message.trim() || source.headline.trim() || source.description.trim());

  const translate = async () => {
    setBusy(true); setError('');
    try {
      const r = await apiPost<TranslateResult>('ai-translate', { language, draft: source });
      setResult({ lang: language, from: source, r });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const copy = result?.r.copy;

  return (
    <div className="ai-box">
      <div className="ai-head">
        <Languages size={15} />
        <span className="strong">Translate to a regional language</span>
        <span className="hint">Check the English text above first. It is translated as it is, and you review the result before using it.</span>
      </div>
      <Segmented value={language} onChange={setLanguage} options={TRANSLATE_LANGUAGES.map((l) => ({ key: l.key, label: l.label, title: l.english }))} />
      <div className="ai-actions">
        <button type="button" className="btn-ghost" disabled={!hasText || busy} onClick={translate}>
          {busy ? <><span className="spinner" />Translating to {nameOf(language)}…</> : `Translate to ${nameOf(language)}`}
        </button>
        {!hasText ? <span className="hint" style={{ margin: 0 }}>Write the primary text, headline and description in English first.</span> : null}
        {stillApplied ? (
          <button type="button" className="btn-link" onClick={() => { setAd(applied!.english); setApplied(null); }}>Back to English</button>
        ) : null}
      </div>
      {error ? <div className="notice bad" style={{ marginTop: 10 }}>{error}</div> : null}

      {copy && result ? (
        <>
          <div className="ai-opt" style={{ marginTop: 10 }}>
            <div className="hint" style={{ marginBottom: 6 }}>{nameOf(result.lang)} translation of your English text</div>
            <div className="ai-primary">{copy.primary_text}</div>
            {copy.headline ? <div className="ai-line"><span className="strong">Headline</span> · {copy.headline}</div> : null}
            {copy.description ? <div className="ai-line"><span className="strong">Description</span> · {copy.description}</div> : null}
            {copy.warnings.map((w, k) => <div className="ai-warn" key={k}>{w}</div>)}
            <button type="button" className="btn-ghost" onClick={() => {
              const put: Text = { message: copy.primary_text, headline: copy.headline, description: copy.description };
              setApplied({ english: result.from, put, lang: result.lang });
              setAd(put);
              setResult(null);
            }}>Use this translation</button>
          </div>
          <div className="hint" style={{ marginTop: 10 }}>The text is sent to an AI service ({result.r.model}) to translate it. Ask someone who reads {nameOf(result.lang)} to check it before you launch.</div>
        </>
      ) : applied && stillApplied ? (
        <div className="ai-used">The fields now hold the {nameOf(applied.lang)} text.</div>
      ) : null}
    </div>
  );
}
