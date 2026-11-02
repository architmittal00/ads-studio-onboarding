import { useEffect, useState } from "react";
import { parseJsonResponse } from "@/lib/fetchJson";
import { invalidateCachedGets } from "@/lib/cachedGet";
import { CloseIcon } from "@/components/icons";
import styles from "@/styles/Home.module.css";

export const STEP_PCT = 10;

function money(v, symbol) {
  return `${symbol}${Math.round(v).toLocaleString("en-IN")}`;
}

// Confirm-and-apply for one flag: pause an ad, or change a budget by a suggested (editable) percentage.
// Uses the same write route as Custom Views' row actions (/api/fb/entity-action).
export default function RuleActionModal({ flag, currencySymbol, onClose, onApplied }) {
  const isPause = flag.action === "PAUSE_AD";
  const sign = flag.action === "DECREASE_BUDGET" ? -1 : 1;
  const target = flag.budgetTarget;
  const [pct, setPct] = useState(STEP_PCT);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape" && !busy) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const pctNum = parseFloat(pct);
  const validPct = Number.isFinite(pctNum) && pctNum > 0 && pctNum < 100 * (sign === 1 ? 10 : 1);
  const newBudget = !isPause && target && validPct ? Math.max(1, Math.round(target.current * (1 + (sign * pctNum) / 100))) : null;

  async function apply() {
    setBusy(true);
    setError(null);
    try {
      const body = isPause
        ? { entityId: flag.entityId, action: "pause" }
        : { entityId: target.id, action: target.type === "lifetime" ? "set_lifetime_budget" : "set_daily_budget", value: newBudget };
      const res = await fetch("/api/fb/entity-action", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const json = await parseJsonResponse(res).catch((e) => ({ error: e.message }));
      if (!res.ok || json.error) throw new Error(json.error || `Request failed (${res.status})`);
      invalidateCachedGets();
      onApplied(isPause ? "Paused" : `Budget ${money(target.current, currencySymbol)} → ${money(newBudget, currencySymbol)}`);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div
      onClick={busy ? undefined : onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 800, padding: 16 }}
    >
      <div onClick={(e) => e.stopPropagation()} className={styles.card} style={{ background: "var(--bg)", width: "min(440px, 100%)", maxHeight: "90vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, marginBottom: 10 }}>
          <div style={{ minWidth: 0 }}>
            <h2 className={styles.h2} style={{ marginBottom: 2 }}>
              {isPause ? "Pause this ad?" : flag.action === "INCREASE_BUDGET" ? "Increase budget" : "Decrease budget"}
            </h2>
            <p className={styles.sub} style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
              {isPause ? flag.name : target?.name}
            </p>
          </div>
          <button type="button" onClick={onClose} disabled={busy} aria-label="Close" className={styles.btnSecondary} style={{ padding: 6 }}>
            <CloseIcon size={14} />
          </button>
        </div>

        {isPause ? (
          <p className={styles.sub}>The ad will be paused on Meta right away. You can turn it back on from Custom Views or Ads Manager.</p>
        ) : (
          <>
            <p className={styles.sub} style={{ marginBottom: 12 }}>
              Current {target.type} budget: <strong style={{ color: "var(--t1)" }}>{money(target.current, currencySymbol)}</strong>
            </p>
            <label className={styles.sub} style={{ display: "block", marginBottom: 6 }}>
              {sign === 1 ? "Increase" : "Decrease"} by (%)
            </label>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <input type="number" min="1" className={styles.select} style={{ width: 90 }} value={pct} onChange={(e) => setPct(e.target.value)} />
              {[5, 10, 20].map((p) => (
                <button key={p} type="button" className={styles.btnSecondary} onClick={() => setPct(p)} style={{ padding: "6px 10px" }}>
                  {p}%
                </button>
              ))}
            </div>
            <div style={{ marginTop: 14, fontSize: 15 }}>
              New budget: <strong style={{ color: sign === 1 ? "var(--green)" : "var(--red)" }}>{newBudget != null ? money(newBudget, currencySymbol) : "—"}</strong>
            </div>
            {target.level === "campaign" && <p className={styles.muted} style={{ marginTop: 8 }}>Applied to the campaign&apos;s own budget (CBO), so it affects every ad set in it.</p>}
          </>
        )}

        {error && (
          <div className={styles.error} style={{ marginTop: 12 }}>
            {error}
          </div>
        )}
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 18 }}>
          <button type="button" className={styles.btnSecondary} onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className={styles.btnPrimary} onClick={apply} disabled={busy || (!isPause && newBudget == null)}>
            {busy ? "Applying…" : isPause ? "Pause ad" : "Apply"}
          </button>
        </div>
      </div>
    </div>
  );
}
