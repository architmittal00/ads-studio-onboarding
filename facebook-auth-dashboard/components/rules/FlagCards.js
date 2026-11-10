import { useMemo, useState } from "react";
import Thumb from "@/components/Thumb";
import BottomSheet from "@/components/BottomSheet";
import FlagWhy from "@/components/rules/FlagWhy";
import { STEP_PCT } from "@/components/rules/RuleActionModal";
import { ChevronIcon, SearchIcon, SortIcon } from "@/components/icons";
import styles from "@/styles/Home.module.css";

const ACTION_META = {
  INCREASE_BUDGET: { label: "Increase budget", badge: styles.badgeGood, color: "var(--green)", rgb: "var(--green-rgb)" },
  DECREASE_BUDGET: { label: "Decrease budget", badge: styles.badgeWarn, color: "var(--amber)", rgb: "var(--amber-rgb)" },
  PAUSE_AD: { label: "Pause ad", badge: styles.badgeDanger, color: "var(--red)", rgb: "var(--red-rgb)" },
  ADD_CREATIVE: { label: "Add a creative", badge: styles.badgeInfo, color: "var(--blue)", rgb: "var(--blue-rgb)" },
};
const TYPE_LABEL = { campaign: "Campaign", adset: "Ad set", ad: "Ad" };
const SORTS = [
  { key: "spend7", label: "7d spend", get: (f) => f.stats.spend7 },
  { key: "roas7", label: "7d ROAS", get: (f) => f.stats.roas7 ?? -1 },
  { key: "cpp7", label: "7d CPP", get: (f) => f.stats.cpp7 ?? -1 },
  { key: "purchases7", label: "7d purchases", get: (f) => f.stats.purchases7 },
];
const PAGE = 30;

const money = (v, symbol) => `${symbol}${Math.round(v).toLocaleString("en-IN")}`;

// Phone version of the flags table, built from the same pieces as Custom Views' phone cards (mobileList
// toolbar + search + sort sheet, rowCard head / metric grid / drill button): one card per flagged item with
// its name, where it lives, spend / ROAS / purchases, then one action button. "Why was this flagged?"
// opens inline. 30 at a time so 100+ flags stay light.
export default function FlagCards({ flags, currencySymbol, accountRoas7, accountCpp7, applied, thumbs, onAct, onOpenThumb }) {
  const [open, setOpen] = useState({});
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const [sortKey, setSortKey] = useState("spend7");
  const [sortDir, setSortDir] = useState("desc");
  const [sortOpen, setSortOpen] = useState(false);
  const sort = SORTS.find((s) => s.key === sortKey);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? flags.filter((f) => `${f.name} ${f.campaignName || ""} ${f.adsetName || ""} ${f.matchedRules.map((r) => r.name).join(" ")} ${TYPE_LABEL[f.entityType]} ${ACTION_META[f.action].label}`.toLowerCase().includes(q)) : flags;
    const dir = sortDir === "asc" ? 1 : -1;
    return [...list].sort((a, b) => dir * (sort.get(a) - sort.get(b)));
  }, [flags, query, sort, sortDir]);

  return (
    <div className={styles.mobileList}>
      <div className={styles.mobileListToolbar}>
        <div className={styles.mobileSearch}>
          <SearchIcon size={15} />
          <input
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setLimit(PAGE);
            }}
            placeholder="Search"
            aria-label="Search flags"
          />
        </div>
        <button type="button" className={styles.mobileToolBtn} onClick={() => setSortOpen(true)}>
          <SortIcon size={14} />
          <span className={styles.mobileToolBtnLabel}>{sort.label}</span>
          <span aria-hidden>{sortDir === "asc" ? "↑" : "↓"}</span>
        </button>
      </div>

      {shown.length === 0 ? (
        <p className={styles.sub} style={{ textAlign: "center", padding: "24px 0" }}>
          {query ? "No flags match your search." : "No flags."}
        </p>
      ) : (
        <div className={styles.cardList}>
          {shown.slice(0, limit).map((f) => {
            const meta = ACTION_META[f.action];
            const t = f.budgetTarget;
            const actionable = f.action === "PAUSE_AD" || !!t;
            const next = t ? Math.max(1, Math.round(t.current * (1 + (f.action === "INCREASE_BUDGET" ? 1 : -1) * (STEP_PCT / 100)))) : null;
            const thumb = f.entityType === "ad" ? thumbs[f.entityId] : undefined;
            const where = [f.campaignName, f.adsetName].filter(Boolean).join(" › ");
            const cppDelta = f.stats.cpp7 != null && accountCpp7 ? (f.stats.cpp7 / accountCpp7 - 1) * 100 : null;
            const delta = f.stats.roas7 != null && accountRoas7 ? (f.stats.roas7 / accountRoas7 - 1) * 100 : null;
            return (
              <div key={f.key} className={styles.rowCard}>
                <div className={styles.rowCardHead}>
                  {f.entityType === "ad" && (
                    <Thumb size={48} src={thumb?.thumbnailUrl} isVideo={!!thumb?.isVideo} loading={thumb === undefined} onClick={thumb?.thumbnailUrl || thumb?.isVideo ? () => onOpenThumb(f, thumb) : undefined} />
                  )}
                  <div className={styles.rowCardTitleBtn} style={{ cursor: "default", minWidth: 0 }}>
                    <span className={styles.rowCardTitle}>{f.name}</span>
                    {/* overflowWrap: a long unbroken campaign / ad set name must wrap, or it widens the whole page */}
                    <span className={styles.rowCardSub} style={{ overflowWrap: "anywhere", minWidth: 0 }}>
                      {TYPE_LABEL[f.entityType]}
                      {where ? ` · ${where}` : ""}
                    </span>
                  </div>
                </div>

                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                  <span className={styles.badgeWarn}>{f.matchedRules[0].name}</span>
                  {f.matchedRules.length > 1 && <span className={styles.badgeInfo}>+{f.matchedRules.length - 1} more</span>}
                </div>

                <div className={styles.cardMetrics}>
                  <div className={styles.cardMetric}>
                    <div className={styles.cardMetricLabel}>7d spend</div>
                    <div className={styles.cardMetricValue}>{money(f.stats.spend7, currencySymbol)}</div>
                  </div>
                  <div className={styles.cardMetric}>
                    <div className={styles.cardMetricLabel}>7d ROAS</div>
                    <div className={styles.cardMetricValue}>
                      {f.stats.roas7 != null ? f.stats.roas7.toFixed(2) : "—"}
                      {delta != null && (
                        <span className={delta >= 0 ? styles.badgeGood : styles.badgeDanger} style={{ marginLeft: 4 }}>
                          {delta >= 0 ? "+" : "−"}
                          {Math.abs(Math.round(delta))}%
                        </span>
                      )}
                    </div>
                  </div>
                  <div className={styles.cardMetric}>
                    <div className={styles.cardMetricLabel}>7d CPP</div>
                    <div className={styles.cardMetricValue}>
                      {f.stats.cpp7 != null ? money(f.stats.cpp7, currencySymbol) : "—"}
                      {cppDelta != null && (
                        // Cost per purchase: lower than the account's is the good direction.
                        <span className={cppDelta <= 0 ? styles.badgeGood : styles.badgeDanger} style={{ marginLeft: 4 }}>
                          {cppDelta >= 0 ? "+" : "−"}
                          {Math.abs(Math.round(cppDelta))}%
                        </span>
                      )}
                    </div>
                  </div>
                  <div className={styles.cardMetric}>
                    <div className={styles.cardMetricLabel}>Purchases</div>
                    <div className={styles.cardMetricValue}>{Math.round(f.stats.purchases7)}</div>
                  </div>
                </div>

                {applied[f.key] ? (
                  <div style={{ color: "var(--green)", fontWeight: 700, fontSize: 13 }}>✓ {applied[f.key]}</div>
                ) : actionable ? (
                  <div>
                    <button
                      type="button"
                      onClick={() => onAct(f)}
                      style={{ width: "100%", minHeight: 40, borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: "pointer", color: meta.color, background: `rgba(${meta.rgb}, 0.12)`, border: `1px solid rgba(${meta.rgb}, 0.35)` }}
                    >
                      {t ? `${meta.label} ${STEP_PCT}%` : meta.label}
                    </button>
                    {t && (
                      <div className={styles.rowCardSub} style={{ justifyContent: "center", marginTop: 4 }}>
                        {money(t.current, currencySymbol)} → <strong style={{ color: "var(--t1)" }}>{money(next, currencySymbol)}</strong>/{t.type === "lifetime" ? "life" : "day"}
                      </div>
                    )}
                  </div>
                ) : (
                  <div>
                    <span className={meta.badge}>{meta.label} suggested</span>
                    {f.budgetNote && <div className={styles.rowCardSub} style={{ overflowWrap: "anywhere" }}>{f.budgetNote}</div>}
                    {f.action === "ADD_CREATIVE" && <div className={styles.rowCardSub}>Upload a fresh ad to this ad set.</div>}
                  </div>
                )}

                <button type="button" className={styles.cardDrillBtn} onClick={() => setOpen((o) => ({ ...o, [f.key]: !o[f.key] }))} aria-expanded={!!open[f.key]}>
                  {open[f.key] ? "Hide why" : "Why was this flagged?"}
                  <ChevronIcon direction={open[f.key] ? "up" : "down"} size={13} />
                </button>
                {open[f.key] && <FlagWhy flag={f} />}
              </div>
            );
          })}
        </div>
      )}
      {shown.length > limit && (
        <button type="button" className={styles.btnSecondary} onClick={() => setLimit((l) => l + PAGE)}>
          Show {Math.min(PAGE, shown.length - limit)} more ({shown.length - limit} left)
        </button>
      )}

      <BottomSheet open={sortOpen} title="Sort by" onClose={() => setSortOpen(false)}>
        <div className={styles.tabGroup} style={{ marginBottom: 12 }}>
          <button className={sortDir === "desc" ? `${styles.tab} ${styles.tabActive}` : styles.tab} onClick={() => setSortDir("desc")}>
            High → Low
          </button>
          <button className={sortDir === "asc" ? `${styles.tab} ${styles.tabActive}` : styles.tab} onClick={() => setSortDir("asc")}>
            Low → High
          </button>
        </div>
        <div className={styles.sheetList}>
          {SORTS.map((s) => (
            <button
              key={s.key}
              type="button"
              className={styles.sheetListItem}
              onClick={() => {
                setSortKey(s.key);
                setSortOpen(false);
              }}
            >
              <span className={styles.pickerItemText}>
                <span className={styles.pickerItemName}>{s.label}</span>
              </span>
              {s.key === sortKey && <span className={styles.pickerTick}>✓</span>}
            </button>
          ))}
        </div>
      </BottomSheet>
    </div>
  );
}
