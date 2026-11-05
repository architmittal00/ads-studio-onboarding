import styles from "@/styles/Home.module.css";

// Building blocks shared by the campaign, ad set and ad "View details" panels (EntityDetailDrawer).

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

// Label above a value (and an optional hint under it) inside an edit form.
export function Field({ label, hint, children }) {
  return (
    <div className={styles.dtField}>
      <label className={styles.dtLabel}>{label}</label>
      {children}
      {hint && <p className={styles.dtMeta}>{hint}</p>}
    </div>
  );
}

// One-line status banner shown at the top of a panel after a save.
export function Notice({ children }) {
  return children ? <div className={styles.dtNotice}>{children}</div> : null;
}

// The Cancel / Save row at the bottom of every edit form. `changedCount` (when given) makes the button
// read "Save N changes"; `disabled` adds extra reasons to block saving on top of "nothing changed".
export function SaveBar({ saving, changedCount, hasChanges = changedCount > 0, disabled = false, saveLabel, onCancel, onSave }) {
  const label = saving
    ? "Saving…"
    : !hasChanges
      ? "No changes"
      : saveLabel || (changedCount != null ? `Save ${changedCount} change${changedCount === 1 ? "" : "s"}` : "Save changes");
  return (
    <div className={styles.dtSaveBar}>
      <button type="button" className={styles.btnSecondary} onClick={onCancel} disabled={saving}>
        Cancel
      </button>
      <button type="button" className={styles.btnPrimary} style={{ flex: 1 }} disabled={saving || !hasChanges || disabled} onClick={onSave}>
        {label}
      </button>
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
