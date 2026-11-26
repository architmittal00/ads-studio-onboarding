// The Fastrr Sentinel logo: Fastrr's own "fastrr" wordmark and purple mark, with "Sentinel" set underneath where the
// original logo says "Ads". The wordmark is a PNG used as a mask and painted with the theme's text colour, so it stays
// readable in dark mode (the original artwork is black); the purple mark keeps its own colour. Positions are the original
// 437 x 239 artwork scaled to `width`. `markOnly` is the purple mark alone, for the collapsed sidebar.
const ART_W = 437;
const ART_H = 239;

export default function FastrrSentinelLogo({ width = 120, markOnly = false }) {
  if (markOnly) {
    // eslint-disable-next-line @next/next/no-img-element -- a small fixed brand asset
    return <img src="/brand/fastrr-mark.png" alt="Fastrr Sentinel" style={{ width, height: "auto", display: "block", flex: "none" }} />;
  }
  const k = width / ART_W;
  const px = (v) => `${(v * k).toFixed(2)}px`;
  const word = "url(/brand/fastrr-word.png)";
  return (
    <div role="img" aria-label="Fastrr Sentinel" style={{ position: "relative", width, height: ART_H * k, flex: "none" }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- a small fixed brand asset */}
      <img src="/brand/fastrr-mark.png" alt="" style={{ position: "absolute", left: 0, top: px(69), width: px(83), height: px(43) }} />
      <span
        aria-hidden
        style={{ position: "absolute", left: px(93), top: px(32), width: px(344), height: px(96), background: "var(--t1)", WebkitMaskImage: word, maskImage: word, WebkitMaskSize: "100% 100%", maskSize: "100% 100%", WebkitMaskRepeat: "no-repeat", maskRepeat: "no-repeat" }}
      />
      <span aria-hidden style={{ position: "absolute", left: px(93), top: px(150), fontSize: px(70), lineHeight: 1, fontWeight: 600, letterSpacing: "-0.01em", color: "var(--t1)", whiteSpace: "nowrap" }}>
        Sentinel
      </span>
    </div>
  );
}
