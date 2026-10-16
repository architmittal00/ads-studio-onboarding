import { useState } from "react";
import { CloseIcon, ChevronIcon } from "../icons";
import AdSetMultiSelect from "./AdSetMultiSelect";
import { getPixelMapping, setPixelMapping, getPartnershipSettings, setPartnershipSettings } from "@/lib/clientStorage";
import styles from "@/styles/Home.module.css";

function StepRow({ step }) {
  const label = step.type === "item" ? step.name : step.type === "creative" ? `Creative — ${step.name}` : step.type === "ad" ? `Ad — ${step.name}` : "Activation";
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
      <span style={{ fontSize: 12.5 }} title={step.error}>
        {label}
      </span>
      <span className={step.success ? styles.badgeGood : styles.badgeDanger}>{step.success ? "✓" : "✕"}</span>
    </div>
  );
}

// 3-step launch flow: pre-filled settings (now the real "General Settings",
// not the mockup's own hardcoded placeholders) → target ad set(s) → launch
// status + confirm. "Confirm & Launch" drives pages/api/fb/partnership/launch.js's
// NDJSON stream the same way components/LaunchPanel.js already reads
// pages/api/fb/launch-campaign.js's — same reading/progress pattern, reused.
export default function LaunchWizardModal({ accountId, businessId, igUserId, pages, items, onClose, onLaunched }) {
  const [step, setStep] = useState(1);
  const existingSettings = getPartnershipSettings(accountId) || {};
  const [pixelId, setPixelIdState] = useState(existingSettings.pixelId || getPixelMapping(accountId) || "");
  const [utmParam, setUtmParam] = useState(existingSettings.utmParam || "");
  const [facebookPageId, setFacebookPageId] = useState(existingSettings.facebookPageId || pages?.[0]?.id || "");
  const [adsets, setAdsets] = useState([]);
  const [status, setStatus] = useState("PAUSED");
  const [launching, setLaunching] = useState(false);
  const [progressMsg, setProgressMsg] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  function saveStep1AndNext() {
    setPartnershipSettings(accountId, { pixelId, utmParam, facebookPageId });
    if (pixelId) setPixelMapping(accountId, pixelId);
    setStep(2);
  }

  async function handleConfirm() {
    setLaunching(true);
    setError(null);
    setProgressMsg("Starting…");
    try {
      const res = await fetch("/api/fb/partnership/launch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId,
          businessId,
          igUserId,
          facebookPageId,
          items,
          adsetIds: adsets.map((a) => a.id),
          finalStatus: status,
        }),
      });
      if (!res.ok || !res.body) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || `Request failed (${res.status})`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finalResult = null;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop();
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line);
          if (event.type === "progress") setProgressMsg(event.message);
          else if (event.type === "done") finalResult = event;
        }
      }
      setResult(finalResult);
      if (finalResult?.success) onLaunched?.(finalResult);
    } catch (err) {
      setError(err.message);
    } finally {
      setLaunching(false);
      setProgressMsg(null);
    }
  }

  const canNext1 = pixelId.trim() && facebookPageId;
  const canNext2 = adsets.length > 0;

  return (
    <div
      onClick={launching ? undefined : onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.65)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 800, padding: 24 }}
    >
      <div onClick={(e) => e.stopPropagation()} className={styles.card} style={{ background: "var(--bg)", width: "min(520px, 100%)", maxHeight: "86vh", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
          <div>
            <h2 className={styles.h2} style={{ marginBottom: 2 }}>
              Ready to Launch — Step {step} of 3
            </h2>
            <p className={styles.sub}>
              {step === 1 ? "Confirm pixel, UTM, and Page settings" : step === 2 ? "Choose target ad set(s)" : "Set launch status"}
            </p>
          </div>
          <button type="button" onClick={onClose} disabled={launching} aria-label="Close" className={styles.btnSecondary} style={{ padding: 6 }}>
            <CloseIcon size={14} />
          </button>
        </div>

        <div style={{ display: "flex", gap: 6, margin: "10px 0 16px" }}>
          {[1, 2, 3].map((s) => (
            <div key={s} style={{ height: 4, borderRadius: 2, flex: 1, background: s <= step ? "var(--purple)" : "var(--border)" }} />
          ))}
        </div>

        <div style={{ overflowY: "auto", flex: 1 }}>
          {step === 1 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div>
                <label className={styles.muted} style={{ fontSize: 11 }}>
                  Facebook Pixel ID <span style={{ color: "var(--red)" }}>*</span>
                </label>
                <input className={styles.select} style={{ width: "100%" }} value={pixelId} onChange={(e) => setPixelIdState(e.target.value)} />
              </div>
              <div>
                <label className={styles.muted} style={{ fontSize: 11 }}>
                  UTM Parameter
                </label>
                <input className={styles.select} style={{ width: "100%" }} value={utmParam} onChange={(e) => setUtmParam(e.target.value)} placeholder="utm_source=partnership_ads" />
              </div>
              <div>
                <label className={styles.muted} style={{ fontSize: 11 }}>
                  Facebook Page <span style={{ color: "var(--red)" }}>*</span>
                </label>
                <select className={styles.select} style={{ width: "100%" }} value={facebookPageId} onChange={(e) => setFacebookPageId(e.target.value)}>
                  {(pages || []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <p className={styles.muted} style={{ fontSize: 11 }}>
                Remembered for this ad account — edit anytime from here.
              </p>
            </div>
          )}

          {step === 2 && (
            <div>
              <p style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>
                Target Ad Set(s) <span style={{ color: "var(--red)" }}>*</span>
              </p>
              <AdSetMultiSelect accountId={accountId} values={adsets} onChange={setAdsets} />
              {adsets.length > 1 && (
                <p className={styles.muted} style={{ fontSize: 11, marginTop: 8 }}>
                  {items.length} ad{items.length === 1 ? "" : "s"} × {adsets.length} ad sets = {items.length * adsets.length} ads will be created.
                </p>
              )}
            </div>
          )}

          {step === 3 && !result && (
            <div>
              <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
                <button
                  type="button"
                  onClick={() => setStatus("ACTIVE")}
                  className={styles.card}
                  style={{ flex: 1, padding: 14, cursor: "pointer", border: status === "ACTIVE" ? "2px solid var(--purple)" : "2px solid var(--border)" }}
                >
                  <p style={{ fontWeight: 700, fontSize: 13, margin: 0 }}>Active</p>
                  <p className={styles.muted} style={{ margin: 0, fontSize: 11 }}>Start running immediately</p>
                </button>
                <button
                  type="button"
                  onClick={() => setStatus("PAUSED")}
                  className={styles.card}
                  style={{ flex: 1, padding: 14, cursor: "pointer", border: status === "PAUSED" ? "2px solid var(--purple)" : "2px solid var(--border)" }}
                >
                  <p style={{ fontWeight: 700, fontSize: 13, margin: 0 }}>Paused</p>
                  <p className={styles.muted} style={{ margin: 0, fontSize: 11 }}>Review before activating</p>
                </button>
              </div>
              <div className={styles.card} style={{ padding: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}>
                  <span className={styles.muted}>Number of ads</span>
                  <strong>{items.length * adsets.length}</strong>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}>
                  <span className={styles.muted}>Target ad set(s)</span>
                  <strong>{adsets.map((a) => a.name).join(", ")}</strong>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}>
                  <span className={styles.muted}>Launch status</span>
                  <strong>{status === "ACTIVE" ? "Active" : "Paused"}</strong>
                </div>
              </div>
              {launching && progressMsg && (
                <p className={styles.sub} style={{ marginTop: 10 }}>
                  {progressMsg}
                </p>
              )}
              {error && (
                <div className={styles.error} style={{ marginTop: 10 }}>
                  {error}
                </div>
              )}
            </div>
          )}

          {result && (
            <div>
              <p style={{ fontWeight: 700, marginBottom: 8 }}>
                {result.success ? "✓ Launched successfully" : "⚠ Finished with errors"}
              </p>
              <div style={{ maxHeight: 260, overflowY: "auto" }}>
                {result.steps.map((s, i) => (
                  <StepRow key={i} step={s} />
                ))}
              </div>
            </div>
          )}
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 16, justifyContent: "flex-end" }}>
          {result ? (
            <button type="button" className={styles.btnPrimary} onClick={onClose}>
              Done
            </button>
          ) : (
            <>
              {step > 1 && (
                <button type="button" className={styles.btnSecondary} onClick={() => setStep(step - 1)} disabled={launching}>
                  <ChevronIcon direction="left" size={12} /> Back
                </button>
              )}
              {step === 1 && (
                <button type="button" className={styles.btnPrimary} onClick={saveStep1AndNext} disabled={!canNext1}>
                  Next
                </button>
              )}
              {step === 2 && (
                <button type="button" className={styles.btnPrimary} onClick={() => setStep(3)} disabled={!canNext2}>
                  Next
                </button>
              )}
              {step === 3 && (
                <button type="button" className={styles.btnPrimary} onClick={handleConfirm} disabled={launching}>
                  {launching ? "Launching…" : "Confirm & Launch"}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
