import { useState } from "react";
import InterestPicker from "./InterestPicker";
import CustomAudiencePicker from "./CustomAudiencePicker";
import TargetingSearchPicker from "./TargetingSearchPicker";
import { ATTRIBUTION_OPTIONS, PUBLISHER_PLATFORMS, FACEBOOK_POSITIONS, INSTAGRAM_POSITIONS } from "./AdSetFields";
import { readApiResponse } from "@/lib/fetchJson";
import { track } from "@/lib/analytics";
import styles from "@/styles/Home.module.css";

// The ad set level of Explore's "View details" drawer: every setting of the ad set as a read view, and an
// edit mode for everything Meta lets you change on a live ad set (name, status, budget, bidding, schedule,
// attribution, locations in/out, age, gender, languages, interests, audiences, placements). Saving goes
// through /api/fb/adset-update (lib/adsetEdit.js), sending only the fields that changed.

const PLACEMENT_KEYS = ["placementType", "publisherPlatforms", "facebookPositions", "instagramPositions"];
const labelOf = (list, value) => list.find((o) => o.value === value)?.label || value;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—");
const toLocalInput = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const money = (v) => (v == null ? "—" : `₹${Number(v).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`);
const humanStatus = (s) => (s ? s.toLowerCase().replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : "—");

function Card({ title, action, children }) {
  return (
    <section className={styles.dtCard}>
      {(title || action) && (
        <div className={styles.dtCardHead}>
          <span className={styles.dtLabel}>{title}</span>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

function Row({ label, children }) {
  return (
    <div className={styles.dtRow} style={{ alignItems: "flex-start" }}>
      <span className={styles.dtMeta}>{label}</span>
      <span style={{ textAlign: "right", minWidth: 0, overflowWrap: "anywhere" }}>{children}</span>
    </div>
  );
}

function Pills({ items, empty = "—" }) {
  if (!items?.length) return <span className={styles.dtEmpty}>{empty}</span>;
  return (
    <span style={{ display: "inline-flex", flexWrap: "wrap", gap: 6, justifyContent: "flex-end" }}>
      {items.map((it, i) => (
        <span key={`${it}-${i}`} className={styles.pill}>
          {it}
        </span>
      ))}
    </span>
  );
}

function Checkbox({ checked, onChange, label }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 12.5 }}>
      <input type="checkbox" checked={checked} onChange={onChange} />
      {label}
    </label>
  );
}
const toggleIn = (list, item) => (list.includes(item) ? list.filter((i) => i !== item) : [...list, item]);

export default function AdSetDetailsPanel({ adsetId, data, onNavigate, onSaved }) {
  void onNavigate;
  const initial = data.form;
  const [mode, setMode] = useState("view");
  const [draft, setDraft] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [showRaw, setShowRaw] = useState(false);

  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));
  const hasBudget = !!data.budgetType;
  const strategyNeedsBid = draft.bidStrategy === "LOWEST_COST_WITH_BID_CAP" || draft.bidStrategy === "COST_CAP";
  const startInFuture = initial.startTime && new Date(initial.startTime) > new Date();

  // Only what changed goes to the server.
  function diff() {
    const out = {};
    for (const k of Object.keys(initial)) {
      if (!same(draft[k], initial[k])) out[k] = draft[k];
    }
    if (!hasBudget) delete out.budget;
    if (!strategyNeedsBid) delete out.bidAmount;
    if (draft.bidStrategy !== "LOWEST_COST_WITH_MIN_ROAS") delete out.roasFloor;
    if (!startInFuture) delete out.startTime;
    if (PLACEMENT_KEYS.some((k) => k in out)) for (const k of PLACEMENT_KEYS) out[k] = draft[k];
    if (out.startTime) out.startTime = new Date(out.startTime).toISOString();
    if (out.endTime) out.endTime = new Date(out.endTime).toISOString();
    return out;
  }
  const edits = mode === "edit" ? diff() : {};
  const changedCount = Object.keys(edits).length;

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/fb/adset-update", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ adsetId, edits }) });
      const json = await readApiResponse(res);
      if (json.error) throw new Error(json.error);
      track("explore_adset_edited", { fields: json.changed });
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
            <label className={styles.dtLabel}>Ad set name</label>
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
            <div className={styles.dtField}>
              <label className={styles.dtLabel}>{data.budgetType === "lifetime" ? "Lifetime budget" : "Daily budget"} (₹)</label>
              <input type="number" min="1" className={styles.select} value={draft.budget ?? ""} onChange={(e) => set({ budget: e.target.value === "" ? null : Number(e.target.value) })} />
            </div>
          ) : (
            <p className={styles.dtMeta}>No budget of its own: this ad set&apos;s budget is set on the campaign.</p>
          )}
          <div className={styles.dtField}>
            <label className={styles.dtLabel}>Bid strategy</label>
            <select className={styles.select} value={draft.bidStrategy} onChange={(e) => set({ bidStrategy: e.target.value })}>
              {data.bidStrategies.map((b) => (
                <option key={b.value} value={b.value}>
                  {b.label}
                </option>
              ))}
            </select>
          </div>
          {strategyNeedsBid && (
            <div className={styles.dtField}>
              <label className={styles.dtLabel}>{draft.bidStrategy === "COST_CAP" ? "Cost per result goal" : "Bid cap"} (₹)</label>
              <input type="number" min="0" step="any" className={styles.select} value={draft.bidAmount ?? ""} onChange={(e) => set({ bidAmount: e.target.value === "" ? null : Number(e.target.value) })} />
            </div>
          )}
          {draft.bidStrategy === "LOWEST_COST_WITH_MIN_ROAS" && (
            <div className={styles.dtField}>
              <label className={styles.dtLabel}>Minimum ROAS</label>
              <input type="number" min="0" step="any" className={styles.select} value={draft.roasFloor ?? ""} onChange={(e) => set({ roasFloor: e.target.value === "" ? null : Number(e.target.value) })} />
            </div>
          )}
        </Card>

        <Card title="Schedule">
          <div className={styles.dtField}>
            <label className={styles.dtLabel}>Start</label>
            {startInFuture ? (
              <input type="datetime-local" className={styles.select} value={toLocalInput(draft.startTime)} onChange={(e) => set({ startTime: e.target.value })} />
            ) : (
              <p className={styles.dtMeta}>{fmtDate(initial.startTime)} (already started, can&apos;t be changed)</p>
            )}
          </div>
          <div className={styles.dtField}>
            <label className={styles.dtLabel}>End</label>
            <input type="datetime-local" className={styles.select} value={toLocalInput(draft.endTime)} onChange={(e) => set({ endTime: e.target.value || null })} />
            <p className={styles.dtMeta}>Leave empty to run with no end date (not allowed for a lifetime budget).</p>
          </div>
        </Card>

        <Card title="Locations">
          <TargetingSearchPicker label="Include" type="adgeolocation" placeholder="Search countries, states, cities…" values={draft.locations} onChange={(locations) => set({ locations })} />
          <div style={{ marginTop: 12 }}>
            <TargetingSearchPicker label="Exclude" type="adgeolocation" placeholder="Search places to exclude…" values={draft.excludedLocations} onChange={(excludedLocations) => set({ excludedLocations })} />
          </div>
        </Card>

        <Card title="Audience">
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginBottom: 10 }}>
            <input type="checkbox" checked={draft.advantageAudience} onChange={(e) => set({ advantageAudience: e.target.checked })} />
            Advantage+ audience (Meta may go beyond the targeting below)
          </label>
          <div style={{ display: "flex", gap: 12, marginBottom: 10 }}>
            <div className={styles.dtField} style={{ flex: 1 }}>
              <label className={styles.dtLabel}>Min age</label>
              <select className={styles.select} value={draft.ageMin} onChange={(e) => set({ ageMin: Number(e.target.value) })}>
                {Array.from({ length: 53 }, (_, i) => 13 + i).map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </div>
            <div className={styles.dtField} style={{ flex: 1 }}>
              <label className={styles.dtLabel}>Max age</label>
              <select className={styles.select} value={draft.ageMax} onChange={(e) => set({ ageMax: Number(e.target.value) })}>
                {Array.from({ length: 53 }, (_, i) => 13 + i).map((a) => (
                  <option key={a} value={a}>
                    {a === 65 ? "65+" : a}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className={styles.dtField}>
            <label className={styles.dtLabel}>Gender</label>
            <div className={styles.tabGroup}>
              {[
                { value: "all", label: "All" },
                { value: "male", label: "Male" },
                { value: "female", label: "Female" },
              ].map((g) => (
                <button key={g.value} type="button" className={draft.gender === g.value ? `${styles.tab} ${styles.tabActive}` : styles.tab} onClick={() => set({ gender: g.value })}>
                  {g.label}
                </button>
              ))}
            </div>
          </div>
          <div style={{ marginTop: 12 }}>
            <TargetingSearchPicker label="Languages (empty = all)" type="adlocale" placeholder="Search languages…" values={draft.languages} onChange={(languages) => set({ languages })} />
          </div>
          <div style={{ marginTop: 12 }}>
            <InterestPicker label="Interests" values={draft.interests} onChange={(interests) => set({ interests })} suggested={[]} />
          </div>
          {data.accountId && (
            <>
              <div style={{ marginTop: 12 }}>
                <p className={styles.dtLabel} style={{ marginBottom: 6 }}>Include custom audiences</p>
                <CustomAudiencePicker accountId={data.accountId} values={draft.customAudiences} onChange={(customAudiences) => set({ customAudiences })} />
              </div>
              <div style={{ marginTop: 12 }}>
                <p className={styles.dtLabel} style={{ marginBottom: 6 }}>Exclude custom audiences</p>
                <CustomAudiencePicker accountId={data.accountId} values={draft.excludedCustomAudiences} onChange={(excludedCustomAudiences) => set({ excludedCustomAudiences })} />
              </div>
            </>
          )}
        </Card>

        <Card title="Placements">
          <div className={styles.tabGroup} style={{ marginBottom: 10 }}>
            <button type="button" className={draft.placementType === "ADVANTAGE_PLUS" ? `${styles.tab} ${styles.tabActive}` : styles.tab} onClick={() => set({ placementType: "ADVANTAGE_PLUS" })}>
              Advantage+ Placements
            </button>
            <button
              type="button"
              className={draft.placementType === "MANUAL" ? `${styles.tab} ${styles.tabActive}` : styles.tab}
              onClick={() => set({ placementType: "MANUAL", publisherPlatforms: draft.publisherPlatforms.length ? draft.publisherPlatforms : ["facebook", "instagram"] })}
            >
              Manual Placements
            </button>
          </div>
          {draft.placementType === "MANUAL" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div>
                <p className={styles.dtLabel} style={{ marginBottom: 6 }}>Platforms</p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
                  {PUBLISHER_PLATFORMS.map((p) => (
                    <Checkbox key={p.value} label={p.label} checked={draft.publisherPlatforms.includes(p.value)} onChange={() => set({ publisherPlatforms: toggleIn(draft.publisherPlatforms, p.value) })} />
                  ))}
                </div>
              </div>
              {draft.publisherPlatforms.includes("facebook") && (
                <div>
                  <p className={styles.dtLabel} style={{ marginBottom: 6 }}>Facebook placements (none = all)</p>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
                    {FACEBOOK_POSITIONS.map((p) => (
                      <Checkbox key={p.value} label={p.label} checked={draft.facebookPositions.includes(p.value)} onChange={() => set({ facebookPositions: toggleIn(draft.facebookPositions, p.value) })} />
                    ))}
                  </div>
                </div>
              )}
              {draft.publisherPlatforms.includes("instagram") && (
                <div>
                  <p className={styles.dtLabel} style={{ marginBottom: 6 }}>Instagram placements (none = all)</p>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
                    {INSTAGRAM_POSITIONS.map((p) => (
                      <Checkbox key={p.value} label={p.label} checked={draft.instagramPositions.includes(p.value)} onChange={() => set({ instagramPositions: toggleIn(draft.instagramPositions, p.value) })} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </Card>

        <Card title="Attribution">
          <select className={styles.select} value={draft.attributionSetting} onChange={(e) => set({ attributionSetting: e.target.value })}>
            {!draft.attributionSetting && <option value="">Custom / account default</option>}
            {ATTRIBUTION_OPTIONS.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </select>
        </Card>

        <p className={styles.dtWarn}>Changing targeting, budget or bidding on a live ad set can send it back into the learning phase. The performance goal and conversion location can&apos;t be changed on an existing ad set.</p>
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
  const placementList = f.placementType === "MANUAL"
    ? [
        ...f.publisherPlatforms.map((p) => labelOf(PUBLISHER_PLATFORMS, p)),
      ]
    : ["Advantage+ Placements (automatic)"];
  return (
    <div className={styles.dtStack}>
      {notice && <div className={styles.dtNotice}>{notice}</div>}
      <Card
        title="Status"
        action={
          <button type="button" className={styles.btnPrimary} onClick={() => { setDraft(initial); setNotice(null); setMode("edit"); }}>
            Edit ad set
          </button>
        }
      >
        <div className={styles.dtRow}>
          <span className={styles.badgeInfo}>{humanStatus(data.effectiveStatus || data.status)}</span>
        </div>
        {data.campaign && (
          <>
            <Row label="Campaign">{data.campaign.name}</Row>
            <Row label="Objective">{humanStatus((data.campaign.objective || "").replace(/^OUTCOME_/, ""))}</Row>
            <Row label="Budget set on">{data.campaign.cbo ? "Campaign (CBO)" : "Ad set (ABO)"}</Row>
          </>
        )}
      </Card>

      <Card title="Budget & bidding">
        <Row label={data.budgetType === "lifetime" ? "Lifetime budget" : "Daily budget"}>{hasBudget ? money(f.budget) : "On the campaign"}</Row>
        <Row label="Bid strategy">{labelOf(data.bidStrategies.map((b) => ({ value: b.value, label: b.label })), f.bidStrategy)}</Row>
        {f.bidAmount != null && <Row label="Bid / cost goal">{money(f.bidAmount)}</Row>}
        {f.roasFloor != null && <Row label="Minimum ROAS">{f.roasFloor}</Row>}
      </Card>

      <Card title="Schedule">
        <Row label="Start">{fmtDate(f.startTime)}</Row>
        <Row label="End">{f.endTime ? fmtDate(f.endTime) : "No end date"}</Row>
      </Card>

      <Card title="Locations">
        <Row label="Included">
          <Pills items={f.locations.map((l) => l.name)} empty="None set" />
        </Row>
        <Row label="Excluded">
          <Pills items={f.excludedLocations.map((l) => l.name)} empty="None" />
        </Row>
      </Card>

      <Card title="Audience">
        <Row label="Advantage+ audience">{f.advantageAudience ? "On" : "Off"}</Row>
        <Row label="Age">{`${f.ageMin}–${f.ageMax >= 65 ? "65+" : f.ageMax}`}</Row>
        <Row label="Gender">{humanStatus(f.gender)}</Row>
        <Row label="Languages">
          <Pills items={f.languages.map((l) => l.name)} empty="All languages" />
        </Row>
        <Row label="Interests">
          <Pills items={f.interests.map((i) => i.name)} empty={f.advantageAudience ? "Advantage+ (none set)" : "Broad"} />
        </Row>
        <Row label="Custom audiences">
          <Pills items={f.customAudiences.map((a) => a.name)} empty="None" />
        </Row>
        <Row label="Excluded audiences">
          <Pills items={f.excludedCustomAudiences.map((a) => a.name)} empty="None" />
        </Row>
      </Card>

      <Card title="Placements">
        <Row label="Platforms">
          <Pills items={placementList} />
        </Row>
        {f.placementType === "MANUAL" && f.facebookPositions.length > 0 && <Row label="Facebook">{f.facebookPositions.map((p) => labelOf(FACEBOOK_POSITIONS, p)).join(", ")}</Row>}
        {f.placementType === "MANUAL" && f.instagramPositions.length > 0 && <Row label="Instagram">{f.instagramPositions.map((p) => labelOf(INSTAGRAM_POSITIONS, p)).join(", ")}</Row>}
      </Card>

      <Card title="Tracking & delivery">
        <Row label="Attribution">{f.attributionSetting ? labelOf(ATTRIBUTION_OPTIONS, f.attributionSetting) : "Custom / account default"}</Row>
        {data.info.map((r) => (
          <Row key={r.label} label={r.label}>
            {r.value}
          </Row>
        ))}
      </Card>

      {data.rawTargeting && (
        <Card
          title="Raw targeting"
          action={
            <button type="button" className={styles.dtLink} onClick={() => setShowRaw((v) => !v)}>
              {showRaw ? "Hide" : "Show"}
            </button>
          }
        >
          {showRaw ? (
            <pre style={{ margin: 0, fontSize: 11.5, whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxHeight: 320, overflow: "auto" }}>{JSON.stringify(data.rawTargeting, null, 2)}</pre>
          ) : (
            <p className={styles.dtMeta}>Everything Meta has for this ad set&apos;s targeting, including settings this form can&apos;t edit.</p>
          )}
        </Card>
      )}
    </div>
  );
}
