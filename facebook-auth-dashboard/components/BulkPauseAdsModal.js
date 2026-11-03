import { useEffect, useState } from "react";
import { CloseIcon } from "@/components/icons";
import { pauseInBatches } from "@/lib/batchPause";
import { invalidateCachedGets } from "@/lib/cachedGet";
import { track } from "@/lib/analytics";
import styles from "@/styles/Home.module.css";

// Explore's bulk "Pause N Ads": confirm, then pause them in batches of 50 (lib/batchPause.js). `onPaused`
// receives the ids that were paused so the table can show them as Paused straight away.
export default function BulkPauseAdsModal({ ads, onClose, onPaused }) {
  const [step, setStep] = useState("confirm"); // confirm | running | done
  const [progress, setProgress] = useState(0);
  const [failed, setFailed] = useState([]);

  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape" && step !== "running") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, onClose]);

  async function run() {
    setStep("running");
    track("explore_bulk_pause", { count: ads.length });
    const results = await pauseInBatches(
      ads.map((a) => a.id),
      (done) => setProgress(done)
    );
    invalidateCachedGets();
    onPaused(ads.filter((a) => results.get(a.id)?.ok).map((a) => a.id));
    setFailed(ads.filter((a) => !results.get(a.id)?.ok).map((a) => ({ name: a.name, error: results.get(a.id)?.error || "Not paused" })));
    setStep("done");
  }

  const n = ads.length;
  const noun = n === 1 ? "ad" : "ads";
  return (
    <div onClick={step === "running" ? undefined : onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 800, padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} className={styles.card} style={{ background: "var(--bg)", width: "min(560px, 100%)", maxHeight: "90vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, marginBottom: 10 }}>
          <h2 className={styles.h2}>{step === "done" ? (failed.length ? `${n - failed.length} of ${n} paused` : `${n} ${noun} paused`) : `Pause ${n} ${noun}?`}</h2>
          <button type="button" onClick={onClose} disabled={step === "running"} aria-label="Close" className={styles.btnSecondary} style={{ padding: 6 }}>
            <CloseIcon size={14} />
          </button>
        </div>

        {step === "confirm" && (
          <>
            <p className={styles.sub} style={{ marginBottom: 10 }}>These ads will be paused on Meta right away, in batches of 50. You can turn them back on from Custom Views or Ads Manager.</p>
            <div style={{ border: "1px solid var(--border)", borderRadius: 10, maxHeight: 260, overflowY: "auto" }}>
              {ads.map((a, i) => (
                <div key={a.id} style={{ padding: "7px 12px", borderTop: i ? "1px solid var(--border)" : "none", fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {a.name}
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 16 }}>
              <button type="button" className={styles.btnSecondary} onClick={onClose}>
                Cancel
              </button>
              <button type="button" className={styles.btnPrimary} onClick={run}>
                Pause {n} {noun}
              </button>
            </div>
          </>
        )}

        {step === "running" && <p className={styles.sub}>Pausing {progress} of {n}…</p>}

        {step === "done" && (
          <>
            <p className={styles.sub}>{failed.length === 0 ? "Every ad was paused on Meta." : "Some ads didn't pause; the rest did."}</p>
            {failed.map((r, i) => (
              <div key={i} className={styles.error} style={{ marginTop: 8, fontSize: 12.5 }}>
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
