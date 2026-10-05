// Small creative thumbnail used wherever an individual ad is shown in a
// table. Falls back to a blank placeholder block when Facebook has no
// thumbnail_url for that ad (e.g. certain ad formats, or deleted creatives).
export default function Thumb({ src, size = 28 }) {
  if (!src) {
    return (
      <span
        style={{
          width: size,
          height: size,
          borderRadius: 4,
          background: "var(--card2)",
          display: "inline-block",
          flexShrink: 0,
        }}
      />
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      style={{ borderRadius: 4, objectFit: "cover", flexShrink: 0 }}
    />
  );
}
