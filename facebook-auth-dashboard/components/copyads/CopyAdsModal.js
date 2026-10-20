import { useEffect, useState } from "react";
import Loader from "@/components/Loader";
import AccountSelect from "@/components/AccountSelect";
import Thumb from "@/components/Thumb";
import CreativeLightbox from "@/components/CreativeLightbox";
import { CloseIcon, ChevronIcon } from "@/components/icons";
import { parseJsonResponse, fetchWithTimeout } from "@/lib/fetchJson";
import styles from "@/styles/Home.module.css";

// Minimal searchable list for picking a destination ad set — same pattern
// as pages/launch.js's own PickerList and components/DuplicateEntityModal.js's
// cousin of it. Kept as its own small copy rather than a shared import,
// same reasoning those two files' own comments give: each caller wants
// slightly different row content.
function AdsetPickerList({ adsets, query, onQueryChange, onPick }) {
  const filtered = query.trim() ? adsets.filter((a) => a.name.toLowerCase().includes(query.trim().toLowerCase())) : adsets;
  return (
    <div>
      <input
        type="text"
        autoFocus
        className={styles.select}
        style={{ width: "100%", marginBottom: 10 }}
        placeholder="Search ad sets…"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
      />
      {filtered.length === 0 ? (
        <p className={styles.sub}>No ad sets found in this account.</p>
      ) : (
        <div style={{ border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden", maxHeight: 280, overflowY: "auto" }}>
          {filtered.map((a) => (
            <div
              key={a.id}
              onClick={() => onPick(a)}
              style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)", cursor: "pointer", display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name}</div>
                <span className={styles.muted}>{a.campaign?.name || "No campaign"}</span>
              </div>
              <span className={styles.badgeInfo} style={{ flexShrink: 0 }}>
                {a.status}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function BackLink({ onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ display: "flex", alignItems: "center", gap: 4, background: "none", border: "none", cursor: "pointer", color: "var(--t2)", fontSize: 12.5, padding: 0, marginBottom: 12 }}
    >
      <ChevronIcon direction="left" size={12} />
      Back
    </button>
  );
}

function StepRow({ step }) {
  // A succeeded step can still carry a non-blocking `warning` (e.g. copied
  // without an Instagram actor) — shown with the amber skipped-style icon
  // so it's visibly distinct from a clean success, without being counted
  // as a failure anywhere (createdAdIds/overallSuccess already don't).
  const icon = step.warning ? "⚠" : step.success ? "✓" : step.skipped ? "⊘" : "✗";
  const color = step.warning ? "var(--amber)" : step.success ? "var(--green)" : step.skipped ? "var(--amber)" : "var(--red)";
  return (
    <div style={{ display: "flex", gap: 8, fontSize: 12.5, padding: "4px 0" }}>
      <span style={{ color, fontWeight: 700, flexShrink: 0 }}>{icon}</span>
      <span>
        {step.label} — {step.name}
        {step.error && <span style={{ color: "var(--t2)" }}> · {step.error}</span>}
        {step.warning && <span style={{ color: "var(--t2)" }}> · {step.warning}</span>}
      </span>
    </div>
  );
}

// Destination picker + review + confirm + live-progress result, for cloning
// a batch of ads (creative and all) from one ad account into an already-
// existing ad set in a different one. Modeled on components/
// DuplicateEntityModal.js's step-state-machine shape and
// pages/api/fb/partnership/launch.js's NDJSON progress consumption (the
// client-side reader loop is the same one components/LaunchPanel.js already
// uses), just pointed at the new cross-account pages/api/fb/copy-ads/copy.js
// endpoint instead.
export default function CopyAdsModal({ sourceAccountId, ads: adsProp, adAccounts, onClose, onDone }) {
  // Captured once at mount, not read live off the prop for the rest of this
  // component's life — onDone (below) tells the parent page to clear its
  // selection the moment a copy succeeds, which would otherwise shrink
  // `adsProp` out from under the still-open result screen mid-render (the
  // exact "N of 0" stale-count bug class already hit once this session in
  // components/partnership/BulkPermissionModal.js, fixed there the same way).
  const [ads] = useState(adsProp);
  const [step, setStep] = useState("pick_destination"); // pick_destination | pick_adset | review | done
  const [destAccountId, setDestAccountId] = useState("");
  const [adsetsLoading, setAdsetsLoading] = useState(false);
  const [adsetsError, setAdsetsError] = useState(null);
  const [adsets, setAdsets] = useState([]);
  const [destAdset, setDestAdset] = useState(null);
  const [adsetQuery, setAdsetQuery] = useState("");

  const [names, setNames] = useState(() => Object.fromEntries(ads.map((a) => [a.id, `${a.name} - Copy`])));
  const [status, setStatus] = useState("PAUSED");

  const [submitting, setSubmitting] = useState(false);
  const [progressMessage, setProgressMessage] = useState(null);
  const [submitError, setSubmitError] = useState(null);
  const [result, setResult] = useState(null);
  const [lightboxItem, setLightboxItem] = useState(null);

  useEffect(() => {
    function handleKey(e) {
      if (e.key === "Escape" && !submitting) onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [submitting, onClose]);

  const destinationAccounts = adAccounts.filter((a) => a.id !== sourceAccountId);

  function loadAdsets(accountId) {
    setAdsetsLoading(true);
    setAdsetsError(null);
    fetchWithTimeout(`/api/fb/adsets-list?accountId=${encodeURIComponent(accountId)}`)
      .then(parseJsonResponse)
      .then((json) => {
        if (json.error) setAdsetsError(json.error);
        else setAdsets(json.adsets || []);
      })
      .catch((err) => setAdsetsError(err.message))
      .finally(() => setAdsetsLoading(false));
  }

  function pickDestAccount(id) {
    setDestAccountId(id);
    setDestAdset(null);
    setAdsetQuery("");
    loadAdsets(id);
    setStep("pick_adset");
  }

  function pickDestAdset(adset) {
    setDestAdset(adset);
    setStep("review");
  }

  async function handleConfirm() {
    setSubmitting(true);
    setSubmitError(null);
    setProgressMessage("Starting…");
    try {
      const res = await fetch("/api/fb/copy-ads/copy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceAccountId,
          destAccountId,
          destAdsetId: destAdset.id,
          items: ads.map((a) => ({ adId: a.id, name: names[a.id] })),
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
          if (event.type === "progress") setProgressMessage(event.message);
          else if (event.type === "done") finalResult = event;
        }
      }
      setResult(finalResult);
      setStep("done");
      onDone?.(finalResult);
    } catch (err) {
      setSubmitError(err.message);
    } finally {
      setSubmitting(false);
      setProgressMessage(null);
    }
  }

  const destAccountName = destinationAccounts.find((a) => a.id === destAccountId)?.name || "";

  return (
    <>
      <div
        onClick={submitting ? undefined : onClose}
        style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.65)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 800, padding: 24 }}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          className={styles.card}
          style={{ background: "var(--bg)", width: "min(560px, 100%)", maxHeight: "85vh", overflowY: "auto", display: "flex", flexDirection: "column" }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
            <div>
              <h2 className={styles.h2} style={{ marginBottom: 2 }}>
                {step === "pick_destination" && "Choose a destination account"}
                {step === "pick_adset" && "Choose a destination ad set"}
                {step === "review" && "Review & copy"}
                {step === "done" && "Copy complete"}
              </h2>
              <p className={styles.sub}>
                {ads.length} ad{ads.length === 1 ? "" : "s"} selected
              </p>
            </div>
            <button type="button" onClick={onClose} disabled={submitting} aria-label="Close" className={styles.btnSecondary} style={{ padding: 6 }}>
              <CloseIcon size={14} />
            </button>
          </div>
  
          {step === "pick_destination" && (
            <div style={{ marginTop: 16 }}>
              {destinationAccounts.length === 0 ? (
                <p className={styles.sub}>No other ad accounts available to copy into.</p>
              ) : (
                <AccountSelect
                  accounts={destinationAccounts}
                  value={destAccountId}
                  onChange={pickDestAccount}
                  placeholder="Select an ad account…"
                  usePortal
                  zIndex={900}
                />
              )}
            </div>
          )}
  
          {step === "pick_adset" && (
            <div style={{ marginTop: 16 }}>
              <BackLink onClick={() => setStep("pick_destination")} />
              <p className={styles.sub} style={{ marginBottom: 10 }}>
                Into: {destAccountName}
              </p>
              {adsetsLoading && <Loader label="Loading ad sets…" />}
              {adsetsError && <div className={styles.error}>{adsetsError}</div>}
              {!adsetsLoading && !adsetsError && (
                <AdsetPickerList adsets={adsets} query={adsetQuery} onQueryChange={setAdsetQuery} onPick={pickDestAdset} />
              )}
            </div>
          )}
  
          {step === "review" && (
            <div style={{ marginTop: 16 }}>
              <BackLink onClick={() => setStep("pick_adset")} />
              <p className={styles.sub} style={{ marginBottom: 10 }}>
                Into &quot;{destAdset.name}&quot; ({destAccountName})
              </p>
  
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16, maxHeight: 220, overflowY: "auto" }}>
                {ads.map((ad) => (
                  <div key={ad.id}>
                    <label className={styles.sub} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                      <Thumb
                        src={ad.thumbnailUrl}
                        isVideo={ad.isVideo}
                        size={20}
                        onClick={() => setLightboxItem({ id: ad.id, name: ad.name, thumbnailUrl: ad.thumbnailUrl, isVideo: ad.isVideo })}
                      />
                      {ad.name}
                    </label>
                    <input
                      type="text"
                      className={styles.select}
                      style={{ width: "100%" }}
                      value={names[ad.id] || ""}
                      disabled={submitting}
                      onChange={(e) => setNames((prev) => ({ ...prev, [ad.id]: e.target.value }))}
                    />
                  </div>
                ))}
              </div>
  
              <p className={styles.sub} style={{ marginBottom: 6 }}>
                Status after copying
              </p>
              <div className={styles.tabGroup} style={{ marginBottom: 14 }}>
                <button type="button" className={status === "PAUSED" ? `${styles.tab} ${styles.tabActive}` : styles.tab} onClick={() => setStatus("PAUSED")} disabled={submitting}>
                  Paused — review before spending
                </button>
                <button type="button" className={status === "ACTIVE" ? `${styles.tab} ${styles.tabActive}` : styles.tab} onClick={() => setStatus("ACTIVE")} disabled={submitting}>
                  Active immediately
                </button>
              </div>
  
              {submitting && (
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                  <Loader label={progressMessage || "Copying…"} />
                </div>
              )}
              {submitError && <div className={styles.error}>{submitError}</div>}
  
              <div style={{ display: "flex", gap: 10, marginTop: 10, justifyContent: "flex-end" }}>
                <button type="button" className={styles.btnSecondary} onClick={onClose} disabled={submitting}>
                  Cancel
                </button>
                <button type="button" className={styles.btnPrimary} onClick={handleConfirm} disabled={submitting}>
                  {submitting ? "Copying…" : `Copy ${ads.length} ad${ads.length === 1 ? "" : "s"}`}
                </button>
              </div>
            </div>
          )}
  
          {step === "done" && result && (
            <div style={{ marginTop: 16 }}>
              <p style={{ fontWeight: 600, marginBottom: 4 }}>{result.success ? "Copied successfully." : "Finished with some errors."}</p>
              <p className={styles.sub} style={{ marginBottom: 10 }}>
                {result.createdAdIds.length} of {ads.length} ad{ads.length === 1 ? "" : "s"} created paused in &quot;{destAdset.name}
                &quot; — check Ads Manager before activating.
              </p>
              <div style={{ border: "1px solid var(--border)", borderRadius: 10, padding: "6px 12px" }}>
                {result.steps.map((s, i) => (
                  <StepRow key={i} step={s} />
                ))}
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 18 }}>
                <button type="button" className={styles.btnPrimary} onClick={onClose}>
                  Done
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
      <CreativeLightbox item={lightboxItem} onClose={() => setLightboxItem(null)} />
    </>
  );
}
