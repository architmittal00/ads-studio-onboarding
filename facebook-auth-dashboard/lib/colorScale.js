// The red → yellow → green scale used for conditional formatting: on screen (components/SortableTable.js) and in the
// Excel export (lib/xlsxWriter.js callers), so the file matches what the table shows. The same three colours as a
// spreadsheet's own 3-colour scale, softened — the earlier mix with the theme's amber went muddy brown and olive.
const RED = [248, 105, 107];
const YELLOW = [255, 235, 132];
const GREEN = [99, 190, 123];

const lerp = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

// t: 0 = worst … 1 = best.
export function scaleRgb(t) {
  const x = Math.min(1, Math.max(0, t));
  return x < 0.5 ? lerp(RED, YELLOW, x * 2) : lerp(YELLOW, GREEN, (x - 0.5) * 2);
}

// Translucent, so it sits on the page background in either theme; the strength is the theme's --scale-alpha.
export function scaleCss(t) {
  const [r, g, b] = scaleRgb(t);
  return `rgb(${r} ${g} ${b} / var(--scale-alpha, 0.42))`;
}

// Opaque "RRGGBB" for a spreadsheet fill: the same colour laid over white at the on-screen strength.
export function scaleHex(t, alpha = 0.55) {
  return scaleRgb(t)
    .map((v) => Math.round(v * alpha + 255 * (1 - alpha)).toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

// CSS gradient for the legend swatches (low → high is red → green, or reversed).
export function scaleGradient(reverse = false) {
  const stops = [RED, YELLOW, GREEN].map((c) => `rgb(${c.join(", ")})`);
  return `linear-gradient(90deg, ${(reverse ? stops.reverse() : stops).join(", ")})`;
}
