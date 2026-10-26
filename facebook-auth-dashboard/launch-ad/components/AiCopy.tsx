'use client';
import { Sparkles } from 'lucide-react';
import { useState } from 'react';
import { useAiStatus } from '@/launch-ad/lib/ai-client';
import type { CopyLanguage, CopyResult } from '@/launch-ad/lib/ai-types';
import { apiPost, errorText } from '@/launch-ad/lib/client-api';
import { CTAS } from '@/launch-ad/lib/constants';
import type { FormState } from '@/launch-ad/lib/types';
import { useProxy } from '@/launch-ad/lib/video-proxy';
import { Segmented, TextInput } from './ui';

const LANGS: { key: CopyLanguage; label: string }[] = [{ key: 'EN', label: 'English' }, { key: 'HINGLISH', label: 'Hinglish' }, { key: 'HI', label: 'हिन्दी' }];

/** Image and video ads: the AI looks at the creative and writes the primary text, headline and description. */
export default function AiCopy({ ad, accountId, pageName, setAd }: {
  ad: FormState['ad'];
  accountId: string;
  pageName: string;
  setAd: (p: Partial<FormState['ad']>) => void;
}) {
  const status = useAiStatus();
  const proxy = useProxy(ad.videoUrl);
  const [language, setLanguage] = useState<CopyLanguage>('EN');
  const [offer, setOffer] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ r: CopyResult; media: string } | null>(null);
  const [undo, setUndo] = useState<{ message: string; headline: string; description: string } | null>(null);

  if (!status?.enabled) return null; // not set up on this server

  const isVideo = !!ad.videoId || !!ad.videoStatus;
  // The browser's small copy lets the AI start while the video is still uploading to Meta.
  const copyReady = isVideo && status.videoCopy && proxy?.status === 'ready';
  const copyMaking = isVideo && status.videoCopy && proxy?.status === 'making';
  const ready = isVideo ? copyReady || ad.videoStatus === 'ready' : !!ad.imageHash;
  const media = (isVideo ? ad.videoUrl || ad.videoId : ad.imageHash) || '';
  const waiting = !isVideo ? 'Add an image or video first.'
    : copyMaking ? 'Getting the video ready for the AI…'
      : ad.videoStatus === 'uploading' ? 'Available once the video has uploaded and Meta has processed it.'
        : ad.videoStatus === 'processing' ? 'Available once Meta finishes processing the video.'
          : ad.videoStatus === 'error' ? '' : 'Add an image or video first.';

  const write = async () => {
    setBusy(true); setError(''); setUndo(null);
    try {
      const r = await apiPost<CopyResult>('ai-copy', {
        accountId, kind: isVideo ? 'VIDEO' : 'IMAGE', imageHash: ad.imageHash, videoId: isVideo ? ad.videoId : '',
        proxy: copyReady ? proxy?.base64 : undefined,
        pageName, link: ad.link, cta: CTAS.find((c) => c.key === ad.cta)?.label || '', language, offer,
        draft: { message: ad.message, headline: ad.headline, description: ad.description },
      });
      setResult({ r, media });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const shown = result && result.media === media ? result.r : null; // the text belongs to the creative it was written for
  const copy = shown?.copy;
  const hears = shown ? /omni/i.test(shown.model) : false;
  const saw = !shown ? ''
    : shown.saw === 'VIDEO'
      ? (shown.via === 'copy' ? 'Watched a low-resolution copy of the whole video and read the text on screen. Audio isn’t used.'
        : hears ? 'Watched and listened to the whole video.' : 'Watched the whole video and read the text on screen. This model doesn’t hear audio.')
      : shown.saw === 'COVER' ? (shown.note || 'Based on the video’s cover image only.') : 'Looked at the image.';

  return (
    <div className="ai-box">
      <div className="ai-head">
        <Sparkles size={15} />
        <span className="strong">Write the text with AI</span>
        <span className="hint">{isVideo ? 'Watches your whole video and writes the primary text, headline and description.' : 'Looks at your image and writes the primary text, headline and description.'}</span>
      </div>
      <Segmented value={language} onChange={setLanguage} options={LANGS} />
      <TextInput value={offer} onChange={(e) => setOffer(e.target.value)} maxLength={300} aria-label="Offer or details to mention" placeholder="Offer or details to mention (optional), e.g. Flat 20% off till Sunday" />
      <div className="ai-actions">
        <button type="button" className="btn-ghost" disabled={!ready || busy} onClick={write}>
          {busy ? <><span className="spinner" />{isVideo ? 'Watching the video and writing…' : 'Looking at the image and writing…'}</> : copy ? 'Write again' : 'Write ad text'}
        </button>
        {!ready && waiting ? <span className="hint" style={{ margin: 0 }}>{waiting}</span> : null}
        {busy && isVideo ? <span className="hint" style={{ margin: 0 }}>Longer videos can take up to a minute.</span> : null}
      </div>
      {error ? <div className="notice bad" style={{ marginTop: 10 }}>{error}</div> : null}

      {copy ? (
        <>
          <div className="hint ai-saw">{saw}</div>
          <div className="ai-opt" style={{ marginTop: 10 }}>
            <div className="ai-primary">{copy.primary_text}</div>
            <div className="ai-line"><span className="strong">Headline</span> · {copy.headline}</div>
            {copy.description ? <div className="ai-line"><span className="strong">Description</span> · {copy.description}</div> : null}
            {copy.warnings.map((w, k) => <div className="ai-warn" key={k}>{w}</div>)}
            <button type="button" className="btn-ghost" onClick={() => {
              setUndo({ message: ad.message, headline: ad.headline, description: ad.description });
              setAd({ message: copy.primary_text, headline: copy.headline, description: copy.description });
            }}>Use this text</button>
          </div>
          {undo ? (
            <div className="ai-used">
              Text filled in below.
              <button type="button" className="btn-link" onClick={() => { setAd(undo); setUndo(null); }}>Undo</button>
            </div>
          ) : null}
          <div className="hint" style={{ marginTop: 10 }}>The creative and these details are sent to an AI service ({shown?.model}) to write the text. AI can get facts wrong: check every claim before you launch.</div>
        </>
      ) : null}
    </div>
  );
}
