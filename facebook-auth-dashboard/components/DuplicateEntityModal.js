import { parseJsonResponse } from "@/lib/fetchJson";
import { responseError } from "@/lib/fetchJson";
import { useEffect, useState } from "react";
import Loader from "./Loader";
import { CloseIcon, ChevronIcon } from "./icons";
import { toMajorUnits } from "@/lib/reportShared";
import styles from "@/styles/Home.module.css";

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

// Minimal searchable list for the "choose a different ad set/campaign"
// escape hatch — a smaller, modal-sized cousin of pages/launch.js's own
// PickerList (kept separate rather than shared, same reasoning that file's
// own comment gives: each caller wants slightly different row content).
function PickerList({ items, query, onQueryChange, emptyLabel, renderRow }) {
  const filtered = query.trim() ? items.filter((i) => i.name.toLowerCase().includes(query.trim().toLowerCase())) : items;
  return (
    <div>
      <input
        type="text"
        autoFocus
        className={styles.select}
        style={{ width: "100%", marginBottom: 10 }}
        placeholder="Search…"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
      />
      {filtered.length === 0 ? (
        <p className={styles.sub}>{emptyLabel}</p>
      ) : (
        <div style={{ border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden", maxHeight: 280, overflowY: "auto" }}>
          {filtered.map((item) => renderRow(item))}
        </div>
      )}
    </div>
  );
}

function PickerRow({ item, subtitle, badge, onClick }) {
  return (
    <div
      onClick={onClick}
      style={{
        padding: "10px 14px",
        borderBottom: "1px solid var(--border)",
        cursor: "pointer",
        display: "flex",
        justifyContent: "space-between",
        gap: 8,
        alignItems: "center",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.name}</div>
        {subtitle && <span className={styles.muted}>{subtitle}</span>}
      </div>
      {badge && (
        <span className={styles.badgeInfo} style={{ flexShrink: 0 }}>
          {badge}
        </span>
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

// The "Duplicate" row action's own popup — opened in place over Explore
// instead of navigating to the Launch tab (same reasoning as RowActions'
// existing budget-change modal: this is still fundamentally a "confirm a
// change to one row and get right back to what you were doing" interaction,
// just a multi-step creation instead of a single Graph call). The
// destination (campaign, and for an ad, ad set too) is never pre-picked —
// every path here starts unresolved and the marketer explicitly chooses
// both, rather than this modal silently recommending "same place it already
// lives" and hoping a "Change" button gets noticed when it's wrong.
//
// Reuses the exact same backend this app already had for duplication:
// pages/api/fb/ads-list.js + pages/api/fb/duplicate-ad.js for a single ad,
// pages/api/fb/adsets-list.js (?adsetId=, already resolving the ad set's own
// settings + its ads' creative ids) + pages/api/fb/launch-campaign.js for an
// ad set and all of its ads. Everything is created paused, same safety
// pattern as every object this app creates.
export default function DuplicateEntityModal({ level, row, currency, onClose }) {
  const accountId = row.accountId;
  const [step, setStep] = useState("loading"); // loading | error | confirm | pick_destination | done
  const [loadError, setLoadError] = useState(null);
  // Which destination the "pick_destination" step is choosing — only ever
  // "adset" for an "adset" duplication (there's no ad-set-level destination
  // to pick, the new ad set itself IS the thing being placed into a
  // campaign). An "ad" duplication can go either way: picking a campaign
  // first narrows the ad-set list to it, but `adsetChoices` is always
  // loaded in full up front (see the load effect below), so a campaign
  // isn't actually REQUIRED before picking an ad set directly — reported by
  // a user who already knew which ad set they wanted and didn't want to
  // find its campaign first just to unlock the picker.
  const [pickTarget, setPickTarget] = useState(null); // "campaign" | "adset"

  // "ad" duplication
  const [adSource, setAdSource] = useState(null);
  const [adName, setAdName] = useState("");
  // Not shown as an editable field by default — see the "confirm" step's
  // name row below. Reported by a user who wanted to be able to tweak the
  // auto-generated "<original> - Copy" name (e.g. to update a stale date
  // baked into their own naming convention) but didn't want an extra text
  // field competing for attention in the common case of just accepting it.
  const [editingAdName, setEditingAdName] = useState(false);
  const [destinationCampaign, setDestinationCampaign] = useState(null);
  const [adDestination, setAdDestination] = useState(null);
  const [adsetChoices, setAdsetChoices] = useState([]);

  // "adset" duplication
  const [adsetSource, setAdsetSource] = useState(null);
  const [campaignChoices, setCampaignChoices] = useState([]);
  const [selectedCampaign, setSelectedCampaign] = useState(null);
  const [budgetAmount, setBudgetAmount] = useState("");

  const [pickerQuery, setPickerQuery] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [progressMessage, setProgressMessage] = useState(null);
  const [submitError, setSubmitError] = useState(null);
  const [result, setResult] = useState(null);

  useEffect(() => {
    function handleKey(e) {
      if (e.key === "Escape" && !submitting) onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [submitting, onClose]);

  // One-time load of the source entity (+ the candidate destinations, needed
  // either immediately for the default or later if "Change" is clicked —
  // fetched up front either way since it's one cheap list call).
  useEffect(() => {
    if (level === "ad") {
      Promise.all([
        fetch(`/api/fb/ads-list?adId=${encodeURIComponent(row.entityId)}`).then((res) => res.json()),
        fetch(`/api/fb/adsets-list?accountId=${encodeURIComponent(accountId)}`).then((res) => res.json()),
        fetch(`/api/fb/campaigns-list?accountId=${encodeURIComponent(accountId)}`).then((res) => res.json()),
      ])
        .then(([adJson, adsetsJson, campaignsJson]) => {
          if (adJson.error) {
            setLoadError(adJson.error);
            setStep("error");
            return;
          }
          setAdSource(adJson);
          setAdName(`${adJson.name} - Copy`);
          setAdsetChoices(adsetsJson.adsets || []);
          setCampaignChoices(campaignsJson.campaigns || []);
          setStep("confirm");
        })
        .catch((err) => {
          setLoadError(err.message);
          setStep("error");
        });
    } else {
      Promise.all([
        fetch(`/api/fb/adsets-list?adsetId=${encodeURIComponent(row.entityId)}`).then((res) => res.json()),
        fetch(`/api/fb/campaigns-list?accountId=${encodeURIComponent(accountId)}`).then((res) => res.json()),
      ])
        .then(([adsetJson, campaignsJson]) => {
          if (adsetJson.error) {
            setLoadError(adsetJson.error);
            setStep("error");
            return;
          }
          setAdsetSource(adsetJson);
          setCampaignChoices(campaignsJson.campaigns || []);
          setBudgetAmount(adsetJson.fields.budgetAmount || "");
          setStep("confirm");
        })
        .catch((err) => {
          setLoadError(err.message);
          setStep("error");
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-time load keyed to the specific row this modal was opened for
  }, []);

  // A destination campaign that already carries its own daily/lifetime
  // budget is CBO (ad sets under it can't also have one); one with neither
  // is ABO, so the new ad set needs its own budget amount — mirrors
  // pages/launch.js's own campaignHasOwnBudget exactly, just derived from
  // whichever campaign is currently selected here instead of a form field.
  const adsetBudgetIsUsed = level === "adset" && !!selectedCampaign && !(selectedCampaign.daily_budget || selectedCampaign.lifetime_budget);
  const adsetBudgetValid = !adsetBudgetIsUsed || (Number.isFinite(parseFloat(budgetAmount)) && parseFloat(budgetAmount) > 0);

  function submitAd() {
    if (submitting || !adName.trim() || !adDestination) return;
    setSubmitting(true);
    setSubmitError(null);
    fetch("/api/fb/duplicate-ad", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountId, sourceAdId: adSource.id, destinationAdsetId: adDestination.id, name: adName }),
    })
      .then((res) => parseJsonResponse(res).catch((e) => ({ error: e.message })).then((json) => ({ ok: res.ok, json })))
      .then(({ ok, json }) => {
        if (!ok) {
          setSubmitError(json.error || "Request failed — no details were returned");
          return;
        }
        setResult(json);
        setStep("done");
      })
      .catch((err) => setSubmitError(err.message))
      .finally(() => setSubmitting(false));
  }

  async function submitAdset() {
    if (submitting || !selectedCampaign || !adsetBudgetValid) return;
    setSubmitting(true);
    setSubmitError(null);
    setProgressMessage("Starting…");
    try {
      const res = await fetch("/api/fb/launch-campaign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId,
          existingCampaignId: selectedCampaign.id,
          budgetStrategy: adsetBudgetIsUsed ? "ABO" : "CBO",
          budgetType: adsetSource.fields.budgetType,
          budgetAmount: adsetBudgetIsUsed ? budgetAmount : undefined,
          adset: adsetSource.fields,
          duplicateAds: adsetSource.ads,
          status: "PAUSED",
        }),
      });
      if (!res.ok || !res.body) {
        throw await responseError(res);
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
    } catch (err) {
      setSubmitError(err.message);
    } finally {
      setSubmitting(false);
      setProgressMessage(null);
    }
  }

  const adsetCount = adsetSource?.ads?.length || 0;
  const canSubmit =
    level === "ad" ? !!adName.trim() && !!destinationCampaign && !!adDestination : !!selectedCampaign && adsetBudgetValid;

  return (
    <div
      onClick={submitting ? undefined : onClose}
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
        style={{ background: "var(--bg)", width: "min(480px, 100%)", maxHeight: "85vh", overflowY: "auto", display: "flex", flexDirection: "column" }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
          <div>
            <h2 className={styles.h2} style={{ marginBottom: 2 }}>
              {step === "pick_destination"
                ? pickTarget === "adset"
                  ? "Choose a destination ad set"
                  : "Choose a destination campaign"
                : `Duplicate ${level === "ad" ? "ad" : "ad set"}`}
            </h2>
            <p className={styles.sub}>
              {level === "ad" ? "Ad" : "Ad set"}: {row.entityLabel || row.label}
            </p>
          </div>
          <button type="button" onClick={onClose} disabled={submitting} aria-label="Close" className={styles.btnSecondary} style={{ padding: 6 }}>
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

        {step === "pick_destination" && (
          <div style={{ marginTop: 16 }}>
            <BackLink onClick={() => setStep("confirm")} />
            {pickTarget === "adset" ? (
              <PickerList
                // Only narrowed to one campaign once a campaign has actually
                // been chosen (via the "Destination campaign" row) — picking
                // an ad set directly, with no campaign pre-selected, searches
                // every ad set on the account instead of staying stuck
                // showing none until a campaign is chosen first.
                items={destinationCampaign ? adsetChoices.filter((a) => a.campaign?.id === destinationCampaign.id) : adsetChoices}
                query={pickerQuery}
                onQueryChange={setPickerQuery}
                emptyLabel={destinationCampaign ? "No ad sets found in this campaign." : "No ad sets found on this account."}
                renderRow={(a) => (
                  <PickerRow
                    key={a.id}
                    item={a}
                    // Campaign name shown here since the list isn't always
                    // pre-filtered to one campaign anymore — otherwise two
                    // same-named ad sets in different campaigns would be
                    // indistinguishable.
                    subtitle={`${a.campaign?.name ? `${a.campaign.name} · ` : ""}${budgetLabel(a, currency)}`}
                    badge={a.status}
                    onClick={() => {
                      setAdDestination(a);
                      // Picking an ad set directly also resolves its
                      // campaign, so the "Destination campaign" row above
                      // reflects it immediately instead of still reading
                      // "Not selected yet" after a destination was already
                      // fully chosen.
                      setDestinationCampaign(a.campaign || null);
                      setStep("confirm");
                    }}
                  />
                )}
              />
            ) : (
              <PickerList
                items={campaignChoices}
                query={pickerQuery}
                onQueryChange={setPickerQuery}
                emptyLabel="No campaigns found on this account."
                renderRow={(c) => (
                  <PickerRow
                    key={c.id}
                    item={c}
                    subtitle={budgetLabel(c, currency)}
                    badge={c.effective_status}
                    onClick={() => {
                      if (level === "ad") {
                        // Switching the destination campaign invalidates
                        // whatever ad set was already picked — it almost
                        // certainly belongs to the OLD campaign, and
                        // adsetChoices is filtered by campaign id above, so
                        // keeping it would show a destination ad set the
                        // filtered picker can't even reach.
                        setDestinationCampaign(c);
                        setAdDestination(null);
                      } else {
                        setSelectedCampaign(c);
                      }
                      setStep("confirm");
                    }}
                  />
                )}
              />
            )}
          </div>
        )}

        {step === "confirm" && level === "ad" && (
          <div style={{ marginTop: 16 }}>
            <p className={styles.sub}>
              This creates an exact copy of <strong style={{ color: "var(--t1)" }}>{adSource.name}</strong> — same creative, reused by
              id (so a partnership/branded-content ad duplicates correctly too) — created paused.
            </p>
            <div style={{ marginTop: 14, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <div style={{ minWidth: 0 }}>
                <p className={styles.sub} style={{ marginBottom: 2 }}>
                  Destination campaign
                </p>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{destinationCampaign?.name || "Not selected yet"}</div>
              </div>
              <button
                type="button"
                className={styles.btnSecondary}
                onClick={() => {
                  setPickerQuery("");
                  setPickTarget("campaign");
                  setStep("pick_destination");
                }}
              >
                {destinationCampaign ? "Change" : "Choose"}
              </button>
            </div>
            <div style={{ marginTop: 10, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <div style={{ minWidth: 0 }}>
                <p className={styles.sub} style={{ marginBottom: 2 }}>
                  Destination ad set
                </p>
                <div style={{ fontWeight: 600, fontSize: 13, color: adDestination ? "var(--t1)" : "var(--t3)" }}>
                  {adDestination?.name || "Not selected yet"}
                </div>
              </div>
              <button
                type="button"
                className={styles.btnSecondary}
                onClick={() => {
                  setPickerQuery("");
                  setPickTarget("adset");
                  setStep("pick_destination");
                }}
              >
                {adDestination ? "Change" : "Choose"}
              </button>
            </div>
            <div style={{ marginTop: 14, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <p className={styles.sub} style={{ marginBottom: 2 }}>
                  Name for the new ad
                </p>
                {editingAdName ? (
                  <input
                    type="text"
                    autoFocus
                    className={styles.select}
                    style={{ width: "100%" }}
                    value={adName}
                    onChange={(e) => setAdName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && e.target.blur()}
                    onBlur={() => setEditingAdName(false)}
                  />
                ) : (
                  <div style={{ fontWeight: 600, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{adName}</div>
                )}
              </div>
              {!editingAdName && (
                <button type="button" className={styles.btnSecondary} onClick={() => setEditingAdName(true)}>
                  Edit
                </button>
              )}
            </div>
          </div>
        )}

        {step === "confirm" && level === "adset" && (
          <div style={{ marginTop: 16 }}>
            <p className={styles.sub}>
              This creates an exact copy of <strong style={{ color: "var(--t1)" }}>{adsetSource.name}</strong>
              {adsetCount > 0 && (
                <>
                  {" "}
                  and its {adsetCount} ad{adsetCount === 1 ? "" : "s"} (same creative, reused by id)
                </>
              )}{" "}
              — same targeting, created paused.
            </p>
            <div style={{ marginTop: 14, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <div style={{ minWidth: 0 }}>
                <p className={styles.sub} style={{ marginBottom: 2 }}>
                  Destination campaign
                </p>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{selectedCampaign?.name || "Not selected yet"}</div>
              </div>
              <button
                type="button"
                className={styles.btnSecondary}
                onClick={() => {
                  setPickerQuery("");
                  setPickTarget("campaign");
                  setStep("pick_destination");
                }}
              >
                {selectedCampaign ? "Change" : "Choose"}
              </button>
            </div>
            {adsetBudgetIsUsed && (
              <div style={{ marginTop: 14 }}>
                <p className={styles.sub} style={{ marginBottom: 6 }}>
                  {selectedCampaign?.id === adsetSource.campaignId ? "This campaign has no campaign-level budget, so the " : "The "}
                  new ad set&apos;s {adsetSource.fields.budgetType === "LIFETIME" ? "lifetime" : "daily"} budget
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

        {step === "done" && (
          <div style={{ marginTop: 16 }}>
            <p style={{ fontWeight: 600, marginBottom: 4 }}>Duplicated successfully.</p>
            <p className={styles.sub}>
              {level === "ad"
                ? `The new ad was created paused in "${adDestination.name}".`
                : `The new ad set${adsetCount > 0 ? ` and its ${adsetCount} ad${adsetCount === 1 ? "" : "s"}` : ""} ${
                    adsetCount > 0 ? "were" : "was"
                  } created paused in "${selectedCampaign.name}".`}
            </p>
            {result && !result.success && (
              <p className={styles.sub} style={{ color: "var(--amber)", marginTop: 8 }}>
                Some steps had errors — check Ads Manager before activating.
              </p>
            )}
          </div>
        )}

        {submitError && (
          <div className={styles.error} style={{ marginTop: 14 }}>
            {submitError}
          </div>
        )}

        {step === "confirm" && (
          <div style={{ display: "flex", gap: 10, marginTop: 18, justifyContent: "flex-end" }}>
            <button type="button" className={styles.btnSecondary} onClick={onClose} disabled={submitting}>
              Cancel
            </button>
            <button type="button" className={styles.btnPrimary} onClick={level === "ad" ? submitAd : submitAdset} disabled={submitting || !canSubmit}>
              {submitting ? progressMessage || "Duplicating…" : "Duplicate"}
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
