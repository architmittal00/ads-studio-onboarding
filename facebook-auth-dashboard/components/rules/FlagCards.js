import { useMemo, useState } from "react";
import Thumb from "@/components/Thumb";
import FlagWhy from "@/components/rules/FlagWhy";
import { STEP_PCT } from "@/components/rules/RuleActionModal";
import styles from "@/styles/Home.module.css";

const ACTION_META = {
  INCREASE_BUDGET: { label: "Increase budget", badge: styles.badgeGood, color: "var(--green)", rgb: "var(--green-rgb)" },
  DECREASE_BUDGET: { label: "Decrease budget", badge: styles.badgeWarn, color: "var(--amber)", rgb: "var(--amber-rgb)" },
  PAUSE_AD: { label: "Pause ad", badge: styles.badgeDanger, color: "var(--red)", rgb: "var(--red-rgb)" },
};
const TYPE_LABEL = { campaign: "Campaign", adset: "Ad set", ad: "Ad" };
const PAGE = 30;

const money = (v, symbol) => `${symbol}${Math.round(v).toLocaleString("en-IN")}`;

// Phone version of the flags table: one card per flagged item — name, where it lives, the three numbers
// that matter, then one full-width action button. "Why was this flagged?" opens inline. Searchable;
// shows 30 at a time so 100+ flags stay light.
export default function FlagCards({ flags, currencySymbol, accountRoas7, applied, thumbs, onAct, onOpenThumb }) {
  const [open, setOpen] = useState({});
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(PAGE);

  const sorted = useMemo(() => [...flags].sort((a, b) => b.stats.spend7 - a.stats.spend7), [flags]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter((f) => `${f.name} ${f.campaignName || ""} ${f.adsetName || ""} ${f.matchedRules.map((r) => r.name).join(" ")} ${TYPE_LABEL[f.entityType]} ${ACTION_META[f.action].label}`.toLowerCase().includes(q));
  }, [sorted, query]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <input
        type="search"
        className={styles.select}
        style={{ width: "100%" }}
        placeholder="Search by name or rule…"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setLimit(PAGE);
        }}
        aria-label="Search flags"
      />
      {shown.length === 0 && <p className={styles.sub}>Nothing matches.</p>}
      {shown.slice(0, limit).map((f) => {
        const meta = ACTION_META[f.action];
        const t = f.budgetTarget;
        const actionable = f.action === "PAUSE_AD" || !!t;
        const next = t ? Math.max(1, Math.round(t.current * (1 + (f.action === "INCREASE_BUDGET" ? 1 : -1) * (STEP_PCT / 100)))) : null;
        const thumb = f.entityType === "ad" ? thumbs[f.entityId] : undefined;
        const where = [f.campaignName, f.adsetName].filter(Boolean).join(" › ");
        const delta = f.stats.roas7 != null && accountRoas7 ? (f.stats.roas7 / accountRoas7 - 1) * 100 : null;
        return (
          <div key={f.key} className={styles.rowCard}>
            <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
              {f.entityType === "ad" && (
                <Thumb size={48} src={thumb?.thumbnailUrl} isVideo={!!thumb?.isVideo} loading={thumb === undefined} onClick={thumb?.thumbnailUrl || thumb?.isVideo ? () => onOpenThumb(f, thumb) : undefined} />
              )}
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 3, flexWrap: "wrap" }}>
                  <span className={styles.badgeInfo}>{TYPE_LABEL[f.entityType]}</span>
                  <span className={styles.badgeWarn}>{f.matchedRules[0].name}</span>
                  {f.matchedRules.length > 1 && <span className={styles.badgeInfo}>+{f.matchedRules.length - 1}</span>}
                </div>
                <div style={{ fontWeight: 600, fontSize: 13.5, overflowWrap: "anywhere", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{f.name}</div>
                {where && (
                  <div className={styles.muted} style={{ fontWeight: 400, marginTop: 2, overflowWrap: "anywhere", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                    {where}
                  </div>
                )}
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, margin: "10px 0" }}>
              <div>
                <div className={styles.statLabel}>7d spend</div>
                <div style={{ fontWeight: 700, fontSize: 13 }}>{money(f.stats.spend7, currencySymbol)}</div>
              </div>
              <div>
                <div className={styles.statLabel}>7d ROAS</div>
                <div style={{ fontWeight: 700, fontSize: 13 }}>
                  {f.stats.roas7 != null ? f.stats.roas7.toFixed(2) : "—"}
                  {delta != null && (
                    <span className={delta >= 0 ? styles.badgeGood : styles.badgeDanger} style={{ marginLeft: 4 }}>
                      {delta >= 0 ? "+" : "−"}
                      {Math.abs(Math.round(delta))}%
                    </span>
                  )}
                </div>
              </div>
              <div>
                <div className={styles.statLabel}>Purchases</div>
                <div style={{ fontWeight: 700, fontSize: 13 }}>{Math.round(f.stats.purchases7)}</div>
              </div>
            </div>

            {applied[f.key] ? (
              <div style={{ color: "var(--green)", fontWeight: 700 }}>✓ {applied[f.key]}</div>
            ) : actionable ? (
              <>
                <button
                  type="button"
                  onClick={() => onAct(f)}
                  style={{ width: "100%", padding: "11px 12px", borderRadius: 10, fontSize: 13.5, fontWeight: 700, cursor: "pointer", color: meta.color, background: `rgba(${meta.rgb}, 0.12)`, border: `1px solid rgba(${meta.rgb}, 0.4)` }}
                >
                  {t ? `${meta.label} ${STEP_PCT}%` : meta.label}
                </button>
                {t && (
                  <div className={styles.muted} style={{ fontWeight: 400, marginTop: 4, textAlign: "center" }}>
                    {money(t.current, currencySymbol)} → <strong style={{ color: "var(--t1)" }}>{money(next, currencySymbol)}</strong>/{t.type === "lifetime" ? "life" : "day"}
                  </div>
                )}
              </>
            ) : (
              <div>
                <span className={meta.badge}>{meta.label} suggested</span>
                {f.budgetNote && (
                  <div className={styles.muted} style={{ fontWeight: 400, marginTop: 3 }}>
                    {f.budgetNote}
                  </div>
                )}
              </div>
            )}

            <button type="button" className={styles.cardDrillBtn} onClick={() => setOpen((o) => ({ ...o, [f.key]: !o[f.key] }))} aria-expanded={!!open[f.key]}>
              {open[f.key] ? "Hide why" : "Why was this flagged?"}
            </button>
            {open[f.key] && <FlagWhy flag={f} />}
          </div>
        );
      })}
      {shown.length > limit && (
        <button type="button" className={styles.btnSecondary} onClick={() => setLimit((l) => l + PAGE)}>
          Show {Math.min(PAGE, shown.length - limit)} more ({shown.length - limit} left)
        </button>
      )}
    </div>
  );
}
