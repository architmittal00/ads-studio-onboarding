import styles from "@/styles/Home.module.css";

// Floating bottom bar — appears once any Explore grid card is selected.
// "Request Permission" only shows when at least one selected card actually
// needs it (not already ready/requested); "Add to Queue" only shows when at
// least one selected card is launch-ready. Both can show at once for a mixed
// selection. Modeled on this app's own fixed-position confirm patterns
// (components/RowActions.js's ActionConfirmModal) rather than the mockup's
// own bespoke .sel-bar styling.
export default function SelectionBar({ count, needPermissionCount, readyCount, onClear, onRequestPermission, onAddToQueue }) {
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
      {needPermissionCount > 0 && (
        <button type="button" className={styles.btnSecondary} onClick={onRequestPermission}>
          Request Permission ({needPermissionCount})
        </button>
      )}
      {readyCount > 0 && (
        <button type="button" className={styles.btnPrimary} onClick={onAddToQueue}>
          Add to Queue ({readyCount})
        </button>
      )}
    </div>
  );
}
