import { useState } from "react";
import { CopyIcon, CheckIcon } from "./icons";

function defaultCopy(text) {
  navigator.clipboard?.writeText(text).catch(() => {});
}

// Small inline "copy this one ID" control — flashes a checkmark for a moment
// so clicking it gives some feedback beyond the silent clipboard write.
// Originally local to pages/explore.js's results table; promoted here so
// Recent Changes' entity rows/drawers can offer the same "copy ad_id/adset_id"
// affordance without re-implementing it.
export default function CopyIdButton({ id, onCopy = defaultCopy }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onCopy(id);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      title={`Copy ID (${id})`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        background: "none",
        border: "none",
        padding: 2,
        cursor: "pointer",
        color: copied ? "var(--green)" : "var(--t3)",
        flexShrink: 0,
        whiteSpace: "nowrap",
      }}
    >
      {copied ? <CheckIcon size={12} /> : <CopyIcon size={12} />}
      {copied && <span style={{ fontSize: 10.5, fontWeight: 700 }}>Copied</span>}
    </button>
  );
}
