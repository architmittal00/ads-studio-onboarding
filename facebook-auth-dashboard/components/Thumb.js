import styles from "@/styles/Home.module.css";

// Small creative thumbnail used wherever an individual ad is shown in a
// table. Falls back to a blank placeholder block when Facebook has no
// thumbnail_url for that ad (e.g. certain ad formats, or deleted creatives).
// `loading` renders that same placeholder with a small spinner instead — the
// ad's own metrics are already on screen, its thumbnail is still being
// fetched in the background (see pages/explore.js's loadThumbnailsForView()),
// and this is what tells the difference apart from "no creative" at a
// glance. When `onClick` is given, the thumbnail becomes a button that opens
// the full creative (see CreativeLightbox); `isVideo` overlays a small play
// icon so it's clear up front that clicking it will play a video.
export default function Thumb({ src, size = 28, isVideo = false, loading = false, onClick }) {
  const content = loading ? (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: 4,
        background: "var(--card2)",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <span className={`${styles.spinner} ${styles.spinnerSm}`} />
    </span>
  ) : !src ? (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: 4,
        background: "var(--card2)",
        display: "inline-block",
      }}
    />
  ) : (
    <span style={{ position: "relative", display: "inline-flex", width: size, height: size }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" width={size} height={size} style={{ borderRadius: 4, objectFit: "cover" }} />
      {isVideo && (
        <span
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(0,0,0,.35)",
            borderRadius: 4,
          }}
        >
          <span
            style={{
              width: 0,
              height: 0,
              borderTop: `${size * 0.14}px solid transparent`,
              borderBottom: `${size * 0.14}px solid transparent`,
              borderLeft: `${size * 0.22}px solid #fff`,
              marginLeft: 2,
            }}
          />
        </span>
      )}
    </span>
  );

  // Not yet clickable while loading — there's no creative to preview until
  // the background fetch resolves, same as the `!onClick` case below.
  if (!onClick || loading) {
    return <span style={{ flexShrink: 0 }}>{content}</span>;
  }

  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        flexShrink: 0,
        padding: 0,
        border: "none",
        background: "none",
        cursor: "pointer",
        lineHeight: 0,
      }}
      aria-label="View creative"
    >
      {content}
    </button>
  );
}
