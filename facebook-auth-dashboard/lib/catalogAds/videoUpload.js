import { useEffect, useRef } from "react";
import { fetchWithTimeout, parseJsonResponse } from "@/lib/fetchJson";

// Chunked video upload to Meta's resumable-upload API, plus a thumbnail
// frame grabbed client-side — ported from sr-ads-launch's
// StandardAdSection.tsx (onVideo/frameOf) and its own processing-status
// poll effect. The browser-made low-resolution copy that app also made (to
// let its AI writing feature watch a video before Meta finished processing
// it) is not ported — AI copy here only supports images (see
// components/catalogads/AiCopyBox.js).

export const MAX_VIDEO_BYTES = 1_000_000_000;
// Each piece goes through this app's own server, which (like Vercel) caps a
// single request body well under this.
const CHUNK_BYTES = 3_500_000;

// A JPEG frame from about a third of the way into the video — Meta needs a
// thumbnail image for every video ad.
export function extractVideoFrame(objectUrl) {
  return new Promise((resolve, reject) => {
    const v = document.createElement("video");
    v.muted = true;
    v.playsInline = true;
    v.preload = "auto";
    v.src = objectUrl;
    v.onloadeddata = () => {
      v.currentTime = Math.min(1, (v.duration || 3) / 3);
    };
    v.onseeked = () => {
      const scale = Math.min(1, 1280 / Math.max(v.videoWidth || 1, v.videoHeight || 1));
      const c = document.createElement("canvas");
      c.width = Math.round((v.videoWidth || 640) * scale);
      c.height = Math.round((v.videoHeight || 640) * scale);
      c.getContext("2d")?.drawImage(v, 0, 0, c.width, c.height);
      resolve(c.toDataURL("image/jpeg", 0.85));
    };
    v.onerror = () => reject(new Error("This video can't be read in the browser. Use an MP4 (H.264) or MOV file."));
  });
}

async function postJson(path, body) {
  const res = await fetchWithTimeout(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await parseJsonResponse(res);
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json;
}

// Uploads a video in CHUNK_BYTES pieces via a resumable session, plus its
// thumbnail (a video ad needs a still image — see buildStandardCreativeParams
// in lib/catalogAds/launch.js). `onProgress(fraction)` fires after each chunk.
export async function uploadVideoToMeta(file, accountId, onProgress) {
  if (file.size > MAX_VIDEO_BYTES) throw new Error("Video must be under 1 GB.");
  const objectUrl = URL.createObjectURL(file);
  try {
    const thumbDataUrl = await extractVideoFrame(objectUrl);
    const thumb = await postJson("/api/fb/catalog-ads/upload-image", {
      accountId,
      name: `${file.name}-thumbnail.jpg`,
      bytes: thumbDataUrl.split(",")[1],
    });

    const start = await postJson("/api/fb/catalog-ads/upload-video", { accountId, phase: "start", size: file.size });
    let offset = Number(start.start_offset);
    let end = Number(start.end_offset);
    while (offset < end) {
      const stopAt = Math.min(end, offset + CHUNK_BYTES);
      const res = await fetchWithTimeout(
        `/api/fb/catalog-ads/upload-video-chunk?accountId=${encodeURIComponent(accountId)}&session=${encodeURIComponent(start.upload_session_id)}&offset=${offset}`,
        { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: file.slice(offset, stopAt) }
      );
      const chunkResult = await parseJsonResponse(res);
      if (!res.ok) throw new Error(chunkResult.error || `Request failed (${res.status})`);
      offset = Number(chunkResult.start_offset);
      end = Number(chunkResult.end_offset);
      onProgress?.(Math.min(1, offset / file.size));
    }
    await postJson("/api/fb/catalog-ads/upload-video", { accountId, phase: "finish", session: start.upload_session_id, name: file.name });

    return { videoId: start.video_id, imageHash: thumb.hash, imageUrl: thumbDataUrl };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

const POLL_TIMEOUT_MS = 15 * 60_000;

// Polls /api/fb/catalog-ads/video-status until Meta finishes processing a
// just-uploaded video, re-checking immediately when the tab regains focus/
// visibility/connectivity (a background tab's timers run slowly, so without
// this a user switching back to the tab could wait a while before seeing a
// video that actually finished minutes ago). Returns a `checkNow()` you can
// wire to a manual "Check now" button.
export function useVideoProcessingPoll(videoId, videoStatus, onStatus) {
  const checkNowRef = useRef(() => undefined);
  // A ref, not a dependency: `onStatus` is an inline callback at every call
  // site, so depending on it directly would tear down and restart the whole
  // poll loop (losing its backoff/elapsed-time state) on every render.
  const onStatusRef = useRef(onStatus);
  useEffect(() => {
    onStatusRef.current = onStatus;
  }, [onStatus]);

  useEffect(() => {
    if (!videoId || videoStatus !== "processing") return undefined;
    let stopped = false;
    let busy = false;
    let timer;
    const startedAt = Date.now();

    async function check() {
      if (stopped || busy) return;
      busy = true;
      clearTimeout(timer);
      try {
        const res = await fetchWithTimeout(`/api/fb/catalog-ads/video-status?videoId=${encodeURIComponent(videoId)}`, {}, 15000);
        const json = await parseJsonResponse(res);
        if (stopped) return;
        if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
        if (typeof json.progress === "number") onStatusRef.current({ progress: Math.max(0, Math.min(100, Math.round(json.progress))) });
        if (json.status === "ready") {
          onStatusRef.current({ status: "ready" });
          return;
        }
        if (json.status === "error") {
          onStatusRef.current({ status: "error" });
          return;
        }
      } catch {
        // try again on the next tick
      } finally {
        busy = false;
      }
      if (!stopped && Date.now() - startedAt < POLL_TIMEOUT_MS) {
        timer = setTimeout(check, Date.now() - startedAt < 20_000 ? 2000 : 4000);
      }
    }

    checkNowRef.current = check;
    timer = setTimeout(check, 2000);
    const wake = () => {
      if (document.visibilityState === "visible") check();
    };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("focus", wake);
    window.addEventListener("online", wake);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("focus", wake);
      window.removeEventListener("online", wake);
    };
  }, [videoId, videoStatus]);

  return checkNowRef;
}
