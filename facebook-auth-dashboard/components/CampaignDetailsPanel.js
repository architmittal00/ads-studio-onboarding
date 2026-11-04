import { useState } from "react";
import { Card, Row, same, fmtDate, toLocalInput, money, humanStatus } from "./DetailParts";
import { readApiResponse } from "@/lib/fetchJson";
import { track } from "@/lib/analytics";
import styles from "@/styles/Home.module.css";

// The campaign level of Explore's "View details" drawer: every setting as a read view, and an edit mode for
// what Meta lets you change on a live campaign (name, status, its own budget amount, bid strategy, spend cap,
// stop time). Saving goes through /api/fb/campaign-update (lib/campaignEdit.js), sending only what changed.
// Objective, buying type and special ad categories can't be changed after creation: shown read-only.

export default function CampaignDetailsPanel({ campaignId, data, onSaved }) {
  const initial = data.form;
  const [mode, setMode] = useState("view");
  const [draft, setDraft] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));
  const hasBudget = !!data.budgetType;
  const strategyLabel = (v) => data.bidStrategies.find((b) => b.value === v)?.label || humanStatus(v);

  function diff() {
    const out = {};
    for (const k of Object.keys(initial)) if (!same(draft[k], initial[k])) out[k] = draft[k];
    if (!hasBudget) {
      delete out.budget;
      delete out.bidStrategy; // a campaign-level bid strategy only exists with a campaign budget
    }
    if (out.stopTime) out.stopTime = new Date(out.stopTime).toISOString();
    else delete out.stopTime; // clearing a stop time isn't supported here
    return out;
  }
  const edits = mode === "edit" ? diff() : {};
  const changedCount = Object.keys(edits).length;

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/fb/campaign-update", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ campaignId, edits }) });
      const json = await readApiResponse(res);
      if (json.error) throw new Error(json.error);
      track("explore_campaign_edited", { fields: json.changed });
      setNotice(json.changed?.length ? `Saved: ${json.changed.join(", ")}.` : "Nothing to save.");
      setMode("view");
      onSaved?.({ changed: json.changed || [], status: edits.status, name: edits.name, budget: edits.budget });
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (mode === "edit") {
    return (
      <div className={styles.dtStack}>
        <Card title="Basics">
          <div className={styles.dtField}>
            <label className={styles.dtLabel}>Campaign name</label>
            <input type="text" className={styles.select} value={draft.name} onChange={(e) => set({ name: e.target.value })} />
          </div>
          <div className={styles.dtField}>
            <label className={styles.dtLabel}>Status</label>
            <div className={styles.tabGroup}>
              {["ACTIVE", "PAUSED"].map((s) => (
                <button key={s} type="button" className={draft.status === s ? `${styles.tab} ${styles.tabActive}` : styles.tab} onClick={() => set({ status: s })}>
                  {humanStatus(s)}
                </button>
              ))}
            </div>
          </div>
        </Card>

        <Card title="Budget & bidding">
          {hasBudget ? (
            <>
              <div className={styles.dtField}>
                <label className={styles.dtLabel}>{data.budgetType === "lifetime" ? "Lifetime budget" : "Daily budget"} (₹)</label>
                <input type="number" min="1" className={styles.select} value={draft.budget ?? ""} onChange={(e) => set({ budget: e.target.value === "" ? null : Number(e.target.value) })} />
              </div>
              <div className={styles.dtField}>
                <label className={styles.dtLabel}>Bid strategy</label>
                <select className={styles.select} value={draft.bidStrategy} onChange={(e) => set({ bidStrategy: e.target.value })}>
                  {data.bidStrategies.map((b) => (
                    <option key={b.value} value={b.value}>
                      {b.label}
                    </option>
                  ))}
                </select>
                <p className={styles.dtMeta}>Cap and goal strategies also need amounts on the ad sets.</p>
              </div>
            </>
          ) : (
            <p className={styles.dtMeta}>No budget of its own: budgets are set on each ad set (ABO), so there is nothing to edit here.</p>
          )}
          <div className={styles.dtField}>
            <label className={styles.dtLabel}>Spend cap (₹, empty = none)</label>
            <input type="number" min="0" step="any" className={styles.select} value={draft.spendCap ?? ""} onChange={(e) => set({ spendCap: e.target.value === "" ? null : Number(e.target.value) })} />
            <p className={styles.dtMeta}>The most this campaign can ever spend in total.</p>
          </div>
        </Card>

        <Card title="Schedule">
          <div className={styles.dtField}>
            <label className={styles.dtLabel}>Start</label>
            <p className={styles.dtMeta}>{fmtDate(data.startTime)} (can&apos;t be changed here)</p>
          </div>
          <div className={styles.dtField}>
            <label className={styles.dtLabel}>Stop</label>
            <input type="datetime-local" className={styles.select} value={toLocalInput(draft.stopTime)} onChange={(e) => set({ stopTime: e.target.value || null })} />
          </div>
        </Card>

        <p className={styles.dtWarn}>The objective, buying type and special ad categories can&apos;t be changed on an existing campaign. Budget and bid changes can send its ad sets back into the learning phase.</p>
        {error && <div className={styles.error}>{error}</div>}
        <div className={styles.dtSaveBar}>
          <button type="button" className={styles.btnSecondary} onClick={() => { setDraft(initial); setError(null); setMode("view"); }} disabled={saving}>
            Cancel
          </button>
          <button type="button" className={styles.btnPrimary} style={{ flex: 1 }} disabled={saving || changedCount === 0} onClick={save}>
            {saving ? "Saving…" : changedCount ? `Save ${changedCount} change${changedCount === 1 ? "" : "s"}` : "No changes"}
          </button>
        </div>
      </div>
    );
  }

  const f = initial;
  return (
    <div className={styles.dtStack}>
      {notice && <div className={styles.dtNotice}>{notice}</div>}
      <Card
        title="Status"
        action={
          <button type="button" className={styles.btnPrimary} onClick={() => { setDraft(initial); setNotice(null); setMode("edit"); }}>
            Edit campaign
          </button>
        }
      >
        <div className={styles.dtRow}>
          <span className={styles.badgeInfo}>{humanStatus(data.effectiveStatus || data.status)}</span>
        </div>
        <Row label="Objective">{data.objective || "—"}</Row>
        <Row label="Budget set on">{hasBudget ? "Campaign (CBO)" : "Ad sets (ABO)"}</Row>
      </Card>

      <Card title="Budget & bidding">
        <Row label={data.budgetType === "lifetime" ? "Lifetime budget" : "Daily budget"}>{hasBudget ? money(f.budget) : "On the ad sets"}</Row>
        {hasBudget && <Row label="Bid strategy">{strategyLabel(f.bidStrategy)}</Row>}
        <Row label="Spend cap">{f.spendCap != null ? money(f.spendCap) : "None"}</Row>
      </Card>

      <Card title="Schedule">
        <Row label="Start">{fmtDate(data.startTime)}</Row>
        <Row label="Stop">{f.stopTime ? fmtDate(f.stopTime) : "No stop date"}</Row>
      </Card>

      {data.info.length > 0 && (
        <Card title="Other settings">
          {data.info.map((r) => (
            <Row key={r.label} label={r.label}>
              {r.value}
            </Row>
          ))}
        </Card>
      )}
    </div>
  );
}
