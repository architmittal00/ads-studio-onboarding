'use client';
import { Sparkles } from 'lucide-react';
import { useRef, useState } from 'react';
import { useAiStatus } from '@/launch-ad/lib/ai-client';
import { type CopyLang, type CopyResult, type CopyText, type TranslateLanguage, type TranslateResult, TRANSLATE_LANGUAGES } from '@/launch-ad/lib/ai-types';
import { apiPost, errorText } from '@/launch-ad/lib/client-api';
import { CTAS } from '@/launch-ad/lib/constants';
import type { FormState } from '@/launch-ad/lib/types';
import { useProxy } from '@/launch-ad/lib/video-proxy';
import { Field, Segmented, TextInput } from './ui';

type Ad = FormState['ad'];

const EMPTY: CopyText = { message: '', headline: '', description: '' };
const textOf = (ad: Ad): CopyText => ({ message: ad.message, headline: ad.headline, description: ad.description });
const same = (a?: CopyText, b?: CopyText) => !!a && !!b && a.message === b.message && a.headline === b.headline && a.description === b.description;
const filled = (t?: CopyText) => !!t && !!(t.message.trim() || t.headline.trim() || t.description.trim());
const nameOf = (k: CopyLang) => (k === 'EN' ? 'English' : TRANSLATE_LANGUAGES.find((l) => l.key === k)?.english || '');
const TABS: { key: CopyLang; label: string; title: string }[] = [{ key: 'EN', label: 'English', title: 'English' }, ...TRANSLATE_LANGUAGES.map((l) => ({ key: l.key as CopyLang, label: l.label, title: l.english }))];

/**
 * The ad's text (primary text, headline, description) in one place. Write it in English, by hand or with the AI; for a
 * regional ad, click the language: the English is translated straight into the same fields. Each language keeps its
 * own text, and a translation notices when the English it came from has changed. The ad uses whichever language is
 * showing.
 */
export default function AdCopyEditor({ ad, setAd, accountId, pageName }: {
  ad: Ad;
  setAd: (p: Partial<Ad>) => void;
  accountId: string;
  pageName: string;
}) {
  const status = useAiStatus();
  const proxy = useProxy(ad.videoUrl);
  const latest = useRef(ad); // an answer can arrive after the person has moved on; it is merged into what is there now
  latest.current = ad;
  const [offer, setOffer] = useState('');
  const [offerOpen, setOfferOpen] = useState(false);
  const [writing, setWriting] = useState(false);
  const [translating, setTranslating] = useState<TranslateLanguage | null>(null);
  const [error, setError] = useState('');
  const [wrote, setWrote] = useState<{ r: CopyResult; before: CopyText } | null>(null);
  const [notes, setNotes] = useState<Partial<Record<CopyLang, string[]>>>({});

  const lang = ad.copyLang;
  const regional = lang !== 'EN';
  // English lives in the fields while it is showing, and in the saved versions while another language is.
  const english: CopyText = lang === 'EN' ? textOf(ad) : ad.copyVersions.EN || EMPTY;
  const stale = regional && !!ad.copyFrom[lang as TranslateLanguage] && !same(ad.copyFrom[lang as TranslateLanguage], english);
  const canTranslate = !!status?.translate;

  /** Saved versions with the one on screen brought up to date. */
  const saved = () => ({ ...latest.current.copyVersions, [latest.current.copyLang]: textOf(latest.current) });

  const edit = (patch: Partial<CopyText>) => {
    const next = { ...textOf(ad), ...patch };
    setAd({ ...patch, copyVersions: { ...ad.copyVersions, [lang]: next } });
  };

  const translate = async (to: TranslateLanguage, from: CopyText) => {
    setError(''); setTranslating(to);
    try {
      const r = await apiPost<TranslateResult>('ai-translate', { language: to, draft: from });
      const c = r.copy;
      const out: CopyText = { message: c.primary_text, headline: c.headline, description: c.description };
      const cur = latest.current;
      const versions = { ...saved(), [to]: out };
      setNotes((n) => ({ ...n, [to]: c.warnings }));
      setAd({ copyVersions: versions, copyFrom: { ...cur.copyFrom, [to]: from }, ...(cur.copyLang === to ? out : {}) });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setTranslating(null);
    }
  };

  const pick = (to: CopyLang) => {
    if (to === lang) return;
    setError(''); setWrote(null);
    const versions = saved();
    if (to === 'EN') { setAd({ copyLang: 'EN', copyVersions: versions, ...(versions.EN || EMPTY) }); return; }
    const have = versions[to];
    if (have) { setAd({ copyLang: to, copyVersions: versions, ...have }); return; }
    // First time in this language: show it empty and translate the English right away.
    setAd({ copyLang: to, copyVersions: versions, ...EMPTY });
    const en = versions.EN || EMPTY;
    if (filled(en) && canTranslate) translate(to, en);
  };

  // ── AI writing (English) ──
  const isVideo = !!ad.videoId || !!ad.videoStatus;
  const copyReady = isVideo && !!status?.videoCopy && proxy?.status === 'ready';
  const copyMaking = isVideo && !!status?.videoCopy && proxy?.status === 'making';
  const ready = isVideo ? copyReady || ad.videoStatus === 'ready' : !!ad.imageHash;
  const waiting = !isVideo ? 'Add an image or video first.'
    : copyMaking ? 'Getting the video ready for the AI…'
      : ad.videoStatus === 'uploading' ? 'Available once the video has uploaded and Meta has processed it.'
        : ad.videoStatus === 'processing' ? 'Available once Meta finishes processing the video.'
          : ad.videoStatus === 'error' ? '' : 'Add an image or video first.';

  const write = async () => {
    setWriting(true); setError('');
    const before = textOf(ad);
    try {
      const r = await apiPost<CopyResult>('ai-copy', {
        accountId, kind: isVideo ? 'VIDEO' : 'IMAGE', imageHash: ad.imageHash, videoId: isVideo ? ad.videoId : '',
        proxy: copyReady ? proxy?.base64 : undefined,
        pageName, link: ad.link, cta: CTAS.find((c) => c.key === ad.cta)?.label || '', language: 'EN', offer,
        draft: before,
      });
      const out: CopyText = { message: r.copy.primary_text, headline: r.copy.headline, description: r.copy.description };
      setAd({ ...out, copyVersions: { ...latest.current.copyVersions, EN: out } });
      setWrote({ r, before });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setWriting(false);
    }
  };

  const hears = wrote ? /omni/i.test(wrote.r.model) : false;
  const saw = !wrote ? ''
    : wrote.r.saw === 'VIDEO'
      ? (wrote.r.via === 'copy' ? 'Watched a low-resolution copy of the whole video and read the text on screen. Audio isn’t used.'
        : hears ? 'Watched and listened to the whole video.' : 'Watched the whole video and read the text on screen. This model doesn’t hear audio.')
      : wrote.r.saw === 'COVER' ? (wrote.r.note || 'Based on the video’s cover image only.') : 'Looked at the image.';

  const busyTranslating = translating === lang;

  return (
    <div className="ai-box">
      <div className="ai-head">
        <Sparkles size={15} />
        <span className="strong">Ad text</span>
        <span className="hint">
          {regional ? `${nameOf(lang)} version, translated from your English. The ad uses this text.` : canTranslate ? 'Write it in English, then pick a language above to translate it.' : 'Primary text, headline and description.'}
        </span>
      </div>

      {canTranslate ? <Segmented value={lang as CopyLang} onChange={pick} options={TABS.map((t) => ({ ...t, label: t.key !== 'EN' && ad.copyVersions[t.key] ? `${t.label} ✓` : t.label }))} /> : null}

      {!regional && status?.enabled ? (
        <>
          <div className="ai-actions" style={{ marginTop: 10 }}>
            <button type="button" className="btn-ghost" disabled={!ready || writing} onClick={write}>
              {writing ? <><span className="spinner" />{isVideo ? 'Watching the video and writing…' : 'Looking at the image and writing…'}</> : <><Sparkles size={13} /> {filled(english) ? 'Write again with AI' : 'Write with AI'}</>}
            </button>
            <button type="button" className="btn-link" onClick={() => setOfferOpen(!offerOpen)}>{offerOpen ? 'Hide offer' : 'Add an offer or details'}</button>
            {!ready && waiting ? <span className="hint" style={{ margin: 0 }}>{waiting}</span> : null}
            {writing && isVideo ? <span className="hint" style={{ margin: 0 }}>Longer videos can take up to a minute.</span> : null}
          </div>
          {offerOpen ? <TextInput value={offer} onChange={(e) => setOffer(e.target.value)} maxLength={300} aria-label="Offer or details to mention" placeholder="Offer or details the AI may mention, e.g. Flat 20% off till Sunday" style={{ marginTop: 8 }} /> : null}
        </>
      ) : null}

      {regional ? (
        <div className="ai-actions" style={{ marginTop: 10 }}>
          <button type="button" className="btn-ghost" disabled={!filled(english) || !canTranslate || !!translating} onClick={() => translate(lang as TranslateLanguage, english)}>
            {busyTranslating ? <><span className="spinner" />Translating to {nameOf(lang)}…</> : `Translate again from English`}
          </button>
          <button type="button" className="btn-link" onClick={() => pick('EN')}>Edit the English</button>
          {!filled(english) ? <span className="hint" style={{ margin: 0 }}>Write the English text first.</span> : null}
        </div>
      ) : null}
      {stale ? (
        <div className="notice warn" style={{ marginTop: 10 }}>
          Your English text has changed since this was translated.{' '}
          <button type="button" className="btn-link" onClick={() => translate(lang as TranslateLanguage, english)} disabled={!!translating}>Update the {nameOf(lang)} version</button>
        </div>
      ) : null}
      {error ? <div className="notice bad" style={{ marginTop: 10 }}>{error}</div> : null}

      <div style={{ marginTop: 12, opacity: busyTranslating ? 0.5 : 1 }}>
        <Field label="Primary text">
          <textarea className="input" value={ad.message} onChange={(e) => edit({ message: e.target.value })} rows={3} disabled={busyTranslating} placeholder={regional ? '' : 'Tell people what your ad is about'} />
        </Field>
        <div className="row field">
          <Field label="Headline"><TextInput value={ad.headline} onChange={(e) => edit({ headline: e.target.value })} disabled={busyTranslating} placeholder={regional ? '' : 'Write a short headline'} /></Field>
          <Field label="Description"><TextInput value={ad.description} onChange={(e) => edit({ description: e.target.value })} disabled={busyTranslating} placeholder="Optional" /></Field>
        </div>
      </div>

      {regional ? (
        <>
          {(notes[lang] || []).map((w, k) => <div className="ai-warn" key={k}>{w}</div>)}
          <div className="hint" style={{ marginTop: 6 }}>Translated by AI ({status?.translateModel || 'Gemini'}). Ask someone who reads {nameOf(lang)} to check it before you launch.</div>
        </>
      ) : wrote ? (
        <>
          <div className="hint ai-saw">{saw}</div>
          {wrote.r.copy.warnings.map((w, k) => <div className="ai-warn" key={k}>{w}</div>)}
          <div className="ai-used">
            AI wrote this text.{' '}
            <button type="button" className="btn-link" onClick={() => { setAd({ ...wrote.before, copyVersions: { ...latest.current.copyVersions, EN: wrote.before } }); setWrote(null); }}>Undo</button>
          </div>
          <div className="hint" style={{ marginTop: 6 }}>The creative and these details are sent to an AI service ({wrote.r.model}) to write the text. AI can get facts wrong: check every claim before you launch.</div>
        </>
      ) : null}
    </div>
  );
}
