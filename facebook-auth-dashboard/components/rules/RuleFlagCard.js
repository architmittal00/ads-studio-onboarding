import { useState } from "react";
import { ChevronIcon } from "@/components/icons";
import styles from "@/styles/Home.module.css";

const ACTION_META = {
  INCREASE_BUDGET: { label: "Increase budget", color: "var(--green)" },
  DECREASE_BUDGET: { label: "Decrease budget", color: "var(--amber)" },
  PAUSE_AD: { label: "Pause ad", color: "var(--red)" },
};
const TYPE_LABEL = { campaign: "Campaign", adset: "Ad set", ad: "Ad" };

function money(v, symbol) {
  return `${symbol}${Math.round(v).toLocaleString("en-IN")}`;
}

export default function RuleFlagCard({ flag, currencySymbol, accountRoas7, applied, onAct }) {
  const [open, setOpen] = useState(false);
  const meta = ACTION_META[flag.action];
  const canApply = flag.action === "PAUSE_AD" || !!flag.budgetTarget;
  return (
    <div className={styles.card} style={{ padding: 0, opacity: applied ? 0.7 : 1, borderLeft: `4px solid ${meta.color}` }}>
      <div style={{ padding: "14px 16px", display: "flex", gap: 14, flexWrap: "wrap", alignItems: "flex-start", justifyContent: "space-between" }}>
        <div style={{ minWidth: 0, flex: "1 1 280px" }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4, flexWrap: "wrap" }}>
            <span className={styles.badgeInfo}>{TYPE_LABEL[flag.entityType]}</span>
            <span style={{ fontWeight: 700, fontSize: 14, overflowWrap: "anywhere" }}>{flag.name}</span>
          </div>
          {(flag.campaignName || flag.adsetName) && (
            <div className={styles.muted} style={{ fontSize: 12, marginBottom: 8, overflowWrap: "anywhere" }}>
              {[flag.campaignName, flag.adsetName].filter(Boolean).join(" › ")}
            </div>
          )}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
            {flag.matchedRules.map((r) => (
              <span key={r.id} className={styles.badgeWarn} style={{ fontSize: 11 }}>
                {r.name}
              </span>
            ))}
          </div>
          <div style={{ display: "flex", gap: 18, flexWrap: "wrap", fontSize: 12.5 }}>
            <span>
              <span className={styles.muted}>7d spend </span>
              <strong>{money(flag.stats.spend7, currencySymbol)}</strong>
            </span>
            <span>
              <span className={styles.muted}>7d ROAS </span>
              <strong>{flag.stats.roas7 != null ? flag.stats.roas7.toFixed(2) : "—"}</strong>
              {accountRoas7 != null && <span className={styles.muted}> (account {accountRoas7.toFixed(2)})</span>}
            </span>
            <span>
              <span className={styles.muted}>7d purchases </span>
              <strong>{Math.round(flag.stats.purchases7)}</strong>
            </span>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end", flexShrink: 0 }}>
          {applied ? (
            <span style={{ color: "var(--green)", fontWeight: 700, fontSize: 13 }}>✓ {applied}</span>
          ) : canApply ? (
            <button type="button" className={styles.btnPrimary} onClick={() => onAct(flag)}>
              {meta.label}
              {flag.budgetTarget && ` (${money(flag.budgetTarget.current, currencySymbol)}/${flag.budgetTarget.type === "lifetime" ? "life" : "day"})`}
            </button>
          ) : (
            <span className={styles.muted} style={{ maxWidth: 220, textAlign: "right", fontSize: 12 }}>
              {meta.label} suggested. {flag.budgetNote}
            </span>
          )}
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className={styles.btnSecondary}
            style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "5px 10px", fontSize: 12 }}
          >
            Why flagged
            <ChevronIcon direction={open ? "up" : "down"} size={12} />
          </button>
        </div>
      </div>

      {open && (
        <div style={{ borderTop: "1px solid var(--border)", padding: "12px 16px" }}>
          {flag.matchedRules.map((r) => (
            <div key={r.id} style={{ marginBottom: 12 }}>
              <div style={{ fontWeight: 600, fontSize: 12.5, marginBottom: 6 }}>{r.name}</div>
              {r.conditions.map((c, i) => (
                <div key={i} style={{ display: "flex", gap: 8, fontSize: 12.5, padding: "2px 0", alignItems: "baseline" }}>
                  <span style={{ color: "var(--green)", fontWeight: 700 }}>✓</span>
                  <span className={styles.sub} style={{ flex: 1 }}>
                    {c.label}
                  </span>
                  <span style={{ fontWeight: 600, whiteSpace: "nowrap" }}>
                    {c.actual} {c.op} {c.target}
                  </span>
                </div>
              ))}
            </div>
          ))}
          {flag.hiddenConflicts.length > 0 && (
            <p className={styles.muted} style={{ fontSize: 11.5 }}>
              A conflicting rule also matched ({flag.hiddenConflicts.join(", ")}) but the stronger one is shown.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
