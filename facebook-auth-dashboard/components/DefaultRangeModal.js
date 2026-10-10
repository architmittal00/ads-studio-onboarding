import { useEffect } from "react";
import { CloseIcon } from "./icons";
import styles from "@/styles/Home.module.css";

const OPTIONS = [
  { key: "today", label: "Today" },
  { key: "last_7d", label: "Last 7 Days" },
  { key: "last_30d", label: "Last 30 Days" },
];

// Lets the user pick which date range the report opens to on this device,
// every visit — separate from whatever range they happen to leave it on
// during a session. Picking an option saves immediately (no separate Save
// step, same as every other toggle in this report) and closes the modal.
export default function DefaultRangeModal({ open, current, onSelect, onClose }) {
  useEffect(() => {
    if (!open) return;
    function handleKey(e) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.65)",
        backdropFilter: "blur(6px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 800,
        padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={styles.card}
        style={{ background: "var(--bg)", width: "min(360px, 100%)" }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
          <div>
            <h2 className={styles.h2} style={{ marginBottom: 2 }}>
              Default Landing Range
            </h2>
            <p className={styles.sub}>Which date range the report opens to, on this device.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className={styles.btnSecondary}
            style={{ padding: 6 }}
          >
            <CloseIcon size={14} />
          </button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 16 }}>
          {OPTIONS.map((opt) => (
            <button
              key={opt.key}
              type="button"
              onClick={() => onSelect(opt.key)}
              className={opt.key === current ? `${styles.tab} ${styles.tabActive}` : styles.tab}
              style={{
                width: "100%",
                textAlign: "left",
                padding: "10px 14px",
                display: "flex",
                justifyContent: "space-between",
              }}
            >
              {opt.label}
              {opt.key === current && <span>✓</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
