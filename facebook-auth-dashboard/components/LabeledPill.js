import styles from "@/styles/Home.module.css";

// Small uppercase label above a header control (account picker, pixel picker, …) — the pill-row
// pattern Partnership Ads' header uses.
export default function LabeledPill({ label, children }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <span className={styles.muted} style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.3 }}>
        {label}
      </span>
      {children}
    </div>
  );
}
