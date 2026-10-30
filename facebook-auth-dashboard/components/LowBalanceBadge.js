import { useEffect, useRef, useState } from "react";
import { cachedGet } from "@/lib/cachedGet";
import BottomSheet from "@/components/BottomSheet";
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
// `refreshKey` changes whenever the view's data is re-run (Run, Hard Refresh, date change), which
// refetches the balance check instead of reusing the cached one.
export default function LowBalanceBadge({ accountIds, mobile = false, refreshKey = null }) {
  // Tagged with the account set it was computed for, so a stale result is never shown for another set,
  // while a refresh of the same set keeps showing the last result until the new one lands.
  const [state, setState] = useState({ key: "", accounts: [] });
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const key = [...accountIds].sort().join(",");
  const seenRefreshKey = useRef(refreshKey);
  const seenAccountKey = useRef(key);
  const accounts = state.key === key ? state.accounts : [];

  useEffect(() => {
    if (!key || accountIds.length > 25) return;
    let cancelled = false;
    // A new refreshKey (the view's data was re-run / hard refreshed) skips the cached check.
    // Switching to another view (a different account set) just uses the short cache.
    const force = refreshKey !== seenRefreshKey.current && key === seenAccountKey.current;
    seenRefreshKey.current = refreshKey;
    seenAccountKey.current = key;
    cachedGet(`/api/fb/low-balance?accountIds=${encodeURIComponent(key)}`, { ttlMs: 2 * 60 * 1000, force })
      .then((json) => {
        if (!cancelled && json.accounts) setState({ key, accounts: json.accounts.filter((a) => a.low) });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-run for a new account set or a new refreshKey only
  }, [key, refreshKey]);

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
  const label = accounts.length > 1 ? `Low balance · ${accounts.length} accounts` : `Low balance · ${money(first.remaining, first.currency)} left`;
  if (mobile) {
    return (
      <>
        <button
          type="button"
          onClick={() => setOpen(true)}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
            width: "100%",
            marginTop: 10,
            padding: "11px 14px",
            borderRadius: 12,
            border: "1px solid var(--red)",
            background: "rgba(var(--red-rgb), 0.1)",
            color: "var(--red)",
            font: "inherit",
            fontSize: 14,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <span aria-hidden style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--red)" }} />
            {label}
          </span>
          <span style={{ fontSize: 12.5, fontWeight: 600 }}>Details ›</span>
        </button>
        <BottomSheet open={open} title="Low balance" onClose={() => setOpen(false)}>
          {accounts.map((a) => (
            <AccountDetail key={a.id} a={a} />
          ))}
          <div className={styles.muted} style={{ fontSize: 11.5, paddingTop: 10 }}>
            Balance is the account&apos;s spend cap left. Flagged when it is below both yesterday&apos;s spend and the 3-day daily average.
          </div>
        </BottomSheet>
      </>
    );
  }
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
        {label}
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
