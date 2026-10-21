import { useEffect, useRef } from "react";

let scriptPromise = null;
function loadInstagramEmbedScript() {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.instgrm) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://www.instagram.com/embed.js";
    script.async = true;
    script.onload = resolve;
    script.onerror = reject;
    document.body.appendChild(script);
  });
  return scriptPromise;
}

// Renders Instagram's own native embed widget (real play controls, real
// video playback) from oEmbed's `html` — the fallback preview for content
// where the direct media lookup (lib/partnershipAds.js's fetchContentPreview)
// didn't resolve a raw `media_url`. Instagram's own embed.js owns playback
// entirely here — this cannot force autoplay or mute the way a plain
// `<video muted autoPlay>` tag can, since there's no raw video file to
// attach one to; this is a one-at-a-time preview (Explore's Details modal,
// Partnership Code's preview modal), not used in the Explore grid itself —
// loading many of Instagram's own live embeds at once isn't advisable.
export default function InstagramEmbed({ html }) {
  const containerRef = useRef(null);

  useEffect(() => {
    if (!html) return undefined;
    let cancelled = false;
    loadInstagramEmbedScript().then(() => {
      if (!cancelled) window.instgrm?.Embeds?.process();
    });
    return () => {
      cancelled = true;
    };
  }, [html]);

  if (!html) return null;
  return (
    <div
      ref={containerRef}
      style={{ width: "100%", display: "flex", justifyContent: "center" }}
      // html is from Meta's own Graph API oEmbed response for our own
      // authenticated session, not arbitrary user input.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
