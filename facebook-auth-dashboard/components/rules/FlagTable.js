import { useMemo, useState } from "react";
import SortableTable from "@/components/SortableTable";
import Thumb from "@/components/Thumb";
import { STEP_PCT } from "@/components/rules/RuleActionModal";
import styles from "@/styles/Home.module.css";

const ACTION_META = {
  INCREASE_BUDGET: { label: "Increase budget", badge: styles.badgeGood },
  DECREASE_BUDGET: { label: "Decrease budget", badge: styles.badgeWarn },
  PAUSE_AD: { label: "Pause ad", badge: styles.badgeDanger },
};
const OP_WORDS = { ">": "is more than", "≥": "is at least", "<": "is less than", "≤": "is at most" };
const TYPE_LABEL = { campaign: "Campaign", adset: "Ad set", ad: "Ad" };
const COLUMN_COUNT = 7;

const money = (v, symbol) => `${symbol}${Math.round(v).toLocaleString("en-IN")}`;

// The "why was this flagged" breakdown: the rule in words, then every check with this item's figure.
function Why({ flag }) {
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
      {flag.hiddenConflicts.length > 0 && (
        <p className={styles.muted} style={{ fontWeight: 400 }}>
          A conflicting rule also matched ({flag.hiddenConflicts.join(", ")}) but the stronger one is shown.
        </p>
      )}
    </div>
  );
}

// Flagged items as the app's shared sortable table; "Why" opens the breakdown under the row.
// `thumbs`: ad id -> { thumbnailUrl, isVideo } | null once loaded (missing while still loading).
export default function FlagTable({ flags, currencySymbol, accountRoas7, applied, thumbs, onAct, onOpenThumb }) {
  const [open, setOpen] = useState({});
  const rows = useMemo(() => flags.map((f) => ({ ...f, id: f.key, spend7: f.stats.spend7, roas7: f.stats.roas7, purchases7: f.stats.purchases7, ruleText: f.matchedRules.map((r) => r.name).join(", ") })), [flags]);

  const columns = [
    {
      key: "name",
      label: "Flagged item",
      render: (r) => {
        const thumb = r.entityType === "ad" ? thumbs[r.entityId] : undefined;
        return (
          <div style={{ display: "flex", gap: 10, alignItems: "flex-start", minWidth: 200, maxWidth: 300 }}>
            {r.entityType === "ad" && (
              <Thumb size={44} src={thumb?.thumbnailUrl} isVideo={!!thumb?.isVideo} loading={thumb === undefined} onClick={thumb?.thumbnailUrl || thumb?.isVideo ? () => onOpenThumb(r, thumb) : undefined} />
            )}
            <div style={{ minWidth: 0 }}>
              <div style={{ display: "flex", gap: 6, alignItems: "baseline", flexWrap: "wrap" }}>
                <span className={styles.badgeInfo}>{TYPE_LABEL[r.entityType]}</span>
                <span style={{ fontWeight: 600, overflowWrap: "anywhere" }}>{r.name}</span>
              </div>
              {r.campaignName && (
                <div className={styles.muted} style={{ fontWeight: 400, overflowWrap: "anywhere" }}>
                  Campaign: {r.campaignName}
                </div>
              )}
              {r.adsetName && (
                <div className={styles.muted} style={{ fontWeight: 400, overflowWrap: "anywhere" }}>
                  Ad set: {r.adsetName}
                </div>
              )}
            </div>
          </div>
        );
      },
    },
    {
      key: "ruleText",
      label: "Rule",
      render: (r) => (
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", minWidth: 90, maxWidth: 150 }}>
          {r.matchedRules.map((m) => (
            <span key={m.id} className={styles.badgeWarn}>
              {m.name}
            </span>
          ))}
        </div>
      ),
    },
    { key: "spend7", label: "7d spend", align: "right", render: (r) => money(r.spend7, currencySymbol) },
    {
      key: "roas7",
      label: "7d ROAS",
      align: "right",
      render: (r) => (
        <>
          {r.roas7 != null ? r.roas7.toFixed(2) : "—"}
          {accountRoas7 != null && <div className={styles.muted} style={{ fontWeight: 400 }}>acct {accountRoas7.toFixed(2)}</div>}
        </>
      ),
    },
    { key: "purchases7", label: "7d purch.", align: "right", render: (r) => Math.round(r.purchases7) },
    {
      key: "action",
      label: "Suggested",
      render: (r) => {
        const meta = ACTION_META[r.action];
        const t = r.budgetTarget;
        const next = t ? Math.max(1, Math.round(t.current * (1 + (r.action === "INCREASE_BUDGET" ? 1 : -1) * (STEP_PCT / 100)))) : null;
        return (
          <div style={{ minWidth: 120, maxWidth: 170 }}>
            <span className={meta.badge}>{meta.label}</span>
            {t && (
              <div className={styles.muted} style={{ fontWeight: 400, marginTop: 3 }}>
                {money(t.current, currencySymbol)} → <strong style={{ color: "var(--t1)" }}>{money(next, currencySymbol)}</strong>/{t.type === "lifetime" ? "life" : "day"} ({STEP_PCT}%)
              </div>
            )}
            {!t && r.action !== "PAUSE_AD" && r.budgetNote && (
              <div className={styles.muted} style={{ fontWeight: 400, marginTop: 3, maxWidth: 170 }}>
                {r.budgetNote}
              </div>
            )}
          </div>
        );
      },
    },
    {
      key: "act",
      label: "",
      sortValue: () => 0,
      align: "right",
      render: (r) => {
        const canApply = r.action === "PAUSE_AD" || !!r.budgetTarget;
        return (
          <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", alignItems: "center", whiteSpace: "nowrap" }}>
            {applied[r.key] ? (
              <span style={{ color: "var(--green)", fontWeight: 700, fontSize: 12 }}>✓ {applied[r.key]}</span>
            ) : (
              canApply && (
                <button type="button" className={styles.rowActionBtn} onClick={() => onAct(r)}>
                  Apply
                </button>
              )
            )}
            <button type="button" className={styles.rowActionBtn} onClick={() => setOpen((o) => ({ ...o, [r.key]: !o[r.key] }))}>
              {open[r.key] ? "Hide why" : "Why"}
            </button>
          </div>
        );
      },
    },
  ];

  return (
    <SortableTable
      columns={columns}
      rows={rows}
      defaultSortKey="spend7"
      maxHeight={760}
      rowKey={(r) => r.key}
      searchable
      searchKeys={["name"]}
      searchPlaceholder="Search by ad, ad set or campaign name, or by rule…"
      searchMatch={(r, term) => `${r.name} ${r.campaignName || ""} ${r.adsetName || ""} ${r.ruleText} ${TYPE_LABEL[r.entityType]} ${ACTION_META[r.action].label}`.toLowerCase().includes(term)}
      emptyMessage="Nothing matches."
      renderRowExtra={(r) =>
        open[r.key] ? (
          <tr>
            <td colSpan={COLUMN_COUNT} style={{ background: "var(--card)" }}>
              <Why flag={r} />
            </td>
          </tr>
        ) : null
      }
    />
  );
}
