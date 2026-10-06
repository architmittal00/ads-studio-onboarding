import styles from "@/styles/Home.module.css";

// Small spinning-ring loader. `inline` renders spinner + label side by side
// (for a status line like "Refreshing…"); otherwise it's a centered block
// (for the full-page "Building the report…" state).
export default function Loader({ label, inline = false }) {
  const spinner = <span className={inline ? `${styles.spinner} ${styles.spinnerSm}` : styles.spinner} />;

  if (inline) {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        {spinner}
        {label}
      </span>
    );
  }

  return (
    <div className={styles.loaderBox}>
      {spinner}
      {label && <p>{label}</p>}
    </div>
  );
}
