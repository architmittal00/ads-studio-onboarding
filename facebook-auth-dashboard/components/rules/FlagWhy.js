import styles from "@/styles/Home.module.css";

const OP_SHORT = { ">": "more than", "≥": "at least", "<": "less than", "≤": "at most" };
const TYPE_LABEL = { campaign: "Campaign", adset: "Ad set", ad: "Ad" };
const fmtShare = (v) => (v == null ? "—" : `${v.toFixed(1)}%`);

// The "why was this flagged" breakdown. Per rule: its name and one-line meaning, then a table of every check —
// what was measured, this item's figure, what it needed to beat — so nothing has to be read as a sentence.
const GRID = "minmax(0, 1.6fr) minmax(90px, 0.6fr) minmax(110px, 0.6fr)";

export function WhyChecks({ flag }) {
  const subject = TYPE_LABEL[flag.entityType].toLowerCase();
  return (
    <div>
      {flag.matchedRules.map((r) => (
        <section key={r.id} style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
            <span style={{ fontWeight: 600, fontSize: 13.5 }}>{r.name}</span>
            <span className={styles.badgeGood}>
              All {r.conditions.length} check{r.conditions.length === 1 ? "" : "s"} passed
            </span>
          </div>
          <p className={styles.sub} style={{ marginBottom: 10, maxWidth: "70ch" }}>
            {r.text}
          </p>
          <div style={{ border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
            <div style={{ display: "grid", gridTemplateColumns: GRID, gap: 12, padding: "7px 12px", background: "var(--card)", fontSize: 10, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", color: "var(--t3)" }}>
              <span>Check</span>
              <span style={{ textAlign: "right" }}>This {subject}</span>
              <span style={{ textAlign: "right" }}>Needs to be</span>
            </div>
            {r.conditions.map((c, i) =>
              c.either ? (
                <div key={i} style={{ borderTop: "1px solid var(--border)" }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "9px 12px 4px" }}>
                    <span style={{ color: "var(--green)", fontWeight: 700, lineHeight: "18px" }}>✓</span>
                    <span style={{ fontSize: 13, fontWeight: 500 }}>{c.label}</span>
                    <span className={styles.badgeInfo}>either one is enough</span>
                  </div>
                  {c.either.map((o, j) => (
                    <div key={j} style={{ display: "grid", gridTemplateColumns: GRID, gap: 12, padding: "6px 12px 8px 36px", alignItems: "start", opacity: o.ok ? 1 : 0.6 }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 500, overflowWrap: "anywhere" }}>
                          <span style={{ color: o.ok ? "var(--green)" : "var(--t3)", fontWeight: 700, marginRight: 6 }}>{o.ok ? "✓" : "✗"}</span>
                          {o.label}
                        </div>
                        {o.hint && (
                          <div className={styles.muted} style={{ fontWeight: 400, marginTop: 2, overflowWrap: "anywhere" }}>
                            {o.hint}
                          </div>
                        )}
                      </div>
                      <strong style={{ textAlign: "right", fontSize: 13 }}>{o.actual}</strong>
                      <span style={{ textAlign: "right", fontSize: 13 }}>
                        <span className={styles.muted}>{OP_SHORT[o.op]} </span>
                        <strong>{o.target}</strong>
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
              <div key={i} style={{ display: "grid", gridTemplateColumns: GRID, gap: 12, padding: "9px 12px", borderTop: "1px solid var(--border)", alignItems: "start" }}>
                <div style={{ display: "flex", gap: 8, minWidth: 0 }}>
                  <span style={{ color: "var(--green)", fontWeight: 800, lineHeight: "18px" }}>✓</span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, overflowWrap: "anywhere" }}>{c.label}</div>
                    {c.hint && (
                      <div className={styles.muted} style={{ fontWeight: 400, marginTop: 2, overflowWrap: "anywhere" }}>
                        {c.hint}
                      </div>
                    )}
                  </div>
                </div>
                {c.op ? (
                  <>
                    <strong style={{ textAlign: "right", fontSize: 13 }}>{c.actual}</strong>
                    <span style={{ textAlign: "right", fontSize: 13 }}>
                      <span className={styles.muted}>{OP_SHORT[c.op]} </span>
                      <strong>{c.target}</strong>
                    </span>
                  </>
                ) : (
                  <>
                    <strong style={{ textAlign: "right", fontSize: 13 }}>Yes</strong>
                    <span className={styles.muted} style={{ textAlign: "right", fontWeight: 400, overflowWrap: "anywhere" }}>
                      {c.target || ""}
                    </span>
                  </>
                )}
              </div>
            )
            )}
          </div>
        </section>
      ))}
    </div>
  );
}

export default function FlagWhy({ flag }) {
  return (
    <div style={{ padding: "8px 8px 10px", maxWidth: 860 }}>
      <WhyChecks flag={flag} />
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

