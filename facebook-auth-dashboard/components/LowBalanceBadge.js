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
  const first = accounts[0];
  return (
    <span ref={wrapRef} style={{ position: "relative", display: "inline-block" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        title="Spend cap left is lower than recent daily spend — click for details"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 7,
          padding: "7px 12px",
          borderRadius: 999,
          border: "1px solid var(--red)",
          background: "rgba(var(--red-rgb), 0.1)",
          color: "var(--red)",
          font: "inherit",
          fontSize: 12.5,
          fontWeight: 700,
          cursor: "pointer",
          whiteSpace: "nowrap",
        }}
      >
        <span aria-hidden style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--red)" }} />
        {accounts.length > 1 ? `Low balance · ${accounts.length} accounts` : `Low balance · ${money(first.remaining, first.currency)} left`}
      </button>
      {open && (
        <div
          className={styles.card}
          style={{
            position: "absolute",
            top: "calc(100% + 8px)",
            left: 0,
            zIndex: 60,
            background: "var(--bg)",
            boxShadow: "var(--shadow-md)",
            width: 340,
            maxWidth: "86vw",
            padding: 0,
            overflow: "hidden",
          }}
        >
          <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", fontWeight: 700, fontSize: 13.5 }}>Low balance</div>
          <div style={{ maxHeight: 360, overflowY: "auto" }}>
            {accounts.map((a) => (
              <AccountDetail key={a.id} a={a} />
            ))}
          </div>
          <div className={styles.muted} style={{ fontSize: 11, padding: "10px 16px", borderTop: "1px solid var(--border)" }}>
            Balance is the account&apos;s spend cap left. Flagged when it is below both yesterday&apos;s spend and the 3-day daily average.
          </div>
        </div>
      )}
    </span>
  );
}

function AccountDetail({ a }) {
  const max = Math.max(a.remaining, a.yesterdaySpend, a.avgSpend3d, 1);
  const daysLeft = a.yesterdaySpend > 0 ? a.remaining / Math.max(a.yesterdaySpend, a.avgSpend3d) : null;
  const bars = [
    { label: "Balance left", value: a.remaining, color: "var(--red)" },
    { label: "Yesterday's spend", value: a.yesterdaySpend, color: "var(--t2)" },
    { label: "Avg daily, last 3 days", value: a.avgSpend3d, color: "var(--t3)" },
  ];
  return (
    <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border)" }}>
      <div className={styles.sub} style={{ fontWeight: 600, marginBottom: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {a.name}
      </div>
      <div style={{ fontSize: 24, fontWeight: 800, color: "var(--red)", lineHeight: 1.1 }}>{money(a.remaining, a.currency)}</div>
      <div className={styles.muted} style={{ fontSize: 12, marginBottom: 12 }}>
        {daysLeft != null && daysLeft < 1 ? "Less than a day of spend left" : daysLeft != null ? `About ${daysLeft.toFixed(1)} days of spend left` : "left on the spend cap"}
      </div>
      {bars.map((b) => (
        <div key={b.label} style={{ marginBottom: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 3 }}>
            <span className={styles.sub}>{b.label}</span>
            <span style={{ fontWeight: 600 }}>{money(b.value, a.currency)}</span>
          </div>
          <div style={{ height: 6, borderRadius: 3, background: "var(--border)" }}>
            <div style={{ height: "100%", width: `${Math.max((b.value / max) * 100, b.value > 0 ? 3 : 0)}%`, borderRadius: 3, background: b.color }} />
          </div>
        </div>
      ))}
    </div>
  );
}
