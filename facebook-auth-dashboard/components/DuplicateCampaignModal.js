import { parseJsonResponse } from "@/lib/fetchJson";
import { useEffect, useState } from "react";
import Loader from "./Loader";
import { CloseIcon } from "./icons";
import styles from "@/styles/Home.module.css";
import AdLaunchStatusPicker from "@/components/AdLaunchStatusPicker";
import { invalidateCachedGets } from "@/lib/cachedGet";

// Row action "Duplicate" for a campaign: copies it (with its ad sets and ads) inside the
// same account via /api/fb/duplicate-campaign. Several copies can be made at once.
export default function DuplicateCampaignModal({ row, onClose }) {
  const sourceName = row.entityLabel || row.label || row.entityId;
  const [name, setName] = useState(`${sourceName} - Copy`);
  const [copies, setCopies] = useState(1);
  const [launchStatus, setLaunchStatus] = useState("PAUSED");
  const [step, setStep] = useState("confirm"); // confirm | submitting | done
  const [results, setResults] = useState([]);

  useEffect(() => {
    function handleKey(e) {
      if (e.key === "Escape" && step !== "submitting") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [step, onClose]);

  const count = Math.min(Math.max(parseInt(copies, 10) || 1, 1), 5);

  async function submit() {
    setStep("submitting");
    const collected = [];
    // Sequential: each copy duplicates every ad set and ad under the campaign.
    for (let i = 0; i < count; i++) {
      const copyName = (name.trim() || `${sourceName} - Copy`) + (count > 1 ? ` ${i + 1}` : "");
      try {
        const res = await fetch("/api/fb/duplicate-campaign", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sourceCampaignId: row.entityId, name: copyName, status: launchStatus }),
        });
        const json = await parseJsonResponse(res).catch((e) => ({ error: e.message }));
        collected.push({ name: copyName, success: res.ok && !!json.success, error: res.ok ? json.renameError && `Created, but renaming failed: ${json.renameError}` : json.error || `Request failed (${res.status})` });
      } catch (err) {
        collected.push({ name: copyName, success: false, error: err.message });
      }
    }
    setResults(collected);
    invalidateCachedGets();
    setStep("done");
  }

  const failed = results.filter((r) => !r.success);
  const warned = results.filter((r) => r.success && r.error);

  return (
    <div
      onClick={step === "submitting" ? undefined : onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.65)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 800, padding: 24 }}
    >
      <div onClick={(e) => e.stopPropagation()} className={styles.card} style={{ background: "var(--bg)", width: "min(480px, 100%)", maxHeight: "85vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
          <div>
            <h2 className={styles.h2} style={{ marginBottom: 2 }}>
              Duplicate campaign
            </h2>
            <p className={styles.sub}>Campaign: {sourceName}</p>
          </div>
          <button type="button" onClick={onClose} disabled={step === "submitting"} aria-label="Close" className={styles.btnSecondary} style={{ padding: 6 }}>
            <CloseIcon size={14} />
          </button>
        </div>

        {step === "confirm" && (
          <div style={{ marginTop: 16 }}>
            <p className={styles.sub}>Creates a copy of this campaign in the same account, with all of its ad sets and ads — same targeting, budgets and creatives.</p>
            <AdLaunchStatusPicker value={launchStatus} onChange={setLaunchStatus} plural />
            <p className={styles.muted} style={{ margin: "14px 0 6px" }}>
              Name of the new campaign
            </p>
            <input type="text" className={styles.select} style={{ width: "100%" }} value={name} onChange={(e) => setName(e.target.value)} />
            <p className={styles.muted} style={{ margin: "14px 0 6px" }}>
              Number of copies (1–5)
            </p>
            <input type="number" min="1" max="5" className={styles.select} style={{ width: 100 }} value={copies} onChange={(e) => setCopies(e.target.value)} />
            {count > 1 && <p className={styles.muted}>Copies are numbered: &ldquo;{name.trim() || `${sourceName} - Copy`} 1&rdquo;, 2, …</p>}
          </div>
        )}

        {step === "submitting" && (
          <div style={{ marginTop: 16 }}>
            <Loader label={`Duplicating ${count === 1 ? "campaign" : `${count} copies`} — large campaigns can take a minute…`} />
          </div>
        )}

        {step === "done" && (
          <div style={{ marginTop: 16 }}>
            <p style={{ fontWeight: 600, marginBottom: 4 }}>
              {failed.length === 0 ? `Created ${results.length} cop${results.length === 1 ? "y" : "ies"}.` : `${results.length - failed.length} of ${results.length} created.`}
            </p>
            <p className={styles.sub}>{launchStatus === "ACTIVE" ? "The copies were created active." : "The copies were created paused — review in Ads Manager before activating."}</p>
            {[...failed, ...warned].map((r, i) => (
              <div key={i} className={styles.error} style={{ fontSize: 12.5, marginTop: 8 }}>
                {r.name}: {r.error}
              </div>
            ))}
          </div>
        )}

        <div style={{ display: "flex", gap: 10, marginTop: 18, justifyContent: "flex-end" }}>
          {step === "confirm" && (
            <>
              <button type="button" className={styles.btnSecondary} onClick={onClose}>
                Cancel
              </button>
              <button type="button" className={styles.btnPrimary} onClick={submit}>
                Duplicate
              </button>
            </>
          )}
          {step === "done" && (
            <button type="button" className={styles.btnPrimary} onClick={onClose}>
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
