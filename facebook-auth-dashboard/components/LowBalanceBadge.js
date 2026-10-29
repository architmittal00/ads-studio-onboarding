import { useEffect, useRef, useState } from "react";
import { cachedGet } from "@/lib/cachedGet";
import styles from "@/styles/Home.module.css";

function money(amount, currency) {
  try {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency: currency || "INR", maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${Math.round(amount)} ${currency || ""}`;
  }
}

// Amber "Low balance" chip next to a Custom View's query summary. Renders nothing unless one of
// the view's accounts is low (see pages/api/fb/low-balance.js for the rule); clicking opens the
// numbers behind it.
export default function LowBalanceBadge({ accountIds }) {
  const [accounts, setAccounts] = useState([]);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const key = [...accountIds].sort().join(",");

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resets the badge while the next account set loads
    setAccounts([]);
    if (!key || accountIds.length > 25) return;
    cachedGet(`/api/fb/low-balance?accountIds=${encodeURIComponent(key)}`, { ttlMs: 5 * 60 * 1000 })
      .then((json) => {
        if (!cancelled && json.accounts) setAccounts(json.accounts.filter((a) => a.low));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` is the account set
  }, [key]);

  useEffect(() => {
    if (!open) return;
    function onDown(e) {
      if (!wrapRef.current?.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  if (accounts.length === 0) return null;
  return (
    <span ref={wrapRef} style={{ position: "relative", display: "inline-block" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={styles.badgeWarn}
        style={{ cursor: "pointer", border: "none", font: "inherit" }}
        title="Spend cap left is lower than recent daily spend — click for details"
      >
        ⚠ Low balance{accounts.length > 1 ? ` (${accounts.length})` : ""}
      </button>
      {open && (
        <div
          className={styles.card}
          style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 60, background: "var(--bg)", boxShadow: "var(--shadow-md)", width: 320, maxWidth: "80vw", padding: 14 }}
        >
          {accounts.map((a) => (
            <div key={a.id} style={{ marginBottom: accounts.length > 1 ? 12 : 0 }}>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>{a.name}</div>
              <Row label="Current balance (spend cap left)" value={money(a.remaining, a.currency)} bold />
              <Row label="Avg daily spend, last 3 days" value={money(a.avgSpend3d, a.currency)} />
              <Row label="Yesterday's spend" value={money(a.yesterdaySpend, a.currency)} />
              <p className={styles.muted} style={{ fontSize: 11, marginTop: 6 }}>
                Spend cap left is below both daily figures, so spend may stop soon. {a.range?.since} – {a.range?.until}.
              </p>
            </div>
          ))}
        </div>
      )}
    </span>
  );
}

function Row({ label, value, bold }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 12.5, padding: "3px 0" }}>
      <span className={styles.sub}>{label}</span>
      <span style={{ fontWeight: bold ? 700 : 600, color: bold ? "var(--red)" : "var(--t1)" }}>{value}</span>
    </div>
  );
}
