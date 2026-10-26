import { useSyncExternalStore } from 'react';
import { muxMp4, type Mp4Sample } from './mp4-mux';

/*
 * A small copy of the whole video, made in the browser while the original uploads, so the AI can
 * start without waiting for Meta to process the video: 2 frames a second, about 540 px on the short
 * side, no audio, a few MB at most. Frames are picked by seeking, so it takes seconds, not the video's
 * length, and works with whatever the browser can play. H.264 where the browser can encode it, else VP9.
 */

export type ProxyState = { status: 'making' | 'ready' | 'failed'; base64?: string; bytes?: number; seconds?: number; reason?: string };

const FPS = 2;
const SHORT_SIDE = 540;
const LONG_SIDE = 1024;
const MAX_SECONDS = 120;
const MAX_BYTES = 2_600_000; // stays under 4.5 MB as base64 even on hosts with small request limits

const states = new Map<string, ProxyState>();
const subs = new Set<() => void>();
let active = '';

const publish = (key: string, s: ProxyState) => { states.set(key, s); subs.forEach((f) => f()); };
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };

/** The copy being made (or made) for an upload, identified by the upload's local video URL. */
export function useProxy(key: string): ProxyState | undefined {
  return useSyncExternalStore(subscribe, () => (key ? states.get(key) : undefined), () => undefined);
}

export function startProxy(key: string, url: string): void {
  if (!key || states.has(key)) return;
  active = key;
  // Only the latest copies are kept; each can be a few MB.
  Array.from(states.keys()).slice(0, Math.max(0, states.size - 1)).forEach((k) => states.delete(k));
  publish(key, { status: 'making' });
  encodeProxy(url, () => active === key)
    .then((r) => publish(key, { status: 'ready', ...r }))
    .catch((e) => publish(key, { status: 'failed', reason: (e as Error).message }));
}

function seek(v: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => { v.removeEventListener('seeked', done); clearTimeout(timer); resolve(); };
    const timer = setTimeout(done, 4000);
    v.addEventListener('seeked', done);
    v.currentTime = t;
  });
}

const bytesOf = (d: AllowSharedBufferSource) => (ArrayBuffer.isView(d) ? new Uint8Array(d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength)) : new Uint8Array(d.slice(0)));

async function encodeProxy(url: string, alive: () => boolean): Promise<{ base64: string; bytes: number; seconds: number }> {
  if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') throw new Error('This browser can’t make the copy');

  const v = document.createElement('video');
  v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = url;
  await new Promise<void>((res, rej) => { v.onloadeddata = () => res(); v.onerror = () => rej(new Error('The video can’t be read')); });
  const seconds = Math.min(Number.isFinite(v.duration) ? v.duration : 0, MAX_SECONDS);
  if (!(seconds > 0.5) || !v.videoWidth || !v.videoHeight) throw new Error('The video can’t be read');

  const scale = Math.min(1, SHORT_SIDE / Math.min(v.videoWidth, v.videoHeight), LONG_SIDE / Math.max(v.videoWidth, v.videoHeight));
  const to16 = (n: number) => Math.max(16, Math.round(n / 16) * 16);
  const width = to16(v.videoWidth * scale); const height = to16(v.videoHeight * scale);
  const bitrate = Math.round(Math.min(800_000, Math.max(150_000, (MAX_BYTES * 8 * 0.75) / seconds)));

  let chosen: { kind: 'avc' | 'vp9'; cfg: VideoEncoderConfig } | null = null;
  for (const c of [{ codec: 'avc1.42001f', kind: 'avc' as const }, { codec: 'avc1.4d001f', kind: 'avc' as const }, { codec: 'vp09.00.31.08', kind: 'vp9' as const }]) {
    const cfg: VideoEncoderConfig = { codec: c.codec, width, height, bitrate, framerate: FPS, latencyMode: 'realtime', ...(c.kind === 'avc' ? { avc: { format: 'avc' as const } } : {}) };
    const ok = await VideoEncoder.isConfigSupported(cfg).then((s) => !!s.supported).catch(() => false);
    if (ok) { chosen = { kind: c.kind, cfg }; break; }
  }
  if (!chosen) throw new Error('This browser can’t encode video');

  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No drawing surface');

  const samples: Mp4Sample[] = [];
  let description: Uint8Array | undefined;
  let failure: Error | undefined;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => {
      const data = new Uint8Array(chunk.byteLength); chunk.copyTo(data);
      samples.push({ data, timestampUs: chunk.timestamp, key: chunk.type === 'key' });
      if (!description && meta?.decoderConfig?.description) description = bytesOf(meta.decoderConfig.description);
    },
    error: (e) => { failure = e; },
  });
  encoder.configure(chosen.cfg);

  const n = Math.max(2, Math.floor(seconds * FPS));
  for (let i = 0; i < n; i++) {
    if (!alive()) { encoder.close(); throw new Error('Replaced by another upload'); }
    if (failure) throw failure;
    await seek(v, Math.min(Math.max(0, v.duration - 0.05), i / FPS + 0.05));
    ctx.drawImage(v, 0, 0, width, height);
    const frame = new VideoFrame(canvas, { timestamp: Math.round((i * 1e6) / FPS) });
    encoder.encode(frame, { keyFrame: i % 20 === 0 });
    frame.close();
    while (encoder.encodeQueueSize > 6) await new Promise((r) => setTimeout(r, 5));
  }
  await encoder.flush();
  encoder.close();
  if (failure) throw failure;
  if (samples.length < 2) throw new Error('Nothing was encoded');

  const mp4 = muxMp4({ codec: chosen.kind, width, height, description, samples });
  if (mp4.length > MAX_BYTES * 1.2) throw new Error('The copy came out too large');
  let bin = '';
  for (let i = 0; i < mp4.length; i += 0x8000) bin += String.fromCharCode(...Array.from(mp4.subarray(i, i + 0x8000)));
  return { base64: btoa(bin), bytes: mp4.length, seconds };
}
