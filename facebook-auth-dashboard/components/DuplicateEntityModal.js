import { responseError } from "@/lib/fetchJson";
import { useEffect, useMemo, useState } from "react";
import Loader from "./Loader";
import { CloseIcon } from "./icons";
import { toMajorUnits } from "@/lib/reportShared";
import styles from "@/styles/Home.module.css";
import { cachedGet, invalidateCachedGets } from "@/lib/cachedGet";

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

// The "Duplicate" row action's own popup — opened in place over Explore
// instead of navigating to the Launch tab (same reasoning as RowActions'
// existing budget-change modal: this is still fundamentally a "confirm a
// change to one row and get right back to what you were doing" interaction,
// just a multi-step creation instead of a single Graph call). The
// destination campaigns are never pre-picked — the marketer ticks one or
// more of them, and the ad set (with its ads) is created once in each.
//
// Reuses the exact same backend this app already had for duplication:
// pages/api/fb/adsets-list.js (?adsetId=, already resolving the ad set's own
// settings + its ads' creative ids) + pages/api/fb/launch-campaign.js for an
// ad set and all of its ads. Everything is created paused, same safety
// pattern as every object this app creates.
//
// Ad duplication lives in components/BulkDuplicateAdsModal.js (multiple ad
// sets, editable names); this popup is only ever opened for an ad set.
export default function DuplicateEntityModal({ row, currency, onClose }) {
  const accountId = row.accountId;
  const [step, setStep] = useState("loading"); // loading | error | pick | confirm | submitting | done
  const [loadError, setLoadError] = useState(null);
  const [adsetSource, setAdsetSource] = useState(null);
  const [campaignChoices, setCampaignChoices] = useState([]);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [query, setQuery] = useState("");
  const [nameEdit, setNameEdit] = useState(null);
  const [budgetAmount, setBudgetAmount] = useState("");
  const [progressMessage, setProgressMessage] = useState(null);
  const [results, setResults] = useState([]);

  useEffect(() => {
    function handleKey(e) {
      if (e.key === "Escape" && step !== "submitting") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [step, onClose]);

  // Source ad set + the account's campaigns load together; the picker needs both.
  useEffect(() => {
    Promise.all([
      cachedGet(`/api/fb/campaigns-list?accountId=${encodeURIComponent(accountId)}`),
      fetch(`/api/fb/adsets-list?adsetId=${encodeURIComponent(row.entityId)}`).then((res) => res.json()),
    ])
      .then(([campaignsJson, adsetJson]) => {
        if (campaignsJson?.error || adsetJson?.error) {
          setLoadError(campaignsJson?.error || adsetJson.error);
          setStep("error");
          return;
        }
        setCampaignChoices(campaignsJson.campaigns || []);
        setAdsetSource(adsetJson);
        setBudgetAmount(adsetJson.fields.budgetAmount || "");
        setStep("pick");
      })
      .catch((err) => {
        setLoadError(err.message);
        setStep("error");
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-time load keyed to the specific row this modal was opened for
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? campaignChoices.filter((c) => c.name.toLowerCase().includes(q)) : campaignChoices;
  }, [campaignChoices, query]);

  function toggle(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const selected = campaignChoices.filter((c) => selectedIds.has(c.id));
  // A destination campaign with its own daily/lifetime budget is CBO (the ad set can't carry
  // one); one with neither is ABO, so the copy needs its own amount — same rule as pages/launch.js.
  const isAbo = (c) => !(c.daily_budget || c.lifetime_budget);
  const needsBudget = selected.some(isAbo);
  const budgetValid = !needsBudget || (Number.isFinite(parseFloat(budgetAmount)) && parseFloat(budgetAmount) > 0);
  const copyName = nameEdit ?? (adsetSource ? `${adsetSource.name} - Copy` : "");

  async function duplicateInto(campaign) {
    const abo = isAbo(campaign);
    const res = await fetch("/api/fb/launch-campaign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accountId,
        existingCampaignId: campaign.id,
        budgetStrategy: abo ? "ABO" : "CBO",
        budgetType: adsetSource.fields.budgetType,
        budgetAmount: abo ? budgetAmount : undefined,
        adset: { ...adsetSource.fields, name: copyName.trim() || adsetSource.name },
        duplicateAds: adsetSource.ads,
        status: "PAUSED",
      }),
    });
    if (!res.ok || !res.body) throw await responseError(res);
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
        if (event.type === "progress") setProgressMessage(`${campaign.name}: ${event.message}`);
        else if (event.type === "done") finalResult = event;
      }
    }
    return finalResult;
  }

  async function submit() {
    if (selected.length === 0 || !budgetValid) return;
    setStep("submitting");
    const collected = [];
    // One destination at a time — each creates an ad set plus all of its ads.
    for (const campaign of selected) {
      try {
        const r = await duplicateInto(campaign);
        const failed = (r?.steps || []).find((st) => !st.success);
        collected.push({ campaignName: campaign.name, success: !!r?.success, error: failed?.error || (r?.success ? null : "Something went wrong") });
      } catch (err) {
        collected.push({ campaignName: campaign.name, success: false, error: err.message });
      }
    }
    setResults(collected);
    invalidateCachedGets();
    setProgressMessage(null);
    setStep("done");
  }

  const adCount = adsetSource?.ads?.length || 0;
  const failed = results.filter((r) => !r.success);
  const busy = step === "submitting";

  return (
    <div
      onClick={busy ? undefined : onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.65)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 800, padding: 24 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={styles.card}
        style={{ background: "var(--bg)", width: "min(520px, 100%)", maxHeight: "85vh", overflowY: "auto", display: "flex", flexDirection: "column" }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
          <div>
            <h2 className={styles.h2} style={{ marginBottom: 2 }}>
              {step === "pick" ? "Choose destination campaigns" : "Duplicate ad set"}
            </h2>
            <p className={styles.sub}>Ad set: {row.entityLabel || row.label}</p>
          </div>
          <button type="button" onClick={onClose} disabled={busy} aria-label="Close" className={styles.btnSecondary} style={{ padding: 6 }}>
            <CloseIcon size={14} />
          </button>
        </div>

        {step === "loading" && (
          <div style={{ marginTop: 16 }}>
            <Loader label="Loading…" />
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
              placeholder="Search campaigns…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {filtered.length === 0 ? (
              <p className={styles.sub}>No campaigns found on this account.</p>
            ) : (
              <div style={{ border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden", maxHeight: 320, overflowY: "auto" }}>
                {filtered.map((c) => (
                  <label key={c.id} style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)", cursor: "pointer", display: "flex", gap: 10, alignItems: "center" }}>
                    <input type="checkbox" checked={selectedIds.has(c.id)} onChange={() => toggle(c.id)} />
                    <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0, flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</div>
                      <span className={styles.muted}>{budgetLabel(c, currency)}</span>
                    </div>
                    <span className={styles.badgeInfo} style={{ flexShrink: 0 }}>
                      {c.effective_status}
                    </span>
                  </label>
                ))}
              </div>
            )}
            {selectedIds.size > 0 && (
              <p className={styles.sub} style={{ marginTop: 10 }}>
                {selectedIds.size} campaign{selectedIds.size === 1 ? "" : "s"} selected.
              </p>
            )}
          </div>
        )}

        {step === "confirm" && (
          <div style={{ marginTop: 16 }}>
            <p className={styles.sub}>
              This creates a copy of <strong style={{ color: "var(--t1)" }}>{adsetSource.name}</strong>
              {adCount > 0 && ` and its ${adCount} ad${adCount === 1 ? "" : "s"} (same creative, reused by id)`} in each of the{" "}
              {selected.length} selected campaign{selected.length === 1 ? "" : "s"} — same targeting, created paused.
            </p>
            <p className={styles.muted} style={{ margin: "14px 0 6px" }}>
              Name of the new ad set
            </p>
            <input type="text" className={styles.select} style={{ width: "100%" }} value={copyName} onChange={(e) => setNameEdit(e.target.value)} />
            <p className={styles.muted} style={{ margin: "14px 0 6px" }}>
              Destination campaigns
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 140, overflowY: "auto" }}>
              {selected.map((c) => (
                <span key={c.id} className={styles.sub} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {c.name}
                  {isAbo(c) ? "" : " · campaign budget"}
                </span>
              ))}
            </div>
            {needsBudget && (
              <div style={{ marginTop: 14 }}>
                <p className={styles.sub} style={{ marginBottom: 6 }}>
                  {selected.every(isAbo) ? "These campaigns have" : "Some of these campaigns have"} no campaign-level budget, so the new ad set&apos;s{" "}
                  {adsetSource.fields.budgetType === "LIFETIME" ? "lifetime" : "daily"} budget is needed
                </p>
                <input
                  type="number"
                  min="1"
                  className={styles.select}
                  style={{ width: "100%" }}
                  placeholder={`Enter an amount (${currency || "₹"})`}
                  value={budgetAmount}
                  onChange={(e) => setBudgetAmount(e.target.value)}
                />
              </div>
            )}
          </div>
        )}

        {step === "submitting" && (
          <div style={{ marginTop: 16 }}>
            <Loader label={progressMessage || "Duplicating…"} />
          </div>
        )}

        {step === "done" && (
          <div style={{ marginTop: 16 }}>
            <p style={{ fontWeight: 600, marginBottom: 4 }}>
              {failed.length === 0 ? `Duplicated into ${results.length} campaign${results.length === 1 ? "" : "s"}.` : `${results.length - failed.length} of ${results.length} duplicated.`}
            </p>
            <p className={styles.sub}>Everything was created paused — review in Ads Manager before activating.</p>
            {failed.length > 0 && (
              <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6, maxHeight: 200, overflowY: "auto" }}>
                {failed.map((r, i) => (
                  <div key={i} className={styles.error} style={{ fontSize: 12.5 }}>
                    {r.campaignName}: {r.error}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div style={{ display: "flex", gap: 10, marginTop: 18, justifyContent: "flex-end" }}>
          {step === "pick" && (
            <>
              <button type="button" className={styles.btnSecondary} onClick={onClose}>
                Cancel
              </button>
              <button type="button" className={styles.btnPrimary} onClick={() => setStep("confirm")} disabled={selectedIds.size === 0}>
                Next
              </button>
            </>
          )}
          {step === "confirm" && (
            <>
              <button type="button" className={styles.btnSecondary} onClick={() => setStep("pick")}>
                Back
              </button>
              <button type="button" className={styles.btnPrimary} onClick={submit} disabled={!budgetValid}>
                Duplicate into {selected.length} campaign{selected.length === 1 ? "" : "s"}
              </button>
            </>
          )}
          {(step === "error" || step === "done") && (
            <button type="button" className={step === "done" ? styles.btnPrimary : styles.btnSecondary} onClick={onClose}>
              {step === "done" ? "Done" : "Close"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
