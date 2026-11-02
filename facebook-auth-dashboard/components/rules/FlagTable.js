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
const COLUMN_COUNT = 8;
// Tinted action buttons: the colour matches the suggestion, so the button says what it will do.
const ACTION_BTN = {
  INCREASE_BUDGET: { color: "var(--green)", rgb: "var(--green-rgb)" },
  DECREASE_BUDGET: { color: "var(--amber)", rgb: "var(--amber-rgb)" },
  PAUSE_AD: { color: "var(--red)", rgb: "var(--red-rgb)" },
};

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

const isActionable = (f) => f.action === "PAUSE_AD" || !!f.budgetTarget;
const ellipsis = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };

// Flagged items as the app's shared sortable table. Clicking a row (or "Why") opens the breakdown
// under it; the checkbox column feeds the bulk-action bar on the page.
// `thumbs`: ad id -> { thumbnailUrl, isVideo } | null once loaded (missing while still loading).
export default function FlagTable({ flags, currencySymbol, accountRoas7, applied, thumbs, onAct, onOpenThumb, selected, onToggle, onToggleAll }) {
  const [open, setOpen] = useState({});
  const rows = useMemo(() => flags.map((f) => ({ ...f, id: f.key, spend7: f.stats.spend7, roas7: f.stats.roas7, purchases7: f.stats.purchases7, ruleText: f.matchedRules.map((r) => r.name).join(", ") })), [flags]);
  const selectable = rows.filter((r) => isActionable(r) && !applied[r.key]);
  const allSelected = selectable.length > 0 && selectable.every((r) => selected.has(r.key));
  const toggleOpen = (key) => setOpen((o) => ({ ...o, [key]: !o[key] }));

  const columns = [
    {
      key: "select",
      sortValue: () => 0,
      label: (
        <input
          type="checkbox"
          aria-label="Select every flag in this view"
          checked={allSelected}
          disabled={selectable.length === 0}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => onToggleAll(selectable.map((r) => r.key), e.target.checked)}
        />
      ),
      render: (r) =>
        isActionable(r) && !applied[r.key] ? (
          <input type="checkbox" aria-label={`Select ${r.name}`} checked={selected.has(r.key)} onClick={(e) => e.stopPropagation()} onChange={() => onToggle(r.key)} />
        ) : null,
    },
    {
      key: "name",
      label: "Flagged item",
      render: (r) => {
        const thumb = r.entityType === "ad" ? thumbs[r.entityId] : undefined;
        const where = [r.campaignName, r.adsetName].filter(Boolean).join("  ›  ");
        return (
          <div style={{ display: "flex", gap: 10, alignItems: "center", minWidth: 280, maxWidth: 520 }}>
            {r.entityType === "ad" && (
              <Thumb size={40} src={thumb?.thumbnailUrl} isVideo={!!thumb?.isVideo} loading={thumb === undefined} onClick={thumb?.thumbnailUrl || thumb?.isVideo ? () => onOpenThumb(r, thumb) : undefined} />
            )}
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ display: "flex", gap: 6, alignItems: "center", minWidth: 0 }}>
                <span className={styles.badgeInfo} style={{ flexShrink: 0 }}>
                  {TYPE_LABEL[r.entityType]}
                </span>
                <span title={r.name} style={{ fontWeight: 600, ...ellipsis }}>
                  {r.name}
                </span>
              </div>
              {where && (
                <div title={where} className={styles.muted} style={{ fontWeight: 400, marginTop: 2, ...ellipsis }}>
                  {where}
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
        <div style={{ display: "flex", gap: 4, alignItems: "center", whiteSpace: "nowrap" }}>
          <span className={styles.badgeWarn}>{r.matchedRules[0].name}</span>
          {r.matchedRules.length > 1 && (
            <span className={styles.badgeInfo} title={r.matchedRules.map((m) => m.name).join(", ")}>
              +{r.matchedRules.length - 1}
            </span>
          )}
        </div>
      ),
    },
    { key: "spend7", label: "7d spend", align: "right", render: (r) => money(r.spend7, currencySymbol) },
    {
      key: "roas7",
      label: "7d ROAS",
      align: "right",
      render: (r) => {
        const delta = r.roas7 != null && accountRoas7 ? (r.roas7 / accountRoas7 - 1) * 100 : null;
        return (
          <div style={{ whiteSpace: "nowrap" }}>
            <strong>{r.roas7 != null ? r.roas7.toFixed(2) : "—"}</strong>
            {delta != null && (
              <span className={delta >= 0 ? styles.badgeGood : styles.badgeDanger} style={{ marginLeft: 6 }} title={`Account 7-day ROAS is ${accountRoas7.toFixed(2)}`}>
                {delta >= 0 ? "+" : "−"}
                {Math.abs(Math.round(delta))}% vs acct
              </span>
            )}
          </div>
        );
      },
    },
    { key: "purchases7", label: "7d purchases", align: "right", render: (r) => Math.round(r.purchases7) },
    {
      key: "action",
      label: "Action",
      sortValue: (r) => r.action,
      render: (r) => {
        const t = r.budgetTarget;
        const btn = ACTION_BTN[r.action];
        const label = ACTION_META[r.action].label;
        if (applied[r.key]) return <span style={{ color: "var(--green)", fontWeight: 700, whiteSpace: "nowrap" }}>✓ {applied[r.key]}</span>;
        if (!isActionable(r)) {
          return (
            <div style={{ maxWidth: 230 }}>
              <span className={ACTION_META[r.action].badge}>{label} suggested</span>
              {r.budgetNote && (
                <div className={styles.muted} style={{ fontWeight: 400, marginTop: 3 }}>
                  {r.budgetNote}
                </div>
              )}
            </div>
          );
        }
        const next = t ? Math.max(1, Math.round(t.current * (1 + (r.action === "INCREASE_BUDGET" ? 1 : -1) * (STEP_PCT / 100)))) : null;
        return (
          <div style={{ minWidth: 190 }}>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onAct(r);
              }}
              style={{
                padding: "6px 12px",
                borderRadius: 8,
                fontSize: 12,
                fontWeight: 700,
                cursor: "pointer",
                whiteSpace: "nowrap",
                color: btn.color,
                background: `rgba(${btn.rgb}, 0.12)`,
                border: `1px solid rgba(${btn.rgb}, 0.35)`,
              }}
            >
              {t ? `${label} ${STEP_PCT}%` : label}
            </button>
            {t && (
              <div className={styles.muted} style={{ fontWeight: 400, marginTop: 4, whiteSpace: "nowrap" }}>
                {money(t.current, currencySymbol)} → <strong style={{ color: "var(--t1)" }}>{money(next, currencySymbol)}</strong>/{t.type === "lifetime" ? "life" : "day"}
              </div>
            )}
          </div>
        );
      },
    },
    {
      key: "why",
      label: "",
      sortValue: () => 0,
      align: "right",
      render: (r) => (
        <button type="button" className={styles.rowActionBtn} onClick={(e) => { e.stopPropagation(); toggleOpen(r.key); }} aria-expanded={!!open[r.key]}>
          Why {open[r.key] ? "▴" : "▾"}
        </button>
      ),
    },
  ];

  return (
    <SortableTable
      columns={columns}
      rows={rows}
      defaultSortKey="spend7"
      maxHeight={900}
      rowKey={(r) => r.key}
      searchable
      searchKeys={["name"]}
      searchPlaceholder="Search by ad, ad set or campaign name, or by rule…"
      searchMatch={(r, term) => `${r.name} ${r.campaignName || ""} ${r.adsetName || ""} ${r.ruleText} ${TYPE_LABEL[r.entityType]} ${ACTION_META[r.action].label}`.toLowerCase().includes(term)}
      emptyMessage="Nothing matches."
      initialFirstColFrozen={false}
      onRowClick={(r) => toggleOpen(r.key)}
      highlightRow={(r) => !!selected.has(r.key)}
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
