import { useEffect, useState } from "react";
import Loader from "@/components/Loader";
import AccountSelect from "@/components/AccountSelect";
import Thumb from "@/components/Thumb";
import CreativeLightbox from "@/components/CreativeLightbox";
import CopyIdButton from "@/components/CopyIdButton";
import { CloseIcon, ChevronIcon, DatabaseIcon, ListIcon, CopyIcon, CheckIcon, PauseIcon, PlayIcon } from "@/components/icons";
import { parseJsonResponse, fetchWithTimeout } from "@/lib/fetchJson";
import styles from "@/styles/Home.module.css";

// Per-ad live-progress phase → badge styling/label, for the table shown
// while `submitting` below. Added once pages/api/fb/copy-ads/copy.js started
// copying up to 5 ads concurrently (COPY_CONCURRENCY) — the single rolling
// progress message it streams stopped being a meaningful "what's happening"
// indicator (several ads' own messages interleave out of order), so each
// ad's own `ad_start`/`ad_done` events drive its own row instead.
const PHASE_BADGE_CLASS = {
  queued: styles.badgeInfo,
  copying: styles.badgeInfo,
  success: styles.badgeGood,
  skipped: styles.badgeWarn,
  failed: styles.badgeDanger,
};
const PHASE_LABEL = {
  queued: "Queued",
  copying: "Copying…",
  success: "Done",
  skipped: "Skipped",
  failed: "Failed",
};

// Which icon heads each step's title — purely decorative, gives each step
// its own visual identity instead of every screen in this modal looking
// identical aside from its heading text.
const STEP_ICON = {
  pick_destination: DatabaseIcon,
  pick_adset: ListIcon,
  review: CopyIcon,
  done: CheckIcon,
};

// Small gradient icon badge — same background (`var(--grad)`, the app's own
// primary-action gradient) and 36px/10px-radius shape as the sidebar's own
// `.logoMark`, just reusable with any icon instead of the hardcoded "f".
function StepIcon({ icon: Icon }) {
  return (
    <div
      style={{
        width: 36,
        height: 36,
        borderRadius: 10,
        background: "var(--grad)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        color: "#fff",
      }}
    >
      <Icon size={17} />
    </div>
  );
}

// Labeled section wrapper for the "review" step — gives each part of the
// form (ads being renamed, status after copying, live progress) its own
// bordered card with an icon+heading instead of everything running
// together as one flat, undifferentiated block.
function Section({ icon: Icon, title, children }) {
  return (
    <div className={styles.card} style={{ padding: 14, marginBottom: 14 }}>
      <p style={{ display: "flex", alignItems: "center", gap: 7, fontWeight: 700, fontSize: 12.5, marginBottom: 10, color: "var(--t1)" }}>
        <span style={{ color: "var(--purple)", display: "inline-flex" }}>
          <Icon size={13} />
        </span>
        {title}
      </p>
      {children}
    </div>
  );
}

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
    <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12.5, padding: "4px 0" }}>
      <span style={{ color, fontWeight: 700, flexShrink: 0 }}>{icon}</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        {step.label} — {step.name}
        {step.error && <span style={{ color: "var(--t2)" }}> · {step.error}</span>}
        {step.warning && <span style={{ color: "var(--t2)" }}> · {step.warning}</span>}
      </span>
      {/* Only the "Ad" step (not "Creative") carries the actually-useful id
          to copy — the new ad's own id, so the user can jump straight to it
          in Ads Manager. */}
      {step.type === "ad" && step.success && step.id && <CopyIdButton id={step.id} />}
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
  const [submitError, setSubmitError] = useState(null);
  const [result, setResult] = useState(null);
  const [lightboxItem, setLightboxItem] = useState(null);
  // Per-ad live status, keyed by source ad id: { phase: "queued"|"copying"|
  // "success"|"skipped"|"failed", error?, warning?, newAdId? }. Seeded to
  // "queued" for every selected ad the moment the copy starts (below), so
  // every row renders immediately rather than waiting for the first server
  // event.
  const [adProgress, setAdProgress] = useState({});

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
    setAdProgress(Object.fromEntries(ads.map((a) => [a.id, { phase: "queued" }])));
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
          if (event.type === "ad_start") {
            setAdProgress((prev) => ({ ...prev, [event.adId]: { ...prev[event.adId], phase: "copying" } }));
          } else if (event.type === "ad_done") {
            setAdProgress((prev) => ({
              ...prev,
              [event.adId]: {
                phase: event.success ? "success" : event.skipped ? "skipped" : "failed",
                error: event.error,
                warning: event.warning,
                newAdId: event.newAdId,
              },
            }));
          } else if (event.type === "done") {
            finalResult = event;
          }
          // `progress` events (the rolling "Copying ad N of M…"/"Activating…"
          // log line) are intentionally not surfaced in the UI anymore —
          // under concurrency it jumps around out of order across several
          // ads at once, which reads as broken rather than informative. The
          // per-ad table below is the real signal now; `progress` stays in
          // the wire protocol only because createAssetCopyCoordinator's
          // asset-copy messages still go through it server-side.
        }
      }
      setResult(finalResult);
      setStep("done");
      onDone?.(finalResult);
    } catch (err) {
      setSubmitError(err.message);
    } finally {
      setSubmitting(false);
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
          style={{ background: "var(--bg)", width: "min(640px, 100%)", maxHeight: "85vh", overflowY: "auto", display: "flex", flexDirection: "column" }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <StepIcon icon={STEP_ICON[step]} />
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
            </div>
            <button type="button" onClick={onClose} disabled={submitting} aria-label="Close" className={styles.btnSecondary} style={{ padding: 6 }}>
              <CloseIcon size={14} />
            </button>
          </div>

          {step === "pick_destination" && (
            <div style={{ marginTop: 20 }}>
              {destinationAccounts.length === 0 ? (
                <p className={styles.sub}>No other ad accounts available to copy into.</p>
              ) : (
                <>
                  <p className={styles.sub} style={{ marginBottom: 10 }}>
                    Pick the ad account that already has the destination ad set — its creative, Page, and copy carry
                    over, nothing else in that ad set is touched. {destinationAccounts.length} account
                    {destinationAccounts.length === 1 ? "" : "s"} available.
                  </p>
                  <AccountSelect
                    accounts={destinationAccounts}
                    value={destAccountId}
                    onChange={pickDestAccount}
                    placeholder="Select an ad account…"
                    usePortal
                    zIndex={900}
                  />
                </>
              )}
              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 20 }}>
                <button type="button" className={styles.btnSecondary} onClick={onClose}>
                  Cancel
                </button>
              </div>
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
              {!submitting && <BackLink onClick={() => setStep("pick_adset")} />}
              <p className={styles.sub} style={{ marginBottom: 14 }}>
                Into &quot;{destAdset.name}&quot; ({destAccountName})
              </p>

              {!submitting && (
                <>
                  <Section icon={CopyIcon} title={`${ads.length} ad${ads.length === 1 ? "" : "s"} to copy`}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 220, overflowY: "auto" }}>
                      {ads.map((ad) => (
                        <div
                          key={ad.id}
                          style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 8px", borderRadius: 8, background: "var(--bg)" }}
                        >
                          <Thumb
                            src={ad.thumbnailUrl}
                            isVideo={ad.isVideo}
                            size={32}
                            onClick={() => setLightboxItem({ id: ad.id, name: ad.name, thumbnailUrl: ad.thumbnailUrl, isVideo: ad.isVideo })}
                          />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <p className={styles.muted} style={{ fontSize: 11, marginBottom: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {ad.name}
                            </p>
                            <input
                              type="text"
                              className={styles.select}
                              style={{ width: "100%" }}
                              value={names[ad.id] || ""}
                              onChange={(e) => setNames((prev) => ({ ...prev, [ad.id]: e.target.value }))}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </Section>

                  <Section icon={CheckIcon} title="Status after copying">
                    <div className={styles.tabGroup}>
                      <button type="button" className={status === "PAUSED" ? `${styles.tab} ${styles.tabActive}` : styles.tab} onClick={() => setStatus("PAUSED")}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                          <PauseIcon size={12} />
                          Paused — review before spending
                        </span>
                      </button>
                      <button type="button" className={status === "ACTIVE" ? `${styles.tab} ${styles.tabActive}` : styles.tab} onClick={() => setStatus("ACTIVE")}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                          <PlayIcon size={12} />
                          Active immediately
                        </span>
                      </button>
                    </div>
                  </Section>
                </>
              )}

              {submitting && (
                <Section icon={ListIcon} title="Copying your ads">
                  {(() => {
                    const doneCount = Object.values(adProgress).filter((p) => p.phase === "success" || p.phase === "failed" || p.phase === "skipped").length;
                    return doneCount < ads.length ? (
                      <Loader inline label={`${doneCount} of ${ads.length} done`} />
                    ) : (
                      <p className={styles.sub}>{doneCount} of {ads.length} done</p>
                    );
                  })()}
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 6,
                      maxHeight: 280,
                      overflowY: "auto",
                      marginTop: 10,
                    }}
                  >
                    {ads.map((ad) => {
                      const p = adProgress[ad.id] || { phase: "queued" };
                      return (
                        <div
                          key={ad.id}
                          style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "6px 8px", borderRadius: 8, background: "var(--bg)" }}
                        >
                          <span style={{ fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}>
                            {ad.name}
                          </span>
                          <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                            <span className={PHASE_BADGE_CLASS[p.phase] || styles.badgeInfo}>{PHASE_LABEL[p.phase] || "Queued"}</span>
                            {p.phase === "success" && p.newAdId && <CopyIdButton id={p.newAdId} />}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </Section>
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
