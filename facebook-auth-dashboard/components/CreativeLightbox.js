import { useEffect, useState } from "react";
import { useIsMobile } from "@/lib/useIsMobile";

// Fullscreen preview for a single creative. Plays video ads using the direct
// source URL resolved server-side from the creative's video_id when that's
// available (Facebook frequently denies access to that raw file even when
// everything else about the ad is readable — see pages/api/fb/report/core.js's
// fetchVideoSources). For every other case — a video with no accessible
// source, or any image ad, whose stored `thumbnailUrl` is only a small
// cropped square, not the actual creative — this fetches a live render of
// the ad itself on demand, only once this specific item is actually opened,
// via the Ad Previews API (pages/api/fb/ad-preview.js). That endpoint
// renders the ad through Facebook's own preview tool rather than exposing a
// stored asset directly, so it isn't subject to the same per-asset access
// restrictions and shows the ad exactly as it would really appear. Falls
// back further to a "Watch on Facebook" link (video only) and finally to the
// small stored thumbnail, for the rare case even that fails.
// Mounted all the time by the pages, so the outer component renders nothing (and attaches
// no listeners) until there is an item to show.
export default function CreativeLightbox({ item, onClose }) {
  if (!item) return null;
  return <CreativeLightboxInner item={item} onClose={onClose} />;
}

function CreativeLightboxInner({ item, onClose }) {
  const isMobile = useIsMobile();
  const [preview, setPreview] = useState({ loading: false, url: null, error: null, width: null, height: null });
  // Viewport width, to scale the preview frame down to fit a phone.
  const [viewportW, setViewportW] = useState(() => (typeof window === "undefined" ? 1024 : window.innerWidth));
  useEffect(() => {
    const onResize = () => setViewportW(window.innerWidth);
    window.addEventListener("resize", onResize);
    onResize();
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    if (!item) return;
    function handleKey(e) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [item, onClose]);

  const hasNativeVideo = !!(item?.isVideo && item.videoUrl);

  useEffect(() => {
    // No setState here for the "doesn't need fetching" case — render already
    // gates every use of `preview` on `!hasNativeVideo`, so a stale value
    // from a previously-opened item can never leak into the wrong item's
    // display; the "needs fetching" branch below clears it anyway as soon as
    // a new qualifying item is opened.
    if (!item || hasNativeVideo || !item.id) return;
    let cancelled = false;
    // Kicks off an async fetch (which itself sets loading/error/result
    // state) — intentional, not a derived-state anti-pattern.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPreview({ loading: true, url: null, error: null, width: null, height: null });
    fetch(`/api/fb/ad-preview?adId=${encodeURIComponent(item.id)}&format=${isMobile ? "MOBILE_FEED_STANDARD" : "DESKTOP_FEED_STANDARD"}`)
      .then((res) => res.json())
      .then((json) => {
        if (cancelled) return;
        setPreview({ loading: false, url: json.previewUrl || null, error: json.previewUrl ? null : json.error || json.warning, width: json.width || null, height: json.height || null });
      })
      .catch((err) => {
        if (cancelled) return;
        setPreview({ loading: false, url: null, error: err.message, width: null, height: null });
      });
    return () => {
      cancelled = true;
    };
    // Only item.id (not the whole item) and hasNativeVideo should re-trigger
    // this fetch — other fields on item (caption, name, …) change the
    // display but never need a fresh preview fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id, hasNativeVideo, isMobile]);

  if (!item) return null;

  const showLivePreview = !hasNativeVideo && preview.url;
  const stillResolving = !hasNativeVideo && preview.loading;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.8)", // solid scrim: a blur re-paints the whole page behind it
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 800,
        padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "relative",
          maxWidth: "92vw",
          maxHeight: "90vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 12,
        }}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          style={{
            position: "absolute",
            top: -36,
            right: 0,
            background: "rgba(255,255,255,.08)",
            border: "1px solid rgba(255,255,255,.15)",
            color: "#fff",
            borderRadius: 8,
            width: 32,
            height: 32,
            cursor: "pointer",
            fontSize: 16,
          }}
        >
          ×
        </button>

        {hasNativeVideo ? (
          <video
            src={item.videoUrl}
            controls
            autoPlay
            style={{ maxWidth: "92vw", maxHeight: "78vh", borderRadius: 10, background: "#000" }}
          />
        ) : showLivePreview ? (
          (() => {
            // Meta lays the ad out for the iframe's natural width; shrinking the
            // iframe box with CSS only clips it. Keep the natural width and scale
            // the frame to the screen WIDTH. The reported height is only a hint —
            // the ad (video + caption + call-to-action) is often taller — so the
            // frame is as tall as the window allows and scrolls inside itself.
            const naturalW = preview.width || (isMobile ? 335 : 500);
            const availH = (typeof window === "undefined" ? 800 : window.innerHeight) - 150;
            let scale = Math.min(1, Math.max(240, viewportW - 48) / naturalW);
            // Desktop: the ad (header, caption, video, call-to-action) is taller than
            // the window on most laptops, and a mac's hidden scrollbar made it look
            // cut off. Shrink it to fit the height as well (never below 60%); the
            // reported height is only a hint, so leave 25% headroom. It still scrolls.
            if (!isMobile) {
              const hintH = (preview.height || 700) * 1.25;
              scale = Math.min(scale, Math.max(0.6, availH / hintH));
            }
            const frameH = availH / scale; // exactly fills the window; the ad scrolls inside it
            return (
              <div style={{ width: naturalW * scale, height: availH, overflow: "hidden", borderRadius: 10, background: "#fff", flexShrink: 0 }}>
                <iframe
                  src={preview.url}
                  width={naturalW}
                  height={frameH}
                  allow="autoplay; encrypted-media"
                  sandbox="allow-scripts allow-same-origin allow-popups"
                  scrolling="yes"
                  style={{ border: "none", background: "#fff", transform: `scale(${scale})`, transformOrigin: "top left", display: "block" }}
                />
              </div>
            );
          })()
        ) : item.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.thumbnailUrl}
            alt={item.name}
            style={{ maxWidth: "92vw", maxHeight: "78vh", borderRadius: 10, objectFit: "contain" }}
          />
        ) : (
          <div
            style={{
              width: 320,
              height: 320,
              borderRadius: 10,
              background: "var(--card2)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--t3)",
              fontSize: 13,
            }}
          >
            No preview available
          </div>
        )}

        {stillResolving && (
          <p style={{ color: "rgba(255,255,255,.6)", fontSize: 12, textAlign: "center" }}>Loading preview…</p>
        )}

        {!hasNativeVideo && !preview.loading && !preview.url && (
          <p style={{ color: "rgba(255,255,255,.6)", fontSize: 12, textAlign: "center" }}>
            Live preview unavailable — showing thumbnail only
            {item.videoPermalink ? (
              <>
                {". "}
                <a
                  href={item.videoPermalink}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  style={{ color: "#b9a6ff" }}
                >
                  Watch on Facebook ↗
                </a>
              </>
            ) : (
              "."
            )}
          </p>
        )}

        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, maxWidth: "80vw" }}>
          <p style={{ color: "#fff", fontSize: 13, fontWeight: 600, textAlign: "center" }}>{item.name}</p>

          {item.caption && (
            <p
              style={{
                color: "rgba(255,255,255,.75)",
                fontSize: 12,
                textAlign: "center",
                maxWidth: 480,
                maxHeight: 90,
                overflowY: "auto",
                whiteSpace: "pre-wrap",
              }}
            >
              {item.caption}
            </p>
          )}

          {(item.ctaLabel || item.landingUrl) && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
              {item.ctaLabel && (
                <span
                  style={{
                    background: "rgba(255,255,255,.12)",
                    border: "1px solid rgba(255,255,255,.2)",
                    color: "#fff",
                    borderRadius: 6,
                    padding: "3px 10px",
                    fontSize: 11,
                    fontWeight: 600,
                  }}
                >
                  {item.ctaLabel}
                </span>
              )}
              {item.landingUrl && (
                <a
                  href={item.landingUrl}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    color: "#b9a6ff",
                    fontSize: 12,
                    maxWidth: 400,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {item.landingUrl}
                </a>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
