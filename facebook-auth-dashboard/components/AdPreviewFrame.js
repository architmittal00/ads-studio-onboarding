import { useEffect, useRef, useState } from "react";
import { useIsMobile } from "@/lib/useIsMobile";
import styles from "@/styles/Home.module.css";

// Inline live preview of one ad (Meta's Ad Previews API rendered in an iframe).
// Meta lays the ad out for the frame's natural width (500px desktop feed,
// ~335px mobile feed); shrinking the iframe BOX with CSS only clips it, so the
// natural width is kept and the whole frame is scaled to the container. The
// frame is taller than the width suggests (video + caption + call-to-action)
// and scrolls inside itself, so nothing is cut off.
export default function AdPreviewFrame({ adId, height = 560 }) {
  const isMobile = useIsMobile();
  const wrapRef = useRef(null);
  const [width, setWidth] = useState(0);
  const [preview, setPreview] = useState({ loading: true, url: null, error: null, width: null });

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch sets its own loading/result state
    setPreview({ loading: true, url: null, error: null, width: null });
    const format = isMobile ? "MOBILE_FEED_STANDARD" : "DESKTOP_FEED_STANDARD";
    fetch(`/api/fb/ad-preview?adId=${encodeURIComponent(adId)}&format=${format}`)
      .then((res) => res.json())
      .then((json) => {
        if (cancelled) return;
        setPreview({ loading: false, url: json.previewUrl || null, error: json.previewUrl ? null : json.error || json.warning, width: json.width || null });
      })
      .catch((err) => {
        if (!cancelled) setPreview({ loading: false, url: null, error: err.message, width: null });
      });
    return () => {
      cancelled = true;
    };
  }, [adId, isMobile]);

  const naturalW = preview.width || (isMobile ? 335 : 500);
  const scale = width ? Math.min(1, width / naturalW) : 1;

  return (
    <div ref={wrapRef} style={{ width: "100%" }}>
      {preview.loading && <p className={styles.sub}>Loading preview…</p>}
      {!preview.loading && !preview.url && <p className={styles.sub}>{preview.error || "No live preview available for this ad."}</p>}
      {preview.url && width > 0 && (
        <div className={styles.dtPreviewBox} style={{ width: naturalW * scale, height }}>
          <iframe
            src={preview.url}
            width={naturalW}
            height={height / scale}
            allow="autoplay; encrypted-media"
            sandbox="allow-scripts allow-same-origin allow-popups"
            scrolling="yes"
            title="Ad preview"
            style={{ border: "none", background: "#fff", transform: `scale(${scale})`, transformOrigin: "top left", display: "block" }}
          />
        </div>
      )}
    </div>
  );
}
