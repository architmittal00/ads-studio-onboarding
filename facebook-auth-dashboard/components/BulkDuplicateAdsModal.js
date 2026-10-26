import { useEffect, useMemo, useState } from "react";
import Loader from "./Loader";
import { CloseIcon } from "./icons";
import { toMajorUnits } from "@/lib/reportShared";
import styles from "@/styles/Home.module.css";

// Same formatMoney/budgetLabel shape as components/DuplicateEntityModal.js —
// duplicated rather than imported, since neither of those is exported from
// that file (it only has a default export) and both are tiny/stable enough
// that sharing them isn't worth a new module.
function formatMoney(amount, currency) {
  if (amount == null) return null;
  try {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency: currency || "INR", maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${amount.toFixed(0)} ${currency || ""}`;
  }
}

function budgetLabel(entity, currency) {
  if (entity.daily_budget) return `${formatMoney(toMajorUnits(entity.daily_budget), currency)}/day`;
  if (entity.lifetime_budget) return `${formatMoney(toMajorUnits(entity.lifetime_budget), currency)} lifetime`;
  return "No budget at this level";
}

// Explore's bulk "Duplicate N Ads" action — the multi-ad, multi-destination
// generalization of components/DuplicateEntityModal.js's single-ad flow.
// Every selected ad is duplicated into every selected destination ad set
// (an N ads × M ad sets cartesian product), each an exact copy created
// paused, via the same /api/fb/duplicate-ad endpoint the single-ad flow
// already uses — called once per (ad, ad set) pair. `ads` is the exact
// `{id, name}` list the caller already has on hand from its own table rows
// (see pages/explore.js's selectedRows), so this never needs to re-fetch
// ad names the way the single-ad modal does (that one also needs the ad's
// creative id up front for its own display; this one doesn't show per-ad
// creative details, so a GET for each ad is extra round trips this skips).
export default function BulkDuplicateAdsModal({ ads, accountId, currency, onClose }) {
  const [step, setStep] = useState("loading"); // loading | error | pick | confirm | submitting | done
  const [loadError, setLoadError] = useState(null);
  const [adsetChoices, setAdsetChoices] = useState([]);
  const [selectedAdsetIds, setSelectedAdsetIds] = useState(() => new Set());
  const [query, setQuery] = useState("");
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [results, setResults] = useState([]);

  useEffect(() => {
    function handleKey(e) {
      if (e.key === "Escape" && step !== "submitting") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [step, onClose]);

  useEffect(() => {
    fetch(`/api/fb/adsets-list?accountId=${encodeURIComponent(accountId)}`)
      .then((res) => res.json())
      .then((json) => {
        if (json.error) {
          setLoadError(json.error);
          setStep("error");
          return;
        }
        setAdsetChoices(json.adsets || []);
        setStep("pick");
      })
      .catch((err) => {
        setLoadError(err.message);
        setStep("error");
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-time load for the exact account this modal was opened for
  }, []);

  const filteredAdsets = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return adsetChoices;
    return adsetChoices.filter((a) => a.name.toLowerCase().includes(q) || a.campaign?.name?.toLowerCase().includes(q));
  }, [adsetChoices, query]);

  function toggleAdset(id) {
    setSelectedAdsetIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const selectedAdsets = adsetChoices.filter((a) => selectedAdsetIds.has(a.id));
  const totalPairs = ads.length * selectedAdsets.length;

  async function submit() {
    if (selectedAdsets.length === 0) return;
    setStep("submitting");
    setProgress({ done: 0, total: totalPairs });
    const collected = [];
    // Sequential, not parallel — same reasoning the single-ad/ad-set flow's
    // own NDJSON launch sequence follows: this hits the same ad account's
    // Graph rate limit as every other write this app makes, and a batch here
    // can already be dozens of calls (N ads × M ad sets) without also racing
    // them against each other.
    for (const ad of ads) {
      for (const adset of selectedAdsets) {
        try {
          const res = await fetch("/api/fb/duplicate-ad", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ accountId, sourceAdId: ad.id, destinationAdsetId: adset.id, name: `${ad.name} - Copy` }),
          });
          const json = await res.json();
          collected.push({
            adName: ad.name,
            adsetName: adset.name,
            success: res.ok && !!json.success,
            error: res.ok ? null : json.error || "Request failed",
          });
        } catch (err) {
          collected.push({ adName: ad.name, adsetName: adset.name, success: false, error: err.message });
        }
        setProgress((p) => ({ ...p, done: p.done + 1 }));
      }
    }
    setResults(collected);
    setStep("done");
  }

  const failedResults = results.filter((r) => !r.success);

  return (
    <div
      onClick={step === "submitting" ? undefined : onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.65)",
        backdropFilter: "blur(6px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 800,
        padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={styles.card}
        style={{ background: "var(--bg)", width: "min(520px, 100%)", maxHeight: "85vh", overflowY: "auto", display: "flex", flexDirection: "column" }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
          <div>
            <h2 className={styles.h2} style={{ marginBottom: 2 }}>
              {step === "pick" ? "Choose destination ad sets" : `Duplicate ${ads.length} ad${ads.length === 1 ? "" : "s"}`}
            </h2>
            <p className={styles.sub}>
              {ads.length} ad{ads.length === 1 ? "" : "s"} selected
            </p>
          </div>
          <button type="button" onClick={onClose} disabled={step === "submitting"} aria-label="Close" className={styles.btnSecondary} style={{ padding: 6 }}>
            <CloseIcon size={14} />
          </button>
        </div>

        {step === "loading" && (
          <div style={{ marginTop: 16 }}>
            <Loader label="Loading ad sets…" />
          </div>
        )}

        {step === "error" && (
          <div className={styles.error} style={{ marginTop: 16 }}>
            {loadError}
          </div>
        )}

        {step === "pick" && (
          <div style={{ marginTop: 16 }}>
            <input
              type="text"
              autoFocus
              className={styles.select}
              style={{ width: "100%", marginBottom: 10 }}
              placeholder="Search ad sets or campaigns…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {filteredAdsets.length === 0 ? (
              <p className={styles.sub}>No ad sets found on this account.</p>
            ) : (
              <div style={{ border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden", maxHeight: 320, overflowY: "auto" }}>
                {filteredAdsets.map((a) => (
                  <label
                    key={a.id}
                    style={{
                      padding: "10px 14px",
                      borderBottom: "1px solid var(--border)",
                      cursor: "pointer",
                      display: "flex",
                      gap: 10,
                      alignItems: "center",
                    }}
                  >
                    <input type="checkbox" checked={selectedAdsetIds.has(a.id)} onChange={() => toggleAdset(a.id)} />
                    <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0, flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name}</div>
                      <span className={styles.muted}>
                        {a.campaign?.name ? `${a.campaign.name} · ` : ""}
                        {budgetLabel(a, currency)}
                      </span>
                    </div>
                    <span className={styles.badgeInfo} style={{ flexShrink: 0 }}>
                      {a.status}
                    </span>
                  </label>
                ))}
              </div>
            )}
            {selectedAdsetIds.size > 0 && (
              <p className={styles.sub} style={{ marginTop: 10 }}>
                {selectedAdsetIds.size} ad set{selectedAdsetIds.size === 1 ? "" : "s"} selected — {ads.length} × {selectedAdsetIds.size} ={" "}
                {ads.length * selectedAdsetIds.size} new ad{ads.length * selectedAdsetIds.size === 1 ? "" : "s"}.
              </p>
            )}
          </div>
        )}

        {step === "confirm" && (
          <div style={{ marginTop: 16 }}>
            <p className={styles.sub}>
              This creates <strong style={{ color: "var(--t1)" }}>{totalPairs}</strong> new ad{totalPairs === 1 ? "" : "s"} — each of the{" "}
              {ads.length} selected ad{ads.length === 1 ? "" : "s"}, duplicated (same creative, reused by id) into each of the {selectedAdsets.length}{" "}
              selected ad set{selectedAdsets.length === 1 ? "" : "s"} below, created paused.
            </p>
            <div style={{ display: "flex", gap: 16, marginTop: 14, flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 180 }}>
                <p className={styles.muted} style={{ marginBottom: 6 }}>
                  Ads
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 160, overflowY: "auto" }}>
                  {ads.map((ad) => (
                    <span key={ad.id} className={styles.sub} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {ad.name}
                    </span>
                  ))}
                </div>
              </div>
              <div style={{ flex: 1, minWidth: 180 }}>
                <p className={styles.muted} style={{ marginBottom: 6 }}>
                  Destination ad sets
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 160, overflowY: "auto" }}>
                  {selectedAdsets.map((a) => (
                    <span key={a.id} className={styles.sub} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {a.name}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {step === "submitting" && (
          <div style={{ marginTop: 16 }}>
            <Loader label={`Duplicating ${progress.done} of ${progress.total}…`} />
          </div>
        )}

        {step === "done" && (
          <div style={{ marginTop: 16 }}>
            <p style={{ fontWeight: 600, marginBottom: 4 }}>
              {failedResults.length === 0
                ? `All ${results.length} duplicated successfully.`
                : `${results.length - failedResults.length} of ${results.length} duplicated successfully.`}
            </p>
            <p className={styles.sub}>Every new ad was created paused — review them in Ads Manager before activating.</p>
            {failedResults.length > 0 && (
              <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6, maxHeight: 200, overflowY: "auto" }}>
                {failedResults.map((r, i) => (
                  <div key={i} className={styles.error} style={{ fontSize: 12.5 }}>
                    {r.adName} → {r.adsetName}: {r.error}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {step === "pick" && (
          <div style={{ display: "flex", gap: 10, marginTop: 18, justifyContent: "flex-end" }}>
            <button type="button" className={styles.btnSecondary} onClick={onClose}>
              Cancel
            </button>
            <button type="button" className={styles.btnPrimary} onClick={() => setStep("confirm")} disabled={selectedAdsetIds.size === 0}>
              Next
            </button>
          </div>
        )}
        {step === "confirm" && (
          <div style={{ display: "flex", gap: 10, marginTop: 18, justifyContent: "flex-end" }}>
            <button type="button" className={styles.btnSecondary} onClick={() => setStep("pick")}>
              Back
            </button>
            <button type="button" className={styles.btnPrimary} onClick={submit}>
              Duplicate {totalPairs} Ad{totalPairs === 1 ? "" : "s"}
            </button>
          </div>
        )}
        {step === "error" && (
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 18 }}>
            <button type="button" className={styles.btnSecondary} onClick={onClose}>
              Close
            </button>
          </div>
        )}
        {step === "done" && (
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 18 }}>
            <button type="button" className={styles.btnPrimary} onClick={onClose}>
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
