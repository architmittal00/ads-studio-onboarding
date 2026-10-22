// Small circular creator avatar — falls back to the creator's first initial
// on a tinted circle when Instagram's profile_picture_url isn't available
// (no Instagram Business Account connected to enable the Business Discovery
// lookup, or the lookup itself failed — see
// pages/api/fb/partnership/mine.js's resolveCreatorAvatars for both cases,
// neither of which block seeing the creator's username at all).
export default function CreatorAvatar({ src, username, size = 24, style }) {
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={src} alt="" width={size} height={size} style={{ borderRadius: "50%", objectFit: "cover", flexShrink: 0, ...style }} />
    );
  }
  const initial = username ? username[0].toUpperCase() : "?";
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: "rgba(var(--purple-rgb), 0.15)",
        color: "var(--purple)",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: size * 0.45,
        fontWeight: 700,
        flexShrink: 0,
        ...style,
      }}
    >
      {initial}
    </span>
  );
}
