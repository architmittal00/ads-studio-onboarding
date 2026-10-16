import styles from "@/styles/Home.module.css";

// Floating bottom bar, same fixed-position/pill convention as
// components/partnership/SelectionBar.js — appears once at least one
// copyable ad is checked in the source ads table.
export default function SelectionBar({ count, onClear, onCopy }) {
  if (count === 0) return null;
  return (
    <div
      style={{
        position: "fixed",
        bottom: 24,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 150,
        background: "var(--bg)",
        border: "1px solid rgba(var(--purple-rgb), 0.5)",
        borderRadius: 16,
        padding: "11px 16px",
        display: "flex",
        alignItems: "center",
        gap: 12,
        boxShadow: "var(--shadow-md)",
        whiteSpace: "nowrap",
      }}
    >
      <span style={{ fontSize: 13, fontWeight: 700 }}>
        {count} ad{count === 1 ? "" : "s"} selected
      </span>
      <button type="button" onClick={onClear} className={styles.muted} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12 }}>
        ✕ Clear
      </button>
      <div style={{ width: 1, height: 18, background: "var(--border)" }} />
      <button type="button" className={styles.btnPrimary} onClick={onCopy}>
        Copy to another account ({count}) →
      </button>
    </div>
  );
}
