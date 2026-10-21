import { useContentPreview } from "./useContentPreview";
import InstagramEmbed from "./InstagramEmbed";

const FILL_STYLE = { position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", display: "block" };

function Placeholder({ isVideo, loading, size }) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "linear-gradient(135deg, rgba(var(--purple-rgb),0.18), rgba(244,52,157,0.12))",
      }}
    >
      <span style={{ fontSize: size, opacity: 0.6 }}>{loading ? "…" : isVideo ? "▶" : "🖼"}</span>
    </div>
  );
}

// The actual preview for one piece of Content Discovery content — fills
// whatever `position: relative` container it's rendered inside (same
// contract the old static placeholder had: absolutely-fill the parent). See
// lib/partnershipAds.js's fetchContentPreview for what `data.kind` means and
// why neither resolution mechanism is guaranteed to succeed.
//
// `variant` only changes the oEmbed-fallback-video case:
// - "card" (many items on screen at once — Explore's grid, the queue list,
//   the launch wizard's review list): a static thumbnail + a play badge,
//   never a live Instagram embed — loading dozens of Instagram's own embed
//   widgets simultaneously isn't something this app forces.
// - "detail" (one item at a time — Explore's Details modal, Partnership
//   Code's preview modal): the real native Instagram embed (its own play
//   controls), since there's only ever one of these on screen.
// A resolved `media_url` (the "direct" mechanism) always renders as a real
// `<video muted autoPlay loop playsInline>` or `<img>` regardless of
// variant — that's the one case where this app actually controls playback
// itself.
export default function ContentPreviewMedia({ contentId, permalink, mediaType, variant = "card" }) {
  const { data, loading } = useContentPreview(contentId, permalink);
  const isVideo = mediaType === "VIDEO";
  const placeholderSize = variant === "card" ? 26 : 36;

  if (!data) return <Placeholder isVideo={isVideo} loading={loading} size={placeholderSize} />;

  if (data.kind === "direct" && data.mediaUrl) {
    const resolvedIsVideo = (data.mediaType || mediaType) === "VIDEO";
    if (resolvedIsVideo) {
      return <video style={FILL_STYLE} src={data.mediaUrl} poster={data.thumbnailUrl || undefined} muted autoPlay loop playsInline />;
    }
    // eslint-disable-next-line @next/next/no-img-element -- a real Meta-hosted media_url, not something next/image's remote-domain config covers
    return <img style={FILL_STYLE} src={data.mediaUrl} alt="" />;
  }

  // oEmbed fallback (data.kind === "oembed") — a static thumbnail for
  // photos (it IS the actual photo), or for videos either the real native
  // embed (variant "detail") or a thumbnail + play badge (variant "card").
  if (!isVideo) {
    // eslint-disable-next-line @next/next/no-img-element
    return data.thumbnailUrl ? <img style={FILL_STYLE} src={data.thumbnailUrl} alt="" /> : <Placeholder isVideo={false} loading={false} size={placeholderSize} />;
  }
  if (variant === "detail" && data.html) {
    return (
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", overflow: "auto", background: "#000" }}>
        <InstagramEmbed html={data.html} />
      </div>
    );
  }
  if (data.thumbnailUrl) {
    return (
      <>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img style={FILL_STYLE} src={data.thumbnailUrl} alt="" />
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(0,0,0,.25)",
          }}
        >
          <span style={{ fontSize: placeholderSize, color: "#fff" }}>▶</span>
        </div>
      </>
    );
  }
  return <Placeholder isVideo loading={false} size={placeholderSize} />;
}
