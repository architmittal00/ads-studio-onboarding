import { useEffect, useState } from "react";
import { parseJsonResponse } from "@/lib/fetchJson";
import { invalidateCachedGets } from "@/lib/cachedGet";
import { CloseIcon } from "@/components/icons";
import { STEP_PCT } from "@/components/rules/RuleActionModal";
import styles from "@/styles/Home.module.css";

const CONCURRENCY = 4;
const money = (v, symbol) => `${symbol}${Math.round(v).toLocaleString("en-IN")}`;

// Confirm-and-apply for several flags that share one action (pause ads, or raise / lower budgets by
// one percentage). Same write route as a single apply (/api/fb/entity-action), a few at a time.
export default function BulkRuleActionModal({ action, flags, currencySymbol, onClose, onDone }) {
  const isPause = action === "PAUSE_AD";
  const sign = action === "DECREASE_BUDGET" ? -1 : 1;
  const [pct, setPct] = useState(STEP_PCT);
  const [step, setStep] = useState("confirm"); // confirm | running | done
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState([]);

  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape" && step !== "running") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, onClose]);

  const pctNum = parseFloat(pct);
  const validPct = isPause || (Number.isFinite(pctNum) && pctNum > 0 && pctNum < 100 * (sign === 1 ? 10 : 1));
  const newBudget = (f) => Math.max(1, Math.round(f.budgetTarget.current * (1 + (sign * pctNum) / 100)));
  const noun = isPause ? (flags.length === 1 ? "ad" : "ads") : flags.length === 1 ? "budget" : "budgets";
  const title = isPause ? `Pause ${flags.length} ${noun}?` : `${sign === 1 ? "Increase" : "Decrease"} ${flags.length} ${noun}`;

  async function run() {
    setStep("running");
    setProgress(0);
    const out = new Array(flags.length);
    let next = 0;
    async function worker() {
      while (next < flags.length) {
        const i = next++;
        const f = flags[i];
        try {
          const body = isPause
            ? { entityId: f.entityId, action: "pause" }
            : { entityId: f.budgetTarget.id, action: f.budgetTarget.type === "lifetime" ? "set_lifetime_budget" : "set_daily_budget", value: newBudget(f) };
          const res = await fetch("/api/fb/entity-action", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
          const json = await parseJsonResponse(res).catch((e) => ({ error: e.message }));
          if (!res.ok || json.error) throw new Error(json.error || `Request failed (${res.status})`);
          out[i] = { key: f.key, name: f.name, ok: true, text: isPause ? "Paused" : `Budget ${money(f.budgetTarget.current, currencySymbol)} → ${money(newBudget(f), currencySymbol)}` };
        } catch (err) {
          out[i] = { key: f.key, name: f.name, ok: false, error: err.message };
        }
        setProgress((p) => p + 1);
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, flags.length) }, worker));
    invalidateCachedGets();
    setResults(out);
    setStep("done");
    onDone(out);
  }

  const failed = results.filter((r) => !r.ok);

  return (
    <div onClick={step === "running" ? undefined : onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 800, padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} className={styles.card} style={{ background: "var(--bg)", width: "min(560px, 100%)", maxHeight: "90vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, marginBottom: 10 }}>
          <h2 className={styles.h2}>{step === "done" ? (failed.length ? `${results.length - failed.length} of ${results.length} done` : "All done") : title}</h2>
          <button type="button" onClick={onClose} disabled={step === "running"} aria-label="Close" className={styles.btnSecondary} style={{ padding: 6 }}>
            <CloseIcon size={14} />
          </button>
        </div>

        {step === "confirm" && (
          <>
            {isPause ? (
              <p className={styles.sub} style={{ marginBottom: 10 }}>These ads will be paused on Meta right away. You can turn them back on from Custom Views or Ads Manager.</p>
            ) : (
              <>
                <label className={styles.sub} style={{ display: "block", marginBottom: 6 }}>
                  {sign === 1 ? "Increase" : "Decrease"} every budget by (%)
                </label>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
                  <input type="number" min="1" className={styles.select} style={{ width: 90 }} value={pct} onChange={(e) => setPct(e.target.value)} />
                  {[5, 10, 20].map((p) => (
                    <button key={p} type="button" className={styles.btnSecondary} onClick={() => setPct(p)} style={{ padding: "6px 10px" }}>
                      {p}%
                    </button>
                  ))}
                </div>
              </>
            )}
            <div style={{ border: "1px solid var(--border)", borderRadius: 10, maxHeight: 260, overflowY: "auto" }}>
              {flags.map((f, i) => (
                <div key={f.key} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "7px 12px", borderTop: i ? "1px solid var(--border)" : "none", fontSize: 12.5 }}>
                  <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{isPause ? f.name : f.budgetTarget.name}</span>
                  {!isPause && (
                    <span style={{ whiteSpace: "nowrap" }}>
                      {money(f.budgetTarget.current, currencySymbol)} → <strong>{validPct ? money(newBudget(f), currencySymbol) : "—"}</strong>
                    </span>
                  )}
                </div>
              ))}
            </div>
            {!isPause && flags.some((f) => f.budgetTarget.level === "campaign") && (
              <p className={styles.muted} style={{ marginTop: 8, fontWeight: 400 }}>
                Campaign budgets (CBO) apply to every ad set inside that campaign.
              </p>
            )}
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 16 }}>
              <button type="button" className={styles.btnSecondary} onClick={onClose}>
                Cancel
              </button>
              <button type="button" className={styles.btnPrimary} onClick={run} disabled={!validPct}>
                {isPause ? `Pause ${flags.length} ${noun}` : `Apply to ${flags.length}`}
              </button>
            </div>
          </>
        )}

        {step === "running" && <p className={styles.sub}>Applying {progress} of {flags.length}…</p>}

        {step === "done" && (
          <>
            <p className={styles.sub}>{failed.length === 0 ? "Every change was applied on Meta." : "Some changes didn't go through; the rest were applied."}</p>
            {failed.map((r) => (
              <div key={r.key} className={styles.error} style={{ marginTop: 8, fontSize: 12.5 }}>
                {r.name}: {r.error}
              </div>
            ))}
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
              <button type="button" className={styles.btnPrimary} onClick={onClose}>
                Done
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
