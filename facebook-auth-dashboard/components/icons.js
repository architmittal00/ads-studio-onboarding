// Small inline SVG icon set — kept dependency-free. All icons are 1em square
// by default via `size`, inherit color via `currentColor`.
function Svg({ size = 14, children }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0 }}
    >
      {children}
    </svg>
  );
}

export function RefreshIcon(props) {
  return (
    <Svg {...props}>
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </Svg>
  );
}

export function SearchIcon(props) {
  return (
    <Svg {...props}>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </Svg>
  );
}

export function CalendarIcon(props) {
  return (
    <Svg {...props}>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </Svg>
  );
}

export function ChartIcon(props) {
  return (
    <Svg {...props}>
      <path d="M3 3v18h18" />
      <path d="M7 15l4-6 4 3 5-8" />
    </Svg>
  );
}

export function ChevronIcon({ direction = "down", ...props }) {
  const rotation = { down: 0, up: 180, left: 90, right: -90 }[direction];
  return (
    <span style={{ display: "inline-flex", transform: `rotate(${rotation}deg)`, transition: "transform .15s" }}>
      <Svg {...props}>
        <path d="m6 9 6 6 6-6" />
      </Svg>
    </span>
  );
}

export function CloseIcon(props) {
  return (
    <Svg {...props}>
      <path d="M18 6 6 18M6 6l12 12" />
    </Svg>
  );
}
