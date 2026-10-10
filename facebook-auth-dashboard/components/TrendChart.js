import { useState } from "react";

// Lightweight dependency-free SVG line chart. `points` is
// [{ label, value }]; `formatValue` controls tooltip/axis text.
export default function TrendChart({ points, formatValue = (v) => v.toFixed(2), color = "var(--purple)" }) {
  const [hoverIndex, setHoverIndex] = useState(null);

  if (!points || points.length === 0) {
    return <p style={{ color: "var(--t3)", fontSize: 13 }}>No data for this range.</p>;
  }

  const width = 640;
  const height = 240;
  const padding = { top: 16, right: 16, bottom: 28, left: 48 };
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;

  const values = points.map((p) => p.value);
  const maxValue = Math.max(...values, 0);
  const minValue = Math.min(...values, 0);
  const span = maxValue - minValue || 1;

  const x = (i) => padding.left + (points.length === 1 ? innerWidth / 2 : (i / (points.length - 1)) * innerWidth);
  const y = (v) => padding.top + innerHeight - ((v - minValue) / span) * innerHeight;

  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(p.value)}`).join(" ");
  const areaPath = `${linePath} L ${x(points.length - 1)} ${padding.top + innerHeight} L ${x(0)} ${padding.top + innerHeight} Z`;

  // Thin out x-axis labels so they don't overlap on wide point counts.
  const labelEvery = Math.max(1, Math.ceil(points.length / 7));

  return (
    <div style={{ position: "relative" }}>
      <svg viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", height: "auto", display: "block" }}>
        {[0, 0.25, 0.5, 0.75, 1].map((t) => {
          const gy = padding.top + innerHeight * t;
          return (
            <line
              key={t}
              x1={padding.left}
              x2={width - padding.right}
              y1={gy}
              y2={gy}
              stroke="rgba(var(--surface-tint-rgb),.06)"
              strokeWidth={1}
            />
          );
        })}

        <path d={areaPath} fill={color} opacity={0.12} stroke="none" />
        <path d={linePath} fill="none" stroke={color} strokeWidth={2} />

        {points.map((p, i) => (
          <circle
            key={i}
            cx={x(i)}
            cy={y(p.value)}
            r={hoverIndex === i ? 5 : 3}
            fill={color}
            stroke="var(--bg)"
            strokeWidth={1.5}
            onMouseEnter={() => setHoverIndex(i)}
            onMouseLeave={() => setHoverIndex((cur) => (cur === i ? null : cur))}
            style={{ cursor: "pointer" }}
          />
        ))}

        {points.map(
          (p, i) =>
            i % labelEvery === 0 && (
              <text key={i} x={x(i)} y={height - 6} textAnchor="middle" fontSize="10" fill="var(--t3)">
                {p.label}
              </text>
            )
        )}

        <text x={4} y={padding.top + 4} fontSize="10" fill="var(--t3)">
          {formatValue(maxValue)}
        </text>
        <text x={4} y={padding.top + innerHeight} fontSize="10" fill="var(--t3)">
          {formatValue(minValue)}
        </text>
      </svg>

      {hoverIndex != null && (
        <div
          style={{
            position: "absolute",
            left: `${(x(hoverIndex) / width) * 100}%`,
            top: `${(y(points[hoverIndex].value) / height) * 100}%`,
            transform: "translate(-50%, -130%)",
            background: "var(--bg)",
            border: "1px solid rgba(var(--surface-tint-rgb),.12)",
            borderRadius: 8,
            padding: "6px 10px",
            fontSize: 12,
            fontWeight: 600,
            color: "var(--t1)",
            whiteSpace: "nowrap",
            pointerEvents: "none",
            boxShadow: "var(--shadow-sm)",
          }}
        >
          {points[hoverIndex].label}: {formatValue(points[hoverIndex].value)}
        </div>
      )}
    </div>
  );
}
