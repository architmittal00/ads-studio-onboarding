import { useEffect } from "react";

// Fullscreen preview for a single creative. Plays video ads (using the
// direct source URL resolved server-side from the creative's video_id)
// instead of just showing their static thumbnail; falls back to the
// thumbnail/image for everything else.
export default function CreativeLightbox({ item, onClose }) {
  useEffect(() => {
    if (!item) return;
    function handleKey(e) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [item, onClose]);

  if (!item) return null;

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

        {item.isVideo && item.videoUrl ? (
          <video
            src={item.videoUrl}
            controls
            autoPlay
            style={{ maxWidth: "92vw", maxHeight: "78vh", borderRadius: 10, background: "#000" }}
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

        {item.isVideo && !item.videoUrl && (
          <p style={{ color: "rgba(255,255,255,.6)", fontSize: 12 }}>
            Video preview unavailable — showing thumbnail only.
          </p>
        )}

        <p style={{ color: "#fff", fontSize: 13, fontWeight: 600, textAlign: "center", maxWidth: "80vw" }}>
          {item.name}
        </p>
      </div>
    </div>
  );
}
