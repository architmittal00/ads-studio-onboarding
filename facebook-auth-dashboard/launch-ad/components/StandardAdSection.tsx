'use client';
import { ImagePlus, Play } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { apiGet, apiPost, apiPostBytes, errorText } from '@/launch-ad/lib/client-api';
import { CTAS } from '@/launch-ad/lib/constants';
import { useAiStatus } from '@/launch-ad/lib/ai-client';
import { useAsync } from '@/launch-ad/lib/hooks';
import type { FormState, PostMedia } from '@/launch-ad/lib/types';
import { startProxy } from '@/launch-ad/lib/video-proxy';
import AiCopy from './AiCopy';
import { MediaModal } from './PostMedia';
import TrackingFields from './TrackingFields';
import { Field, Loading, SearchSelect, Segmented, Select, TextInput, Toggle } from './ui';

interface Page { id: string; name: string; website?: string; instagram_business_account?: { id: string; username?: string } }
interface Post { id: string; text: string; image: string; type: string; time: string; link?: string; media?: PostMedia[] }

const MAX_BYTES = 3 * 1024 * 1024;
const MAX_VIDEO = 1_000_000_000;
// Each piece goes through this app's server, which accepts up to 4.5 MB per request.
const CHUNK = 3_500_000;

/** A JPEG frame from about a third of the way into the video (Meta needs a thumbnail for video ads). */
function frameOf(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = url;
    v.onloadeddata = () => { v.currentTime = Math.min(1, (v.duration || 3) / 3); };
    v.onseeked = () => {
      const scale = Math.min(1, 1280 / Math.max(v.videoWidth || 1, v.videoHeight || 1));
      const c = document.createElement('canvas');
      c.width = Math.round((v.videoWidth || 640) * scale); c.height = Math.round((v.videoHeight || 640) * scale);
      c.getContext('2d')?.drawImage(v, 0, 0, c.width, c.height);
      resolve(c.toDataURL('image/jpeg', 0.85));
    };
    v.onerror = () => reject(new Error('This video can’t be read in the browser. Use an MP4 (H.264) or MOV file.'));
  });
}

function pageWebsite(p?: Page): string {
  const first = (p?.website || '').split(/[\s,]+/).find(Boolean);
  if (!first) return '';
  return /^https?:\/\//i.test(first) ? first : `https://${first}`;
}

/** Normal (non-catalog) ad: upload an image or video, or promote an existing Facebook / Instagram post. */
export default function StandardAdSection({ form, setAd, accountId }: {
  form: FormState;
  setAd: (p: Partial<FormState['ad']>) => void;
  accountId: string;
}) {
  const ad = form.ad;
  const pages = useAsync<Page[]>('pages', () => apiGet('pages'));
  const ai = useAiStatus();
  const page = pages.data?.find((p) => p.id === ad.pageId);
  const ig = page?.instagram_business_account;
  const [linkEdited, setLinkEdited] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [progress, setProgress] = useState(0);
  const [playing, setPlaying] = useState<Post | null>(null);

  const posts = useAsync<Post[]>(
    ad.kind === 'POST' && ad.pageId && (ad.postSource === 'FACEBOOK' || ig?.id) ? `posts-${ad.pageId}-${ad.postSource}` : null,
    () => apiGet('posts', { page: ad.pageId, source: ad.postSource, ig: ig?.id }),
  );

  // Product tokens only work in catalog ads; clear them if the text came from a catalog setup.
  useEffect(() => {
    const strip = (t: string) => (t.includes('{{product.') ? '' : t);
    if ([ad.message, ad.headline, ad.description].some((t) => t.includes('{{product.'))) {
      setAd({ message: strip(ad.message), headline: strip(ad.headline), description: strip(ad.description) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ad.kind]);

  useEffect(() => {
    setAd({ instagramUserId: ig?.id || '' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ad.pageId, ig?.id]);

  useEffect(() => {
    if (!page || linkEdited) return;
    setAd({ link: pageWebsite(page) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ad.pageId, page?.website]);

  // Meta processes an uploaded video before it can be used; check until it's ready.
  // A request that never answers can't stall the checks, coming back to the tab checks at once
  // (background tabs run timers slowly), and "Check now" does it on demand.
  const [procPct, setProcPct] = useState<number | null>(null);
  const checkNow = useRef<() => void>(() => undefined);
  useEffect(() => {
    if (!ad.videoId || ad.videoStatus !== 'processing') return;
    let stop = false;
    let busy = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const startedAt = Date.now();
    const withTimeout = <T,>(p: Promise<T>, ms: number): Promise<T> => new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error('slow')), ms);
      p.then((v) => { clearTimeout(t); res(v); }, (e) => { clearTimeout(t); rej(e); });
    });
    const check = async () => {
      if (stop || busy) return;
      busy = true;
      clearTimeout(timer);
      try {
        const s = await withTimeout(apiGet<{ status: string; progress: number | null }>('video-status', { video: ad.videoId }), 15000);
        if (stop) return;
        if (typeof s.progress === 'number') setProcPct(Math.max(0, Math.min(100, Math.round(s.progress))));
        if (s.status === 'ready') { setAd({ videoStatus: 'ready' }); return; }
        if (s.status === 'error') { setAd({ videoStatus: 'error' }); return; }
      } catch { /* try again */ } finally { busy = false; }
      if (!stop && Date.now() - startedAt < 15 * 60_000) timer = setTimeout(check, Date.now() - startedAt < 20_000 ? 2000 : 4000);
    };
    checkNow.current = check;
    timer = setTimeout(check, 2000);
    const wake = () => { if (document.visibilityState === 'visible') check(); };
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('focus', wake);
    window.addEventListener('online', wake);
    return () => {
      stop = true; clearTimeout(timer);
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('focus', wake);
      window.removeEventListener('online', wake);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ad.videoId, ad.videoStatus]);

  const onVideo = async (file: File) => {
    if (file.size > MAX_VIDEO) { setUploadError('Video must be under 1 GB.'); return; }
    const local = URL.createObjectURL(file);
    setProgress(0);
    setProcPct(null);
    setAd({ videoStatus: 'uploading', videoUrl: local, videoId: '', imageHash: '', imageUrl: '', imageName: file.name });
    // While the video uploads, the browser makes a small copy of it for the AI (only when AI writing is set up).
    if (ai?.enabled && ai.videoCopy) startProxy(local, local);
    try {
      const thumb = await frameOf(local);
      const img = await apiPost<{ hash: string; url: string }>('upload-image', { account: accountId, name: `${file.name}-thumbnail.jpg`, bytes: thumb.split(',')[1] });
      setAd({ imageHash: img.hash, imageUrl: thumb });
      const s = await apiPost<{ upload_session_id: string; video_id: string; start_offset: string; end_offset: string }>('upload-video', { account: accountId, phase: 'start', size: file.size });
      let start = Number(s.start_offset); let end = Number(s.end_offset);
      while (start < end) {
        const stopAt = Math.min(end, start + CHUNK);
        const r = await apiPostBytes<{ start_offset: string; end_offset: string }>('upload-video-chunk', { account: accountId, session: s.upload_session_id, offset: String(start) }, file.slice(start, stopAt));
        start = Number(r.start_offset); end = Number(r.end_offset);
        setProgress(Math.min(1, start / file.size));
      }
      await apiPost('upload-video', { account: accountId, phase: 'finish', session: s.upload_session_id, name: file.name });
      setProgress(1);
      setAd({ videoId: s.video_id, videoStatus: 'processing' });
    } catch (e) {
      setUploadError(errorText(e));
      setAd({ videoStatus: '', videoId: '', videoUrl: '', imageHash: '', imageUrl: '', imageName: '' });
    }
  };

  const onFile = async (file?: File) => {
    if (!file) return;
    setUploadError('');
    if (/^video\/(mp4|quicktime)$/.test(file.type)) { await onVideo(file); return; }
    if (!/^image\/(jpeg|png)$/.test(file.type)) { setUploadError('Use a JPG or PNG image, or an MP4 or MOV video.'); return; }
    if (file.size > MAX_BYTES) { setUploadError('Image must be under 3 MB.'); return; }
    setUploading(true);
    try {
      const dataUrl: string = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(new Error('Could not read the file')); r.readAsDataURL(file); });
      const bytes = dataUrl.split(',')[1];
      const img = await apiPost<{ hash: string; url: string }>('upload-image', { account: accountId, name: file.name, bytes });
      setAd({ imageHash: img.hash, imageUrl: dataUrl, imageName: file.name, videoId: '', videoStatus: '', videoUrl: '' });
    } catch (e) {
      setUploadError(errorText(e));
    } finally {
      setUploading(false);
    }
  };


  return (
    <div className="card">
      <Field label="Ad name">
        <TextInput value={ad.name} onChange={(e) => setAd({ name: e.target.value })} placeholder={ad.kind === 'POST' ? 'e.g. Diwali post · Boost' : 'e.g. Diwali sale · Image'} />
      </Field>
      <Field label="Facebook Page">
        {pages.loading ? <Loading /> : pages.error ? <div className="notice bad">{pages.error}</div> : (
          <SearchSelect
            value={ad.pageId}
            onChange={(v) => setAd({ pageId: v, postId: '', postPreview: '' })}
            ariaLabel="Facebook Page"
            noun="Pages"
            placeholder="Select a Page..."
            searchPlaceholder={`Search ${(pages.data || []).length.toLocaleString('en-IN')} Pages by name or ID`}
            options={(pages.data || []).map((p) => ({ key: p.id, label: p.name, meta: [p.id, p.instagram_business_account?.username ? `@${p.instagram_business_account.username}` : ''].filter(Boolean).join(' · ') }))}
          />
        )}
      </Field>
      {page && ad.kind === 'UPLOAD' ? (
        <Field>
          {ig ? (
            <Toggle checked={!!ad.instagramUserId} onChange={(v) => setAd({ instagramUserId: v ? ig.id : '' })} label={<>Run on Instagram as <span className="strong">@{ig.username || ig.id}</span></>} />
          ) : (
            <p className="hint" style={{ margin: 0 }}>This Page has no connected Instagram account, so Instagram placements use the Page name.</p>
          )}
        </Field>
      ) : null}


      {ad.kind === 'UPLOAD' ? (
        <>
          <Field label="Image or video" hint="Image: JPG or PNG under 3 MB. Video: MP4 or MOV up to 1 GB. 1:1 or 4:5 works across Feed, Stories and Reels.">
            <label className="upload">
              <input type="file" accept="image/jpeg,image/png,video/mp4,video/quicktime" onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ''; }} style={{ display: 'none' }} disabled={uploading || ad.videoStatus === 'uploading'} />
              {ad.imageUrl ? <img src={ad.imageUrl} alt="" /> : <ImagePlus size={22} strokeWidth={1.6} />}
              <span>
                {uploading ? 'Uploading image to Meta…'
                  : ad.videoStatus === 'uploading' ? `Uploading video to Meta… ${Math.round(progress * 100)}%`
                  : ad.imageName ? `${ad.imageName} · change`
                  : 'Choose an image or video'}
              </span>
            </label>
            {ad.videoStatus === 'uploading' ? <div className="progress" aria-label="Upload progress"><i style={{ width: `${Math.round(progress * 100)}%` }} /></div> : null}
            {ad.videoStatus === 'processing' ? (
              <div className="hint">
                Meta is processing the video{procPct != null && procPct > 0 ? `: ${procPct}%` : ''}. This usually takes under a minute; you can keep editing.{' '}
                <button type="button" className="btn-link" onClick={() => checkNow.current()}>Check now</button>
              </div>
            ) : null}
            {ad.videoStatus === 'ready' ? <div className="hint" style={{ color: 'var(--ok)' }}>Video ready on Meta.</div> : null}
            {ad.videoStatus === 'error' ? <div className="notice bad" style={{ marginTop: 8 }}>Meta couldn&apos;t process this video. Upload a different file.</div> : null}
            {uploadError ? <div className="notice bad" style={{ marginTop: 8 }}>{uploadError}</div> : null}
          </Field>
          <AiCopy ad={ad} accountId={accountId} pageName={page?.name || ''} setAd={setAd} />
          <Field label="Primary text">
            <textarea className="input" value={ad.message} onChange={(e) => setAd({ message: e.target.value })} rows={3} placeholder="Tell people what your ad is about" />
          </Field>
          <div className="row field">
            <Field label="Headline"><TextInput value={ad.headline} onChange={(e) => setAd({ headline: e.target.value })} placeholder="Write a short headline" /></Field>
            <Field label="Description"><TextInput value={ad.description} onChange={(e) => setAd({ description: e.target.value })} placeholder="Optional" /></Field>
          </div>
          <div className="row field">
            <Field label="Call to action"><Select value={ad.cta} onChange={(v) => setAd({ cta: v })} options={CTAS} /></Field>
            <Field label="Website URL" hint={page && !linkEdited ? (pageWebsite(page) ? 'From the Page’s website.' : 'This Page has no website listed; enter one.') : undefined}>
              <TextInput value={ad.link} onChange={(e) => { setLinkEdited(true); setAd({ link: e.target.value }); }} placeholder="https://yourstore.com" />
            </Field>
          </div>
        </>
      ) : (
        <>
          <Field label="Post from">
            <Segmented
              value={ad.postSource}
              onChange={(v) => setAd({ postSource: v, postId: '', postPreview: '' })}
              options={[{ key: 'FACEBOOK', label: 'Facebook Page' }, { key: 'INSTAGRAM', label: 'Instagram account', disabled: !ig, title: !ig ? 'This Page has no connected Instagram account' : undefined }]}
            />
          </Field>
          <Field label="Select post" hint="The post keeps its own text, media and engagement. Its call to action can't be changed.">
            {!ad.pageId ? <div className="note">Select a Page first.</div> : posts.loading ? <Loading /> : posts.error ? <div className="notice bad">{posts.error}</div> : !posts.data?.length ? (
              <div className="note">No recent posts found.</div>
            ) : (
              <div className="post-grid" role="radiogroup" aria-label="Posts">
                {posts.data.map((p) => {
                  const pick = () => setAd({ postId: p.id, postPreview: p.image, postMedia: p.media || [] });
                  const isVideo = (p.media || []).some((m) => m.type === 'video');
                  const many = (p.media || []).length > 1;
                  return (
                    <div key={p.id} role="radio" tabIndex={0} aria-checked={ad.postId === p.id} className={`post ${ad.postId === p.id ? 'on' : ''}`} onClick={pick} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } }}>
                      <span className="thumb" style={{ backgroundImage: p.image ? `url("${p.image}")` : undefined }}>
                        {isVideo || many ? (
                          <button type="button" className="play-chip" onClick={(e) => { e.stopPropagation(); setPlaying(p); }} aria-label={isVideo ? 'Play video' : 'View all items'}>
                            {isVideo ? <><Play size={12} fill="#fff" color="#fff" /> Play</> : `View ${p.media!.length}`}
                          </button>
                        ) : null}
                      </span>
                      <span className="cap">{p.text ? p.text.slice(0, 70) : 'No caption'}</span>
                      <span className="when">{p.time ? new Date(p.time).toLocaleDateString('en-IN') : ''}{p.type === 'REELS' ? ' · Reel' : isVideo ? ' · Video' : many ? ' · Carousel' : ''}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </Field>
        </>
      )}

      <details className="adv">
        <summary>Advanced · tracking</summary>
        <TrackingFields form={form} setAd={setAd} hint="Added to the ad's link." />
      </details>

      {playing?.media?.length ? <MediaModal media={playing.media} caption={playing.text} onClose={() => setPlaying(null)} /> : null}
    </div>
  );
}
