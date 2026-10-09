import { useEffect, useState } from "react";

// Fullscreen preview for a single creative. Plays video ads using the direct
// source URL resolved server-side from the creative's video_id when that's
// available; Facebook frequently denies access to that raw file even when
// everything else about the ad is readable (see pages/api/fb/report/core.js's
// fetchVideoSources), so this falls back to fetching a live render of the ad
// itself — on demand, only once this specific video is actually opened —
// via the Ad Previews API (pages/api/fb/ad-preview.js), which isn't subject
// to that same restriction since it renders the ad through Facebook's own
// preview tool rather than exposing the file. Falls back further to a
// "Watch on Facebook" link, and finally to the static thumbnail, for the
// rare case even that fails.
export default function CreativeLightbox({ item, onClose }) {
  const [preview, setPreview] = useState({ loading: false, url: null, error: null });

  useEffect(() => {
    if (!item) return;
    function handleKey(e) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [item, onClose]);

  useEffect(() => {
    // No setState here for the "doesn't need fetching" case — render already
    // gates every use of `preview` on `item.isVideo && !item.videoUrl`, so a
    // stale value from a previously-opened item can never leak into the
    // wrong item's display; the "needs fetching" branch below clears it
    // anyway as soon as a new qualifying item is opened.
    if (!item?.isVideo || item.videoUrl || !item.id) return;
    let cancelled = false;
    // Kicks off an async fetch (which itself sets loading/error/result
    // state) — intentional, not a derived-state anti-pattern.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPreview({ loading: true, url: null, error: null });
    fetch(`/api/fb/ad-preview?adId=${encodeURIComponent(item.id)}`)
      .then((res) => res.json())
      .then((json) => {
        if (cancelled) return;
        setPreview({ loading: false, url: json.previewUrl || null, error: json.previewUrl ? null : json.error || json.warning });
      })
      .catch((err) => {
        if (cancelled) return;
        setPreview({ loading: false, url: null, error: err.message });
      });
    return () => {
      cancelled = true;
    };
  }, [item?.id, item?.isVideo, item?.videoUrl]);

  if (!item) return null;

  const showNativeVideo = item.isVideo && item.videoUrl;
  const showLivePreview = item.isVideo && !item.videoUrl && preview.url;
  const stillResolving = item.isVideo && !item.videoUrl && preview.loading;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.75)",
        backdropFilter: "blur(6px)",
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

        {showNativeVideo ? (
          <video
            src={item.videoUrl}
            controls
            autoPlay
            style={{ maxWidth: "92vw", maxHeight: "78vh", borderRadius: 10, background: "#000" }}
          />
        ) : showLivePreview ? (
          <iframe
            src={preview.url}
            width={500}
            height={700}
            allow="autoplay; encrypted-media"
            sandbox="allow-scripts allow-same-origin allow-popups"
            style={{ maxWidth: "92vw", maxHeight: "78vh", border: "none", borderRadius: 10, background: "#000" }}
          />
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

        {item.isVideo && !item.videoUrl && !preview.loading && !preview.url && (
          <p style={{ color: "rgba(255,255,255,.6)", fontSize: 12, textAlign: "center" }}>
            Inline preview unavailable — showing thumbnail only
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
