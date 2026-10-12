import styles from "@/styles/Home.module.css";

export const CAMPAIGN_OBJECTIVES = [
  { value: "OUTCOME_SALES", label: "Sales" },
  { value: "OUTCOME_TRAFFIC", label: "Traffic" },
  { value: "OUTCOME_LEADS", label: "Leads" },
  { value: "OUTCOME_ENGAGEMENT", label: "Engagement" },
  { value: "OUTCOME_AWARENESS", label: "Awareness" },
  { value: "OUTCOME_APP_PROMOTION", label: "App Promotion" },
];

// Cost Cap/Bid Cap need a companion bid_amount (an ad-set-level field in
// Meta's API) that this first version doesn't collect yet — picking one of
// these still launches, Facebook's own rejection (if any) surfaces through
// the normal per-step error display rather than silently misconfiguring
// anything, same "best-effort, fail loud" treatment as the Advantage+ and
// Attribution fields in lib/campaignLaunch.js.
const BID_STRATEGIES = [
  { value: "LOWEST_COST_WITHOUT_CAP", label: "Highest volume (recommended)" },
  { value: "COST_CAP", label: "Cost cap" },
  { value: "LOWEST_COST_WITH_BID_CAP", label: "Bid cap" },
];

// Campaign-level fields for the Launch tab. `value`/`onChange` is the
// {name, objective, advantagePlus, bidStrategy} slice of the page's state —
// budget strategy/amount and status live one level up (pages/launch.js)
// since Meta's own convention is that CBO/ABO decides whether the *same*
// budget input applies at the campaign or the ad set, not two separate
// inputs — see pages/launch.js's comment for the full reasoning.
export default function CampaignFields({ value, onChange }) {
  function set(patch) {
    onChange({ ...value, ...patch });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <p className={styles.sub} style={{ marginBottom: 6 }}>
          Campaign name
        </p>
        <input
          type="text"
          className={styles.select}
          style={{ width: "100%" }}
          placeholder="e.g. D2C-Sales-Prospecting-Oct"
          value={value.name}
          onChange={(e) => set({ name: e.target.value })}
        />
      </div>

      <div>
        <p className={styles.sub} style={{ marginBottom: 6 }}>
          Campaign objective
        </p>
        <select className={styles.select} style={{ width: "100%" }} value={value.objective} onChange={(e) => set({ objective: e.target.value })}>
          {CAMPAIGN_OBJECTIVES.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <p className={styles.sub} style={{ marginBottom: 6 }}>
          Campaign setup
        </p>
        <div className={styles.tabGroup}>
          <button
            type="button"
            className={!value.advantagePlus ? `${styles.tab} ${styles.tabActive}` : styles.tab}
            onClick={() => set({ advantagePlus: false })}
          >
            Manual
          </button>
          <button
            type="button"
            className={value.advantagePlus ? `${styles.tab} ${styles.tabActive}` : styles.tab}
            onClick={() => set({ advantagePlus: true })}
          >
            Advantage+ Shopping
          </button>
        </div>
      </div>

      <div>
        <p className={styles.sub} style={{ marginBottom: 6 }}>
          Bid strategy
        </p>
        <select
          className={styles.select}
          style={{ width: "100%" }}
          value={value.bidStrategy}
          onChange={(e) => set({ bidStrategy: e.target.value })}
        >
          {BID_STRATEGIES.map((b) => (
            <option key={b.value} value={b.value}>
              {b.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
