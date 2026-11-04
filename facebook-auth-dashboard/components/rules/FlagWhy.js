import styles from "@/styles/Home.module.css";

const OP_WORDS = { ">": "is more than", "≥": "is at least", "<": "is less than", "≤": "is at most" };
const TYPE_LABEL = { campaign: "Campaign", adset: "Ad set", ad: "Ad" };
const fmtShare = (v) => (v == null ? "—" : `${v.toFixed(1)}%`);

// The "why was this flagged" breakdown: the rule in words, then every check with this item's figure.
export default function FlagWhy({ flag }) {
  const subject = TYPE_LABEL[flag.entityType].toLowerCase();
  return (
    <div style={{ padding: "4px 4px 8px" }}>
      {flag.matchedRules.map((r) => (
        <div key={r.id} style={{ marginBottom: 12 }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 2 }}>{r.name}</div>
          <p className={styles.sub} style={{ marginBottom: 8 }}>
            The rule: {r.text} Every check below passed, so this {subject} was flagged.
          </p>
          {r.conditions.map((c, i) => (
            <div key={i} style={{ display: "flex", gap: 10, padding: "6px 0", borderTop: i ? "1px solid var(--border)" : "none", alignItems: "flex-start" }}>
              <span style={{ color: "var(--green)", fontWeight: 700, lineHeight: "18px" }}>✓</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600 }}>{c.label}</div>
                {c.hint && (
                  <div className={styles.muted} style={{ fontWeight: 400, marginTop: 1 }}>
                    {c.hint}
                  </div>
                )}
                <div style={{ fontSize: 12.5, marginTop: 3 }}>
                  {c.op ? (
                    <>
                      <span className={styles.muted}>This {subject}: </span>
                      <strong>{c.actual}</strong>
                      <span className={styles.muted}> {OP_WORDS[c.op]} </span>
                      <strong>{c.target}</strong>
                    </>
                  ) : (
                    <>
                      <strong>Yes</strong>
                      {c.target && <span className={styles.muted}> · {c.target}</span>}
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      ))}
      {flag.adContext && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>About this ad</div>
          <div style={{ fontSize: 12.5, display: "flex", flexDirection: "column", gap: 3 }}>
            <div>
              <span className={styles.muted}>Active ads in its ad set: </span>
              <strong>{flag.adContext.activeAdsInAdset}</strong>
            </div>
            <div>
              <span className={styles.muted}>Share of the ad set&apos;s spend: </span>
              <strong>{fmtShare(flag.adContext.spendShare[3])}</strong>
              <span className={styles.muted}> in the last 3 days · </span>
              <strong>{fmtShare(flag.adContext.spendShare[7])}</strong>
              <span className={styles.muted}> in the last 7 days</span>
            </div>
          </div>
        </div>
      )}
      {flag.hiddenConflicts.length > 0 && (
        <p className={styles.muted} style={{ fontWeight: 400 }}>
          A conflicting rule also matched ({flag.hiddenConflicts.join(", ")}) but the stronger one is shown.
        </p>
      )}
    </div>
  );
}

