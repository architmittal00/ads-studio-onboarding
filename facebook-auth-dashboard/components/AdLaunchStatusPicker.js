import styles from "@/styles/Home.module.css";

// "Create the duplicate paused or live?" — paused is the default and the safe
// choice (review in Ads Manager first); active starts delivery as soon as Meta
// approves the ad, so it can begin spending immediately. Used by both ad
// duplication flows (single: DuplicateEntityModal, bulk: BulkDuplicateAdsModal).
export const AD_LAUNCH_STATUSES = [
  { value: "PAUSED", label: "Paused", hint: "Review in Ads Manager before it can spend" },
  { value: "ACTIVE", label: "Active", hint: "Goes live right away and can start spending" },
];

export default function AdLaunchStatusPicker({ value, onChange, plural = false, disabled = false }) {
  return (
    <div style={{ marginTop: 14 }}>
      <p className={styles.sub} style={{ marginBottom: 6 }}>
        Launch as
      </p>
      <div className={styles.tabGroup} role="radiogroup" aria-label="Launch status">
        {AD_LAUNCH_STATUSES.map((s) => (
          <button
            key={s.value}
            type="button"
            role="radio"
            aria-checked={value === s.value}
            disabled={disabled}
            className={value === s.value ? `${styles.tab} ${styles.tabActive}` : styles.tab}
            onClick={() => onChange(s.value)}
          >
            {s.label}
          </button>
        ))}
      </div>
      <p className={styles.muted} style={{ marginTop: 6, fontSize: 12, color: value === "ACTIVE" ? "var(--amber)" : undefined }}>
        {value === "ACTIVE"
          ? `${plural ? "These ads go" : "This ad goes"} live as soon as Meta approves ${plural ? "them" : "it"} and can start spending right away. An ad in a paused ad set or campaign still won't deliver until that is turned on.`
          : AD_LAUNCH_STATUSES[0].hint + "."}
      </p>
    </div>
  );
}
