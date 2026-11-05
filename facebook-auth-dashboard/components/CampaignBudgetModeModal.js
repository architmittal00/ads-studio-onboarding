import { useEffect, useMemo, useState } from "react";
import { CloseIcon } from "@/components/icons";
import { readApiResponse } from "@/lib/fetchJson";
import { track } from "@/lib/analytics";
import styles from "@/styles/Home.module.css";

const money = (v) => `₹${Math.round(v).toLocaleString("en-IN")}`;
const sum = (list) => list.reduce((t, v) => t + (Number(v) || 0), 0);

// Switch a campaign between ONE budget on the campaign (CBO) and a budget on each ad set (ABO), from the
// campaign "View details" drawer. Campaign budget -> ad set budgets: you give every ad set an amount (pre-filled
// as an equal split of today's budget). Ad set budgets -> campaign budget: you give the campaign one amount
// (pre-filled with what the ad sets add up to). Goes through /api/fb/campaign-budget-mode; Meta's own message
// is shown if it refuses, and nothing changes in that case.
export default function CampaignBudgetModeModal({ campaignId, campaignName, budgetType, budget, onClose, onDone }) {
  const toAdsets = !!budgetType; // has a campaign budget today -> moving it onto the ad sets
  const [adsets, setAdsets] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [amounts, setAmounts] = useState({}); // ad set id -> typed amount
  const [type, setType] = useState("daily");
  const [campaignAmount, setCampaignAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/fb/campaign-budget-mode?id=${encodeURIComponent(campaignId)}`)
      .then(readApiResponse)
      .then((json) => {
        if (cancelled) return;
        if (json.error) throw new Error(json.error);
        const list = json.adsets || [];
        setAdsets(list);
        if (toAdsets) {
          const each = list.length ? Math.max(1, Math.round(budget / list.length)) : 0;
          setAmounts(Object.fromEntries(list.map((a) => [a.id, String(each)])));
        } else {
          const lifetimeOnly = list.length > 0 && list.every((a) => a.lifetimeBudget != null && a.dailyBudget == null);
          const t = lifetimeOnly ? "lifetime" : "daily";
          setType(t);
          setCampaignAmount(String(Math.round(sum(list.map((a) => (t === "lifetime" ? a.lifetimeBudget : a.dailyBudget))))));
        }
      })
      .catch((err) => !cancelled && setLoadError(err.message));
    return () => {
      cancelled = true;
    };
  }, [campaignId, toAdsets, budget]);

  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape" && !busy) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const total = useMemo(() => sum(Object.values(amounts)), [amounts]);
  const valid = toAdsets
    ? adsets?.length > 0 && adsets.every((a) => Number(amounts[a.id]) > 0)
    : Number(campaignAmount) > 0 && adsets != null;

  function splitEqually() {
    const each = Math.max(1, Math.round(budget / adsets.length));
    setAmounts(Object.fromEntries(adsets.map((a) => [a.id, String(each)])));
  }

  async function apply() {
    setBusy(true);
    setError(null);
    try {
      const body = toAdsets
        ? { campaignId, to: "adset", budgets: adsets.map((a) => ({ adsetId: a.id, amount: Number(amounts[a.id]) })) }
        : { campaignId, to: "campaign", budget: Number(campaignAmount), budgetType: type };
      const res = await fetch("/api/fb/campaign-budget-mode", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const json = await readApiResponse(res);
      if (json.error) throw new Error(json.error);
      track("campaign_budget_mode_switched", { to: body.to });
      onDone({ to: body.to });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div onClick={busy ? undefined : onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 900, padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} className={styles.card} style={{ background: "var(--bg)", width: "min(540px, 100%)", maxHeight: "90vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, marginBottom: 10 }}>
          <div style={{ minWidth: 0 }}>
            <h2 className={styles.h2} style={{ marginBottom: 2 }}>
              {toAdsets ? "Switch to ad set budgets" : "Switch to a campaign budget"}
            </h2>
            <p className={styles.sub} style={{ overflowWrap: "anywhere" }}>
              {campaignName}
            </p>
          </div>
          <button type="button" onClick={onClose} disabled={busy} aria-label="Close" className={styles.btnSecondary} style={{ padding: 6, flexShrink: 0 }}>
            <CloseIcon size={14} />
          </button>
        </div>

        {loadError && <div className={styles.error}>{loadError}</div>}
        {!adsets && !loadError && <p className={styles.sub}>Loading ad sets…</p>}

        {adsets && toAdsets && (
          <>
            <p className={styles.sub} style={{ marginBottom: 10 }}>
              The campaign&apos;s {budgetType} budget of <strong style={{ color: "var(--t1)" }}>{money(budget)}</strong> is removed and each ad set gets its own {budgetType} budget. Meta stops moving money between ad sets.
            </p>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <span className={styles.dtLabel}>
                {adsets.length} ad set{adsets.length === 1 ? "" : "s"}
              </span>
              <button type="button" className={styles.dtLink} onClick={splitEqually}>
                Split equally
              </button>
            </div>
            <div style={{ border: "1px solid var(--border)", borderRadius: 10, maxHeight: 280, overflowY: "auto" }}>
              {adsets.map((a, i) => (
                <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 12px", borderTop: i ? "1px solid var(--border)" : "none" }}>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, overflowWrap: "anywhere" }}>{a.name}</span>
                  <input
                    type="number"
                    min="1"
                    aria-label={`${budgetType} budget for ${a.name}`}
                    className={styles.select}
                    style={{ width: 110 }}
                    value={amounts[a.id] ?? ""}
                    onChange={(e) => setAmounts((prev) => ({ ...prev, [a.id]: e.target.value }))}
                  />
                </div>
              ))}
            </div>
            <p className={styles.muted} style={{ marginTop: 8, fontWeight: 400 }}>
              Total {money(total)} vs the campaign&apos;s {money(budget)} today
              {budget && Math.abs(total - budget) / budget >= 0.0005 ? ` (${total > budget ? "+" : ""}${(((total - budget) / budget) * 100).toFixed(1)}%)` : " (about the same)"}.
            </p>
          </>
        )}

        {adsets && !toAdsets && (
          <>
            <p className={styles.sub} style={{ marginBottom: 10 }}>
              Ad set budgets are replaced by one budget on the campaign, which Meta then spreads across its {adsets.length} ad set{adsets.length === 1 ? "" : "s"}. The amount below is what the ad sets add up to today.
            </p>
            <div className={styles.dtField}>
              <label className={styles.dtLabel}>Budget type</label>
              <div className={styles.tabGroup}>
                {["daily", "lifetime"].map((t) => (
                  <button key={t} type="button" className={type === t ? `${styles.tab} ${styles.tabActive}` : styles.tab} onClick={() => setType(t)}>
                    {t === "daily" ? "Daily" : "Lifetime"}
                  </button>
                ))}
              </div>
            </div>
            <div className={styles.dtField} style={{ marginTop: 10 }}>
              <label className={styles.dtLabel}>Campaign {type} budget (₹)</label>
              <input type="number" min="1" className={styles.select} style={{ width: 160 }} value={campaignAmount} onChange={(e) => setCampaignAmount(e.target.value)} />
            </div>
            <p className={styles.muted} style={{ marginTop: 8, fontWeight: 400 }}>
              Meta&apos;s API documentation doesn&apos;t describe this direction. If Meta refuses, its reason is shown here and nothing is changed; the switch can then be done in Ads Manager.
            </p>
          </>
        )}

        {adsets && <p className={styles.dtWarn} style={{ marginTop: 12 }}>This can send the ad sets back into the learning phase. {toAdsets && adsets.length > 70 ? "Meta doesn't allow this on campaigns with more than 70 ad sets." : ""}</p>}
        {error && (
          <div className={styles.error} style={{ marginTop: 12 }}>
            {error}
          </div>
        )}
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 16 }}>
          <button type="button" className={styles.btnSecondary} onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className={styles.btnPrimary} onClick={apply} disabled={busy || !valid}>
            {busy ? "Switching…" : toAdsets ? "Switch to ad set budgets" : "Switch to campaign budget"}
          </button>
        </div>
      </div>
    </div>
  );
}
