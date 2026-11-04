import styles from "@/styles/Home.module.css";

// Small building blocks shared by the ad set and campaign "View details" panels.

export function Card({ title, action, children }) {
  return (
    <section className={styles.dtCard}>
      {(title || action) && (
        <div className={styles.dtCardHead}>
          <span className={styles.dtLabel}>{title}</span>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function Row({ label, children }) {
  return (
    <div className={styles.dtRow} style={{ alignItems: "flex-start" }}>
      <span className={styles.dtMeta}>{label}</span>
      <span style={{ textAlign: "right", minWidth: 0, overflowWrap: "anywhere" }}>{children}</span>
    </div>
  );
}

export function Pills({ items, empty = "—" }) {
  if (!items?.length) return <span className={styles.dtEmpty}>{empty}</span>;
  return (
    <span style={{ display: "inline-flex", flexWrap: "wrap", gap: 6, justifyContent: "flex-end" }}>
      {items.map((it, i) => (
        <span key={`${it}-${i}`} className={styles.pill}>
          {it}
        </span>
      ))}
    </span>
  );
}

export const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—");
export const toLocalInput = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
export const money = (v) => (v == null ? "—" : `₹${Number(v).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`);
export const humanStatus = (s) => (s ? s.toLowerCase().replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : "—");
