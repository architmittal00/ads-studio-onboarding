'use client';
import { Check, FolderOpen, ImagePlus, Plus, RefreshCw, Trash2, Upload } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { apiGet, apiPost, apiPostBytes, errorText } from '@/launch-ad/lib/client-api';
import { driveConfigured, pickFromDrive } from '@/launch-ad/lib/google-drive';
import type { FormState } from '@/launch-ad/lib/types';
import { startProxy } from '@/launch-ad/lib/video-proxy';
import { Field } from './ui';

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

type Slot = 'main' | 'story';
type Ad = FormState['ad'];

/** The media fields of the main upload, or of the separate Stories / Reels one (same fields, `story` prefix). */
function mediaOf(ad: Ad, slot: Slot) {
  return slot === 'main'
    ? { imageHash: ad.imageHash, imageUrl: ad.imageUrl, imageName: ad.imageName, videoId: ad.videoId, videoStatus: ad.videoStatus, videoUrl: ad.videoUrl }
    : { imageHash: ad.storyImageHash, imageUrl: ad.storyImageUrl, imageName: ad.storyImageName, videoId: ad.storyVideoId, videoStatus: ad.storyVideoStatus, videoUrl: ad.storyVideoUrl };
}
type Media = ReturnType<typeof mediaOf>;

/** Writes media fields for a slot: for `story` they are stored under the `story…` names. */
function setMedia(setAd: (p: Partial<Ad>) => void, slot: Slot, patch: Partial<Media>) {
  if (slot === 'main') { setAd(patch as Partial<Ad>); return; }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) out[`story${k[0].toUpperCase()}${k.slice(1)}`] = v;
  setAd(out as Partial<Ad>);
}

/** Everything one image / video upload box needs: the upload itself, Meta's video processing check, Google Drive. */
export function useMediaUpload(slot: Slot, ad: Ad, setAd: (p: Partial<Ad>) => void, accountId: string, aiVideo: boolean) {
  const m = mediaOf(ad, slot);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [progress, setProgress] = useState(0);
  const [procPct, setProcPct] = useState<number | null>(null);
  const [drivePct, setDrivePct] = useState<number | null>(null);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const checkNow = useRef<() => void>(() => undefined);
  const put = (patch: Partial<Media>) => setMedia(setAd, slot, patch);
  const empty = { videoStatus: '' as const, videoId: '', videoUrl: '', imageHash: '', imageUrl: '', imageName: '' };

  // Meta processes an uploaded video before it can be used; check until it's ready.
  // A request that never answers can't stall the checks, coming back to the tab checks at once
  // (background tabs run timers slowly), and "Check now" does it on demand.
  useEffect(() => {
    if (!m.videoId || m.videoStatus !== 'processing') return;
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
        const s = await withTimeout(apiGet<{ status: string; progress: number | null }>('video-status', { video: m.videoId }), 15000);
        if (stop) return;
        if (typeof s.progress === 'number') setProcPct(Math.max(0, Math.min(100, Math.round(s.progress))));
        if (s.status === 'ready') { put({ videoStatus: 'ready' }); return; }
        if (s.status === 'error') { put({ videoStatus: 'error' }); return; }
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
  }, [m.videoId, m.videoStatus]);

  const onVideo = async (file: File) => {
    if (file.size > MAX_VIDEO) { setUploadError('Video must be under 1 GB.'); return; }
    const local = URL.createObjectURL(file);
    setProgress(0);
    setProcPct(null);
    put({ videoStatus: 'uploading', videoUrl: local, videoId: '', imageHash: '', imageUrl: '', imageName: file.name });
    // While the video uploads, the browser makes a small copy of it for the AI (only when AI writing is set up).
    if (slot === 'main' && aiVideo) startProxy(local, local);
    try {
      const thumb = await frameOf(local);
      const img = await apiPost<{ hash: string; url: string }>('upload-image', { account: accountId, name: `${file.name}-thumbnail.jpg`, bytes: thumb.split(',')[1] });
      put({ imageHash: img.hash, imageUrl: thumb });
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
      put({ videoId: s.video_id, videoStatus: 'processing' });
    } catch (e) {
      setUploadError(errorText(e));
      put(empty);
    }
  };

  const onFile = async (file?: File) => {
    if (!file) return;
    setUploadError('');
    setDims(await measure(file));
    if (/^video\/(mp4|quicktime)$/.test(file.type)) { await onVideo(file); return; }
    if (!/^image\/(jpeg|png)$/.test(file.type)) { setUploadError('Use a JPG or PNG image, or an MP4 or MOV video.'); return; }
    if (file.size > MAX_BYTES) { setUploadError('Image must be under 3 MB.'); return; }
    setUploading(true);
    try {
      const dataUrl: string = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(new Error('Could not read the file')); r.readAsDataURL(file); });
      const bytes = dataUrl.split(',')[1];
      const img = await apiPost<{ hash: string; url: string }>('upload-image', { account: accountId, name: file.name, bytes });
      put({ imageHash: img.hash, imageUrl: dataUrl, imageName: file.name, videoId: '', videoStatus: '', videoUrl: '' });
    } catch (e) {
      setUploadError(errorText(e));
    } finally {
      setUploading(false);
    }
  };

  // Picks a file from Google Drive and sends it through the same checks and upload as a file from the computer.
  const onDrive = async () => {
    setUploadError('');
    setDrivePct(0);
    try {
      const file = await pickFromDrive('image/jpeg,image/png,video/mp4,video/quicktime', (d) => {
        if (/^video\//.test(d.mimeType)) return d.sizeBytes > MAX_VIDEO ? 'Video must be under 1 GB.' : null;
        return d.sizeBytes > MAX_BYTES ? 'Image must be under 3 MB.' : null;
      }, setDrivePct);
      setDrivePct(null);
      await onFile(file || undefined);
    } catch (e) {
      setDrivePct(null);
      setUploadError(errorText(e));
    }
  };

  const clear = () => { setUploadError(''); setDims(null); put(empty); };
  return { m, uploading, uploadError, progress, procPct, drivePct, dims, checkNow, onFile, onDrive, clear };
}


/** Width and height of an image or video file (null if the browser can't read it). */
async function measure(file: File): Promise<{ w: number; h: number } | null> {
  try {
    if (file.type.startsWith('video/')) {
      const url = URL.createObjectURL(file);
      return await new Promise((res) => {
        const v = document.createElement('video');
        v.preload = 'metadata';
        v.onloadedmetadata = () => { res({ w: v.videoWidth, h: v.videoHeight }); URL.revokeObjectURL(url); };
        v.onerror = () => { res(null); URL.revokeObjectURL(url); };
        v.src = url;
      });
    }
    const bmp = await createImageBitmap(file);
    const r = { w: bmp.width, h: bmp.height };
    bmp.close();
    return r;
  } catch { return null; }
}

type Upload = ReturnType<typeof useMediaUpload>;

/* ── Aspect ratios and where each one is shown ── */

type Ratio = Ad['ratio'];
const RATIOS: { key: Ratio; name: string; value: number; shows: string; size: string }[] = [
  { key: '1:1', name: 'Square', value: 1, shows: 'Feed, Explore, Marketplace', size: '1080 × 1080' },
  { key: '4:5', name: 'Portrait', value: 4 / 5, shows: 'Feed (fills more of the screen on mobile)', size: '1080 × 1350' },
  { key: '9:16', name: 'Vertical', value: 9 / 16, shows: 'Stories and Reels', size: '1080 × 1920' },
  { key: '16:9', name: 'Landscape', value: 16 / 9, shows: 'Feed video, in-stream', size: '1920 × 1080' },
];
const ratioInfo = (k: Ratio) => RATIOS.find((r) => r.key === k) || RATIOS[0];
/** The closest of our ratios to a real width and height, if it is within a few percent of one. */
function nearestRatio(d: { w: number; h: number }): Ratio | null {
  const v = d.w / d.h;
  const hit = RATIOS.find((r) => Math.abs(v - r.value) / r.value < 0.04);
  return hit ? hit.key : null;
}

/** A small outline in the shape of the ratio. */
function RatioShape({ ratio, size = 22 }: { ratio: Ratio; size?: number }) {
  const v = ratioInfo(ratio).value;
  const w = v >= 1 ? size : Math.round(size * v);
  const h = v >= 1 ? Math.round(size / v) : size;
  return <span className="ratio-shape" style={{ width: w, height: h }} aria-hidden />;
}

function RatioPicker({ value, options, onChange }: { value: Ratio; options: Ratio[]; onChange: (r: Ratio) => void }) {
  return (
    <div className="ratio-row" role="radiogroup" aria-label="Aspect ratio">
      {options.map((k) => {
        const r = ratioInfo(k);
        return (
          <button key={k} type="button" role="radio" aria-checked={value === k} className={`ratio-chip ${value === k ? 'on' : ''}`} onClick={() => onChange(k)} title={`${r.name} ${k}, ${r.size}`}>
            <RatioShape ratio={k} />
            <span className="rc-name">{r.name}</span>
            <span className="rc-ratio">{k}</span>
          </button>
        );
      })}
    </div>
  );
}

/** One size of the ad's media: choose the ratio, then add the file from the computer or Google Drive. */
function MediaSlot({ u, ratio, options, onRatio, title, hint, onRemove }: {
  u: Upload; ratio: Ratio; options: Ratio[]; onRatio: (r: Ratio) => void; title: string; hint: string; onRemove?: () => void;
}) {
  const { m } = u;
  const info = ratioInfo(ratio);
  const has = !!(m.imageUrl || m.imageHash || m.videoId);
  const busy = u.uploading || m.videoStatus === 'uploading';
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const found = u.dims ? nearestRatio(u.dims) : null;
  const mismatch = has && u.dims && found !== ratio;
  const pickFile = (f?: File) => { if (f) u.onFile(f); };

  return (
    <div className="mslot">
      <div className="mslot-head">
        <span className="mslot-title">{title}</span>
        <span className="hint" style={{ margin: 0 }}>{hint}</span>
        {onRemove ? <button type="button" className="icon-btn" onClick={onRemove} title="Remove this size" aria-label="Remove this size"><Trash2 size={14} /></button> : null}
      </div>

      <RatioPicker value={ratio} options={options} onChange={onRatio} />
      <div className="hint ratio-shows">{info.shows} · {info.size}</div>

      <input ref={input} type="file" accept="image/jpeg,image/png,video/mp4,video/quicktime" style={{ display: 'none' }} disabled={busy} onChange={(e) => { pickFile(e.target.files?.[0]); e.target.value = ''; }} />

      {has ? (
        <div className="mslot-file">
          <span className="mslot-thumb" style={{ aspectRatio: `${info.value}`, backgroundImage: m.imageUrl ? `url("${m.imageUrl}")` : undefined }}>
            {!m.imageUrl ? <ImagePlus size={18} /> : null}
          </span>
          <div className="mslot-meta">
            <div className="mslot-name" title={m.imageName}>{m.imageName || 'Uploaded'}</div>
            <div className="hint" style={{ margin: 0 }}>
              {u.uploading ? 'Uploading image to Meta…'
                : m.videoStatus === 'uploading' ? `Uploading video to Meta… ${Math.round(u.progress * 100)}%`
                : m.videoStatus === 'processing' ? `Meta is processing the video${u.procPct ? `: ${u.procPct}%` : ''}`
                : m.videoStatus === 'ready' ? 'Video ready on Meta'
                : m.videoStatus === 'error' ? 'Meta couldn’t process this video'
                : <span className="ok-line"><Check size={12} /> Uploaded to Meta{u.dims ? ` · ${u.dims.w} × ${u.dims.h}` : ''}</span>}
            </div>
            <div className="mslot-actions">
              <button type="button" className="btn-ghost sm" disabled={busy} onClick={() => input.current?.click()}><RefreshCw size={13} /> Replace</button>
              {driveConfigured() ? <button type="button" className="btn-ghost sm" disabled={busy || u.drivePct !== null} onClick={u.onDrive}><FolderOpen size={13} /> {u.drivePct !== null ? `${Math.round(u.drivePct * 100)}%` : 'Google Drive'}</button> : null}
              {m.videoStatus === 'processing' ? <button type="button" className="btn-link" onClick={() => u.checkNow.current()}>Check now</button> : null}
            </div>
          </div>
        </div>
      ) : (
        <div
          className={`mslot-drop ${over ? 'over' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); pickFile(e.dataTransfer.files?.[0]); }}
        >
          <span className="drop-icon"><Upload size={20} strokeWidth={1.8} /></span>
          <div className="drop-text">
            <b>Add your {ratio} image or video</b>
            <span className="hint" style={{ margin: 0 }}>Drag it here, or choose where it comes from. Image: JPG or PNG under 3 MB. Video: MP4 or MOV up to 1 GB.</span>
          </div>
          <div className="drop-actions">
            <button type="button" className="btn-ghost" disabled={busy} onClick={() => input.current?.click()}><Upload size={14} /> From your computer</button>
            {driveConfigured() ? (
              <button type="button" className="btn-ghost" disabled={busy || u.drivePct !== null} onClick={u.onDrive}>
                <FolderOpen size={14} /> {u.drivePct !== null ? `Fetching… ${Math.round(u.drivePct * 100)}%` : 'From Google Drive'}
              </button>
            ) : null}
          </div>
        </div>
      )}

      {m.videoStatus === 'uploading' ? <div className="progress" aria-label="Upload progress"><i style={{ width: `${Math.round(u.progress * 100)}%` }} /></div> : null}
      {m.videoStatus === 'error' ? <div className="notice bad" style={{ marginTop: 8 }}>Meta couldn&apos;t process this video. Upload a different file.</div> : null}
      {mismatch ? (
        <div className="notice warn" style={{ marginTop: 8 }}>
          This file is {found ? <b>{found}</b> : <b>{u.dims!.w} × {u.dims!.h}</b>}, not {ratio}. Meta may crop it.
          {found && options.includes(found) ? <> <button type="button" className="btn-link" onClick={() => onRatio(found)}>Use {found} instead</button></> : null}
        </div>
      ) : null}
      {u.uploadError ? <div className="notice bad" style={{ marginTop: 8 }}>{u.uploadError}</div> : null}
    </div>
  );
}

/**
 * The ad's image or video, with up to two sizes. The first size is shown everywhere; a second one adds a different
 * size where it fits better: a vertical 9:16 for Stories and Reels next to a Feed size, or (when the first is
 * vertical) a Feed size for everything else.
 */
export default function AdMediaSection({ ad, setAd, accountId, aiVideo, openDrive = 0 }: {
  ad: Ad;
  setAd: (p: Partial<Ad>) => void;
  accountId: string;
  aiVideo: boolean;
  /** Changes each time the "From Google Drive" card is clicked: opens Drive's picker for the first size */
  openDrive?: number;
}) {
  const main = useMediaUpload('main', ad, setAd, accountId, aiVideo);
  const extra = useMediaUpload('story', ad, setAd, accountId, false);
  const [extraOpen, setExtraOpen] = useState(false);
  const hasExtra = extraOpen || !!(extra.m.imageHash || extra.m.videoId);

  const openDriveRef = useRef(0);
  useEffect(() => {
    if (openDrive > openDriveRef.current && driveConfigured()) main.onDrive();
    openDriveRef.current = openDrive;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openDrive]);

  // The second size must differ in where it is shown: vertical next to a non-vertical one, or a Feed size next to a vertical.
  const extraOptions: Ratio[] = ad.ratio === '9:16' ? ['1:1', '4:5'] : ['9:16'];
  const setMainRatio = (r: Ratio) => {
    const patch: Partial<Ad> = { ratio: r };
    if (r === '9:16' && ad.storyRatio === '9:16') patch.storyRatio = '1:1';
    if (r !== '9:16' && ad.storyRatio !== '9:16') patch.storyRatio = '9:16';
    setAd(patch);
  };

  return (
    <Field label="Image or video">
      <MediaSlot
        u={main} ratio={ad.ratio} options={['1:1', '4:5', '9:16', '16:9']} onRatio={setMainRatio}
        title={hasExtra ? 'Main size' : 'Size'}
        hint={hasExtra ? 'Shown everywhere the other size isn’t.' : 'Shown in every placement. 1:1 or 4:5 works across Feed, Stories and Reels.'}
      />
      {hasExtra ? (
        <MediaSlot
          u={extra} ratio={ad.storyRatio} options={extraOptions} onRatio={(r) => setAd({ storyRatio: r })}
          title={ad.storyRatio === '9:16' ? 'Stories and Reels' : 'Feed and other placements'}
          hint={ad.storyRatio === '9:16' ? 'Shown in Stories and Reels (Facebook and Instagram).' : 'Shown in Feed and the rest; the vertical media above is used in Stories and Reels.'}
          onRemove={() => { extra.clear(); setExtraOpen(false); }}
        />
      ) : (
        <button type="button" className="btn-ghost add-size" onClick={() => { setAd({ storyRatio: ad.ratio === '9:16' ? '1:1' : '9:16' }); setExtraOpen(true); }}>
          <Plus size={14} /> {ad.ratio === '9:16' ? 'Add a Feed size' : 'Add a vertical 9:16 for Stories and Reels'}
        </button>
      )}
    </Field>
  );
}
