import { useEffect, useState } from "react";
import { CloseIcon } from "@/components/icons";
import FlagWhy from "@/components/rules/FlagWhy";
import RuleActionModal, { STEP_PCT } from "@/components/rules/RuleActionModal";
import { currencySymbolOf } from "@/lib/rules/leanFlag";
import styles from "@/styles/Home.module.css";

const ACTION_TEXT = { INCREASE_BUDGET: "Budget could go up", DECREASE_BUDGET: "Budget could come down", PAUSE_AD: "Consider pausing", ADD_CREATIVE: "Room for a new creative" };
const ACTION_LABEL = { INCREASE_BUDGET: "Increase budget", DECREASE_BUDGET: "Decrease budget", PAUSE_AD: "Pause ad", ADD_CREATIVE: "Add a creative" };
const TONE = { INCREASE_BUDGET: ["var(--green)", "var(--green-rgb)"], DECREASE_BUDGET: ["var(--amber)", "var(--amber-rgb)"], PAUSE_AD: ["var(--red)", "var(--red-rgb)"], ADD_CREATIVE: ["var(--blue)", "var(--blue-rgb)"] };
const TYPE_LABEL = { campaign: "Campaign", adset: "Ad set", ad: "Ad" };

const money = (v, symbol) => `${symbol}${Math.round(v).toLocaleString("en-IN")}`;

// A small "!" beside a row the rules flagged; hover says why in a line, click opens the quick-action window.
export function AttentionMark({ flag, onOpen }) {
  if (!flag) return null;
  const [tone] = TONE[flag.action] || TONE.DECREASE_BUDGET;
  const names = flag.matchedRules.map((r) => r.name).join(", ");
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onOpen?.(flag);
      }}
      title={`${ACTION_TEXT[flag.action] || "Needs a look"} — ${names}. Click for the recommendation.`}
      aria-label={`Needs attention: ${names}`}
      style={{
        flexShrink: 0,
        width: 16,
        height: 16,
        padding: 0,
        borderRadius: "50%",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 11,
        fontWeight: 800,
        lineHeight: 1,
        cursor: "pointer",
        color: tone,
        background: `color-mix(in srgb, ${tone} 15%, transparent)`,
        border: `1px solid color-mix(in srgb, ${tone} 45%, transparent)`,
      }}
    >
      !
    </button>
  );
}

// "Checking rules…" while the background check runs, then how many rows need attention.
export function AttentionStatus({ state }) {
  if (state.total === 0) return null;
  if (state.loading) {
    return (
      <span className={styles.muted} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontWeight: 400 }} title="Checking this account against your rules in the background">
        <span className={`${styles.spinner} ${styles.spinnerSm}`} />
        Checking rules{state.total > 1 ? ` (${state.done}/${state.total})` : ""}…
      </span>
    );
  }
  const n = state.count;
  if (n > 0) {
    return (
      <span className={styles.muted} style={{ color: "var(--amber)", fontWeight: 700 }} title="Rows marked with ! match one of your rules">
        ! {n} need{n === 1 ? "s" : ""} attention
      </span>
    );
  }
  if (state.failed === state.total) return <span className={styles.muted} style={{ fontWeight: 400 }}>Rule check unavailable</span>;
  return (
    <span className={styles.muted} style={{ fontWeight: 400 }}>
      ✓ Nothing flagged by rules
    </span>
  );
}

// What the "!" opens: a short summary of why the row was flagged and the one-click action, without
// leaving the view. `currency` is the ad account's currency code; `onApplied(entityId, patch)` lets the
// view update the row.
export function AttentionPopover({ flag, currency, onClose, onApplied }) {
  const [acting, setActing] = useState(false);
  const symbol = currencySymbolOf(currency);
  const [tone, rgb] = TONE[flag.action] || TONE.DECREASE_BUDGET;
  const t = flag.budgetTarget;
  const actionable = flag.action === "PAUSE_AD" || !!t;
  const next = t ? Math.max(1, Math.round(t.current * (1 + (flag.action === "INCREASE_BUDGET" ? 1 : -1) * (STEP_PCT / 100)))) : null;

  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape" && !acting) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [acting, onClose]);

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 700, padding: 16 }}>
        <div onClick={(e) => e.stopPropagation()} className={styles.card} style={{ background: "var(--bg)", width: "min(560px, 100%)", maxHeight: "88vh", overflowY: "auto" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, marginBottom: 12 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 2 }}>
                <span className={styles.badgeInfo}>{TYPE_LABEL[flag.entityType]}</span>
                <span className={styles.muted}>needs attention</span>
              </div>
              <h2 className={styles.h2} style={{ overflowWrap: "anywhere" }}>
                {flag.name}
              </h2>
            </div>
            <button type="button" onClick={onClose} aria-label="Close" className={styles.btnSecondary} style={{ padding: 6 }}>
              <CloseIcon size={14} />
            </button>
          </div>

          <div className={styles.statBar} style={{ marginBottom: 14 }}>
            <div className={styles.stat}>
              <div className={styles.statLabel}>7d spend</div>
              <div className={styles.statValue} style={{ fontSize: 15 }}>
                {money(flag.stats.spend7, symbol)}
              </div>
            </div>
            <div className={styles.stat}>
              <div className={styles.statLabel}>7d ROAS</div>
              <div className={styles.statValue} style={{ fontSize: 15 }}>
                {flag.stats.roas7 != null ? flag.stats.roas7.toFixed(2) : "—"}
              </div>
            </div>
            <div className={styles.stat}>
              <div className={styles.statLabel}>7d purchases</div>
              <div className={styles.statValue} style={{ fontSize: 15 }}>
                {Math.round(flag.stats.purchases7)}
              </div>
            </div>
          </div>

          <div style={{ border: `1px solid rgba(${rgb}, 0.35)`, background: `rgba(${rgb}, 0.08)`, borderRadius: 10, padding: "10px 12px", display: "flex", gap: 12, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", marginBottom: 14 }}>
            <div>
              <div style={{ fontWeight: 700, color: tone }}>{ACTION_TEXT[flag.action]}</div>
              {t && (
                <div className={styles.sub}>
                  {money(t.current, symbol)} → <strong style={{ color: "var(--t1)" }}>{money(next, symbol)}</strong>/{t.type === "lifetime" ? "life" : "day"} ({STEP_PCT}%)
                  {t.level === "campaign" && flag.entityType !== "campaign" ? " on the campaign" : ""}
                </div>
              )}
              {!actionable && flag.budgetNote && <div className={styles.sub}>{flag.budgetNote}</div>}
              {flag.action === "ADD_CREATIVE" && <div className={styles.sub}>Upload a fresh ad to this ad set.</div>}
            </div>
            {actionable && (
              <button
                type="button"
                onClick={() => setActing(true)}
                style={{ padding: "7px 14px", borderRadius: 8, fontSize: 12.5, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap", color: tone, background: `rgba(${rgb}, 0.14)`, border: `1px solid rgba(${rgb}, 0.4)` }}
              >
                {t ? `${ACTION_LABEL[flag.action]} ${STEP_PCT}%` : ACTION_LABEL[flag.action]}
              </button>
            )}
          </div>

          <h3 className={styles.h2} style={{ fontSize: 13, marginBottom: 6 }}>
            Why it was flagged
          </h3>
          <FlagWhy flag={flag} />
        </div>
      </div>
      {acting && (
        <RuleActionModal
          flag={flag}
          currencySymbol={symbol}
          onClose={() => setActing(false)}
          onApplied={(text, result) => {
            setActing(false);
            onApplied(result.entityId, result.patch);
          }}
        />
      )}
    </>
  );
}
