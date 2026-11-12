import { useEffect, useMemo, useState } from "react";
import Thumb from "@/components/Thumb";
import { CloseIcon } from "@/components/icons";
import { STEP_PCT } from "@/components/rules/RuleActionModal";
import { WhyChecks } from "@/components/rules/FlagWhy";
import PushAds from "@/components/rules/PushAds";
import styles from "@/styles/Home.module.css";

// The desktop Recommendations screen, laid out the way a media buyer works through it: how the account is doing,
// what to do (grouped by the decision — stop waste, scale, trim, refresh creative), and for each item the one-line
// reason, the numbers that matter next to the account's, one button — with the proof a click away.

const SECTIONS = [
  { action: "PAUSE_AD", title: "Pause", blurb: "Spending well above the account's cost per purchase while returning far less.", color: "var(--red)", rgb: "var(--red-rgb)", verb: "Pause ad" },
  { action: "INCREASE_BUDGET", title: "Scale up", blurb: "Beating the account on ROAS — there's room to spend more.", color: "var(--green)", rgb: "var(--green-rgb)", verb: "Increase budget" },
  { action: "DECREASE_BUDGET", title: "Reduce budget", blurb: "Spending ahead of the results it's getting.", color: "var(--amber)", rgb: "var(--amber-rgb)", verb: "Decrease budget" },
  { action: "ADD_CREATIVE", title: "Add a creative", blurb: "Spend is stacked on too few ads — a fresh creative gives the ad set room.", color: "var(--blue)", rgb: "var(--blue-rgb)", verb: "Add a creative" },
];
const TYPE_LABEL = { campaign: "Campaign", adset: "Ad set", ad: "Ad" };
const SORTS = [
  { key: "spend7", label: "Most spend", get: (f) => f.stats.spend7 },
  { key: "roas7", label: "Lowest ROAS", get: (f) => -(f.stats.roas7 ?? Infinity), },
  { key: "cpp7", label: "Highest CPP", get: (f) => f.stats.cpp7 ?? -1 },
  { key: "purchases7", label: "Most purchases", get: (f) => f.stats.purchases7 },
];
const INITIAL_PER_SECTION = 25;

const isActionable = (f) => f.action === "PAUSE_AD" || !!f.budgetTarget;
const money = (v, symbol) => (v == null ? "—" : `${symbol}${Math.round(v).toLocaleString("en-IN")}`);
const compact = (v, symbol) => (v == null ? "—" : `${symbol}${new Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 1 }).format(v)}`);
const delta = (value, base) => (value != null && base ? (value / base - 1) * 100 : null);
const pctText = (d) => `${Math.abs(Math.round(d))}%`;

// One plain sentence on why this item is on the list, built from its own numbers (not the rule's wording).
function reasonFor(f, bench, symbol) {
  const roasD = delta(f.stats.roas7, bench.roas);
  const cppD = delta(f.stats.cpp7, bench.cpp);
  const roas = f.stats.roas7 != null ? f.stats.roas7.toFixed(2) : null;
  const rule = f.matchedRules[0];
  const cond = (i) => rule?.conditions?.[i];
  if (f.action === "ADD_CREATIVE") {
    const slip = rule?.conditions
      ?.find((c) => c.either)
      ?.either.filter((o) => o.ok)
      .map((o) => `${o.short} ${o.changePct >= 0 ? "up" : "down"} ${Math.abs(Math.round(o.changePct))}% (${o.actual} vs ${o.prior} before)`)
      .join(" and ");
    let base;
    if (rule?.id === "new-creative-03") base = "Only 1 active ad.";
    else if (rule?.id === "new-creative-02" && cond(0)?.actual && cond(2)?.actual) base = `Its top 2 of ${cond(0).actual} ads take ${cond(2).actual} of the last 3 days' spend.`;
    else if (rule?.id === "new-creative-01" && cond(0)?.actual && cond(1)?.actual) base = `${cond(0).actual} active ads, but the least-used half gets only ${cond(1).actual} of the last 3 days' spend.`;
    else base = rule?.name || "";
    return slip ? `${base} Last 3 days vs the 4 before: ${slip}.` : base;
  }
  const parts = [];
  if (roas != null && roasD != null) parts.push(`ROAS ${roas} is ${pctText(roasD)} ${roasD < 0 ? "below" : "above"} the account's ${bench.roas.toFixed(2)}`);
  if (f.stats.cpp7 != null && cppD != null) parts.push(`cost per purchase ${money(f.stats.cpp7, symbol)} is ${pctText(cppD)} ${cppD > 0 ? "higher" : "lower"}`);
  const sentence = parts.length ? `${parts.join(" and ")}.` : rule?.name || "";
  return f.action === "PAUSE_AD" ? `${sentence} ${money(f.stats.spend7, symbol)} spent in 7 days.` : sentence;
}

function Delta({ d, lowerIsBetter }) {
  if (d == null) return null;
  const good = lowerIsBetter ? d <= 0 : d >= 0;
  return (
    <span className={good ? styles.badgeGood : styles.badgeDanger} title="Compared with the account's 7-day figure">
      {d >= 0 ? "+" : "−"}
      {pctText(d)}
    </span>
  );
}

function Metric({ label, children, delta: d, lowerIsBetter }) {
  return (
    <div className={styles.recMetric}>
      <span className={styles.recMetricLabel}>{label}</span>
      <strong>{children}</strong>
      <Delta d={d} lowerIsBetter={lowerIsBetter} />
    </div>
  );
}

function Context({ flag, symbol }) {
  const t = flag.budgetTarget;
  const next = t ? Math.max(1, Math.round(t.current * (1 + (flag.action === "INCREASE_BUDGET" ? 1 : -1) * (STEP_PCT / 100)))) : null;
  const share = (v) => (v != null ? `${v.toFixed(1)}%` : "—");
  const rows = [];
  if (flag.adContext) {
    rows.push(["Active ads in its ad set", flag.adContext.activeAdsInAdset]);
    rows.push(["Share of ad set spend, last 3 days", share(flag.adContext.spendShare[3])]);
    rows.push(["Share of ad set spend, last 7 days", share(flag.adContext.spendShare[7])]);
  }
  if (flag.stats.roas3 != null) rows.push(["ROAS, last 3 days", flag.stats.roas3.toFixed(2)]);
  if (flag.stats.roas7 != null) rows.push(["ROAS, last 7 days", flag.stats.roas7.toFixed(2)]);
  if (t) {
    rows.push([`${t.type === "lifetime" ? "Lifetime" : "Daily"} budget now`, money(t.current, symbol)]);
    rows.push([`Suggested (${STEP_PCT}% ${flag.action === "INCREASE_BUDGET" ? "up" : "down"})`, money(next, symbol)]);
  }
  return (
    <div>
      <div className={styles.recContextTitle}>About this {TYPE_LABEL[flag.entityType].toLowerCase()}</div>
      <dl className={styles.recContextList}>
        {rows.map(([label, value]) => (
          <div key={label} className={styles.recContextRow}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {flag.budgetNote && <p className={styles.muted} style={{ fontWeight: 400, marginTop: 10 }}>{flag.budgetNote}</p>}
      {flag.hiddenConflicts?.length > 0 && (
        <p className={styles.muted} style={{ fontWeight: 400, marginTop: 10 }}>
          A conflicting rule also matched ({flag.hiddenConflicts.join(", ")}) but the stronger one is shown.
        </p>
      )}
    </div>
  );
}

// A pause suggestion for an ad that takes more than this share of its ad set's 7-day spend also offers new ads to push.
export const DOMINANT_SHARE = 40;

function RecCard({ flag, section, bench, symbol, thumb, applied, selected, onToggle, onAct, onOpenThumb, accountId, tz, pausedAdIds, holdBudget, onAdsPushed }) {
  const [open, setOpen] = useState(false);
  const [pushModal, setPushModal] = useState(false); // "Push new ads" pop-up (pause card of a dominant ad)
  useEffect(() => {
    if (!pushModal) return;
    const onKey = (e) => e.key === "Escape" && setPushModal(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pushModal]);
  const where = [flag.campaignName, flag.adsetName].filter(Boolean).join("  ›  ");
  const t = flag.budgetTarget;
  const actionable = isActionable(flag) && !applied;
  const share7 = flag.action === "PAUSE_AD" && flag.entityType === "ad" && flag.adsetId ? flag.adContext?.spendShare?.[7] ?? null : null;
  const dominant = share7 != null && share7 > DOMINANT_SHARE;
  const waiting = holdBudget && !!flag.budgetTarget; // budget change: wait for the 48-hour cool-down read
  const next = t ? Math.max(1, Math.round(t.current * (1 + (flag.action === "INCREASE_BUDGET" ? 1 : -1) * (STEP_PCT / 100)))) : null;
  return (
    <article className={open ? `${styles.recCard} ${styles.recCardOpen}` : styles.recCard} style={{ "--rec-rgb": section.rgb }}>
      <div className={styles.recRow} onClick={() => setOpen((o) => !o)}>
        <div className={styles.recSelect} onClick={(e) => e.stopPropagation()}>
          {actionable && <input type="checkbox" aria-label={`Select ${flag.name}`} checked={selected} onChange={onToggle} />}
        </div>
        <div className={styles.recMain}>
          <div className={styles.recTitleLine}>
            {flag.entityType === "ad" && (
              <Thumb size={44} src={thumb?.thumbnailUrl} isVideo={!!thumb?.isVideo} loading={thumb === undefined} onClick={thumb?.thumbnailUrl || thumb?.isVideo ? (e) => (e?.stopPropagation?.(), onOpenThumb(flag, thumb)) : undefined} />
            )}
            <div style={{ minWidth: 0 }}>
              <div className={styles.recName}>
                <span className={styles.badgeInfo} style={{ flexShrink: 0 }}>
                  {TYPE_LABEL[flag.entityType]}
                </span>
                <span title={flag.name}>{flag.name}</span>
              </div>
              {where && (
                <div className={styles.recWhere} title={where}>
                  {where}
                </div>
              )}
            </div>
          </div>
          <p className={styles.recReason}>{reasonFor(flag, bench, symbol)}</p>
        </div>
        <div className={styles.recMetrics}>
          <Metric label="7d spend">{compact(flag.stats.spend7, symbol)}</Metric>
          <Metric label="7d ROAS" delta={delta(flag.stats.roas7, bench.roas)}>
            {flag.stats.roas7 != null ? flag.stats.roas7.toFixed(2) : "—"}
          </Metric>
          <Metric label="7d CPP" delta={delta(flag.stats.cpp7, bench.cpp)} lowerIsBetter>
            {money(flag.stats.cpp7, symbol)}
          </Metric>
          <Metric label="Purchases">{Math.round(flag.stats.purchases7)}</Metric>
        </div>
        <div className={styles.recAct} onClick={(e) => e.stopPropagation()}>
          <button type="button" className={styles.recWhyBtn} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
            {open ? "Hide reasoning ▴" : "See reasoning ▾"}
          </button>
          {applied ? (
            <span style={{ color: "var(--green)", fontWeight: 700 }}>✓ {applied}</span>
          ) : actionable ? (
            <>
              <button
                type="button"
                onClick={() => onAct(flag)}
                disabled={waiting}
                title={waiting ? "Checking recent budget changes first…" : undefined}
                style={{ opacity: waiting ? 0.5 : 1, color: section.color, background: `rgba(${section.rgb}, 0.12)`, border: `1px solid rgba(${section.rgb}, 0.35)` }}
                className={styles.recActBtn}
              >
                {t ? `${section.verb} ${STEP_PCT}%` : section.verb}
              </button>
              {dominant && (
                <button type="button" onClick={() => setPushModal(true)} className={styles.recActBtn} style={{ color: "var(--blue)", background: "rgba(var(--blue-rgb), 0.12)", border: "1px solid rgba(var(--blue-rgb), 0.35)" }}>
                  Push new ads
                </button>
              )}
              {dominant && <span className={styles.recActSub}>{share7.toFixed(0)}% of its ad set&apos;s 7-day spend</span>}
              {t && (
                <span className={styles.recActSub}>
                  {money(t.current, symbol)} → <strong>{money(next, symbol)}</strong>
                </span>
              )}
            </>
          ) : (
            <span className={styles.recActSub}>Add one in Ads Manager</span>
          )}
        </div>
      </div>
      {open && (
        <div className={styles.recDetail}>
          <div>
            <div className={styles.recContextTitle}>Why it was flagged</div>
            <WhyChecks flag={flag} />
          </div>
          <Context flag={flag} symbol={symbol} />
          {flag.action === "ADD_CREATIVE" && flag.entityType === "adset" && accountId && (
            <div className={styles.pushWrap}>
              <PushAds flag={flag} accountId={accountId} tz={tz} symbol={symbol} pausedAdIds={pausedAdIds} onOpenThumb={onOpenThumb} onPushed={onAdsPushed} />
            </div>
          )}
        </div>
      )}
      {pushModal && dominant && accountId && (
        <div onClick={() => setPushModal(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.65)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 800, padding: 24 }}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Push new ads"
            onClick={(e) => e.stopPropagation()}
            className={styles.card}
            style={{ background: "var(--bg)", width: "min(1120px, 100%)", maxHeight: "90vh", overflowY: "auto", display: "flex", flexDirection: "column", gap: 12 }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
              <div style={{ minWidth: 0 }}>
                <h2 className={styles.h2} style={{ marginBottom: 2 }}>
                  Push new ads into {flag.adsetName || "this ad set"}
                </h2>
                <p className={styles.sub}>
                  <strong>{flag.name}</strong> takes {share7.toFixed(0)}% of this ad set&apos;s 7-day spend. Add fresh ads here, then pause it from the card.
                </p>
              </div>
              <button type="button" onClick={() => setPushModal(false)} aria-label="Close" className={styles.btnSecondary} style={{ padding: 6, flexShrink: 0 }}>
                <CloseIcon size={14} />
              </button>
            </div>
            <PushAds flag={flag} accountId={accountId} tz={tz} symbol={symbol} pausedAdIds={pausedAdIds} onOpenThumb={onOpenThumb} adsetId={flag.adsetId} adsetName={flag.adsetName} source="pause_card" onPushed={onAdsPushed} />
          </div>
        </div>
      )}
    </article>
  );
}

// The summary: how the account is doing (what everything is compared with) and a tab per decision, each with
// the spend riding on it.
export function RecSummary({ result, counts, flags, filter, setFilter, checkedText }) {
  const symbol = result.currencySymbol;
  const b7 = result.baseline.find((b) => b.days === 7);
  const impact = (action) => {
    const list = flags.filter((f) => f.action === action);
    const spend = list.reduce((t, f) => t + f.stats.spend7, 0);
    const revenue = list.reduce((t, f) => t + (f.stats.roas7 ?? 0) * f.stats.spend7, 0);
    return { n: list.length, spend, roas: spend > 0 ? revenue / spend : null };
  };
  const notes = [];
  if (result.counts.learning?.adsets > 0) notes.push(`${result.counts.learning.adsets} ad sets and ${result.counts.learning.campaigns} campaigns still in learning aren't judged`);
  if (result.counts.skipped?.adsets > 0) notes.push(`${result.counts.skipped.adsets} ad sets and ${result.counts.skipped.ads} ads not optimized for purchases are skipped`);
  const tabs = [{ key: "all", label: "Everything", color: "var(--t1)" }, ...SECTIONS.map((s) => ({ key: s.action, label: s.title, color: s.color, action: s.action }))];
  return (
    <>
      <p className={styles.recStrip}>
        <span>
          Compared with the account&apos;s last 7 days: ROAS {b7?.roas != null ? b7.roas.toFixed(2) : "—"} · CPP {money(b7?.cpr, symbol)} · {compact(b7?.spend, symbol)} spent
        </span>
        <span className={styles.recStripMeta}>
          {checkedText} · {result.counts.campaigns} campaigns, {result.counts.adsets} ad sets, {result.counts.ads} ads, {result.rulesChecked.length} rules
          {notes.length > 0 && (
            <span title={`${notes.join(". ")}.`} aria-label={`${notes.join(". ")}.`} style={{ marginLeft: 6, cursor: "help" }}>
              ⓘ
            </span>
          )}
        </span>
      </p>
      <div className={styles.recTabs} role="tablist" aria-label="Filter recommendations">
        {tabs.map((tab) => {
          const im = tab.action ? impact(tab.action) : null;
          const on = filter === tab.key;
          return (
            <button key={tab.key} type="button" role="tab" aria-selected={on} className={on ? `${styles.recTab} ${styles.recTabOn}` : styles.recTab} onClick={() => setFilter(on && tab.key !== "all" ? "all" : tab.key)}>
              <span className={styles.recTabTop}>
                <span style={{ color: tab.color }}>{tab.label}</span>
                <span className={styles.recTabCount} style={{ color: tab.color }}>
                  {counts[tab.key]}
                </span>
              </span>
              <span className={styles.recTabSub}>
                {tab.action === "ADD_CREATIVE"
                  ? `${im.n} ad set${im.n === 1 ? "" : "s"}`
                  : im
                  ? im.n > 0
                    ? `${compact(im.spend, symbol)} spent · ${im.roas != null ? im.roas.toFixed(2) : "—"} ROAS`
                    : "Nothing here"
                  : `${counts.all} in total`}
              </span>
            </button>
          );
        })}
      </div>
    </>
  );
}

export default function RecBoard({ flags, filter, currencySymbol, baseline, applied, thumbs, selected, onToggle, onToggleAll, onAct, onOpenThumb, accountId, tz, holdBudget, onAdsPushed }) {
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState("spend7");
  const [expanded, setExpanded] = useState({}); // action -> shown beyond the first page
  // Pause section only: keep ads that take at least this % of their ad set's 7-day spend (empty = no filter).
  const [minShare, setMinShare] = useState("");
  const minShareCap = minShare.trim() === "" || !Number.isFinite(Number(minShare)) ? null : Number(minShare);
  const shareOf = (f) => f.adContext?.spendShare?.[7] ?? null;
  const passesShare = (f) => minShareCap == null || f.action !== "PAUSE_AD" || (shareOf(f) != null && shareOf(f) >= minShareCap);
  const bench = { roas: baseline?.roas ?? null, cpp: baseline?.cpr ?? null };
  const sort = SORTS.find((s) => s.key === sortKey);
  // Ads a Pause rule flagged: their creatives are never suggested for pushing into another ad set.
  const pausedAdIds = useMemo(() => new Set(flags.filter((f) => f.action === "PAUSE_AD" && f.entityType === "ad").map((f) => f.entityId)), [flags]);

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const match = (f) => !q || `${f.name} ${f.campaignName || ""} ${f.adsetName || ""} ${f.matchedRules.map((m) => m.name).join(" ")}`.toLowerCase().includes(q);
    return SECTIONS.filter((s) => filter === "all" || filter === s.action).map((s) => ({
      section: s,
      items: flags.filter((f) => f.action === s.action && match(f) && passesShare(f)).sort((a, b) => sort.get(b) - sort.get(a)),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- passesShare only reads minShareCap
  }, [flags, filter, query, sort, minShareCap]);

  // A ticked ad the share filter now hides must not be paused by a bulk action.
  useEffect(() => {
    if (minShareCap == null) return;
    const hidden = flags.filter((f) => !passesShare(f)).map((f) => f.key);
    if (hidden.length > 0) onToggleAll(hidden, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when the filter value changes
  }, [minShareCap]);

  return (
    <div className={styles.recBoard}>
      <div className={styles.recToolbar}>
        <input className={styles.select} style={{ flex: "1 1 260px", maxWidth: 420 }} placeholder="Search by ad, ad set, campaign or rule…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <label className={styles.recSort}>
          <span className={styles.recMetricLabel}>Sort</span>
          <select className={styles.select} value={sortKey} onChange={(e) => setSortKey(e.target.value)}>
            {SORTS.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.recSort}>
          <span className={styles.recMetricLabel}>Pause · ad&apos;s 7-day share of its ad set, at least</span>
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input className={styles.select} type="number" min="0" max="100" step="any" inputMode="decimal" placeholder="e.g. 40" value={minShare} onChange={(e) => setMinShare(e.target.value)} style={{ width: 84 }} />
            <span className={styles.sub}>%</span>
          </span>
        </label>
      </div>
      {minShareCap != null && grouped.some((g) => g.section.action === "PAUSE_AD") && grouped.find((g) => g.section.action === "PAUSE_AD").items.length === 0 && flags.some((f) => f.action === "PAUSE_AD") && (
        <p className={styles.sub}>No pause suggestion is for an ad taking {minShareCap}% or more of its ad set&apos;s 7-day spend — lower the number to see more.</p>
      )}
      {grouped.every((g) => g.items.length === 0) && minShareCap == null && <p className={styles.sub}>Nothing matches.</p>}
      {grouped.map(({ section, items }) => {
        if (items.length === 0) return null;
        const limit = expanded[section.action] ? items.length : INITIAL_PER_SECTION;
        const selectable = items.filter((f) => isActionable(f) && !applied[f.key]);
        const allOn = selectable.length > 0 && selectable.every((f) => selected.has(f.key));
        return (
          <section key={section.action} className={styles.recSection}>
            <header className={styles.recSectionHead}>
              <span className={styles.recDot} style={{ background: section.color }} />
              <h2 className={styles.h2} style={{ margin: 0 }}>
                {section.title}{" "}
                <span className={styles.muted}>
                  · {items.length}
                  {section.action === "PAUSE_AD" && minShareCap != null ? ` of ${flags.filter((f) => f.action === "PAUSE_AD").length}` : ""}
                </span>
              </h2>
              <span className={styles.recBlurb}>{section.blurb}</span>
              {selectable.length > 0 && (
                <label className={styles.recSelectAll}>
                  <input type="checkbox" checked={allOn} onChange={(e) => onToggleAll(selectable.map((f) => f.key), e.target.checked)} />
                  Select all {selectable.length}
                </label>
              )}
            </header>
            <div className={styles.recList}>
              {items.slice(0, limit).map((f) => (
                <RecCard
                  key={f.key}
                  flag={f}
                  section={section}
                  bench={bench}
                  symbol={currencySymbol}
                  thumb={f.entityType === "ad" ? thumbs[f.entityId] : undefined}
                  applied={applied[f.key]}
                  selected={selected.has(f.key)}
                  onToggle={() => onToggle(f.key)}
                  onAct={onAct}
                  onOpenThumb={onOpenThumb}
                  accountId={accountId}
                  tz={tz}
                  pausedAdIds={pausedAdIds}
                  holdBudget={holdBudget}
                  onAdsPushed={onAdsPushed}
                />
              ))}
            </div>
            {items.length > limit && (
              <button type="button" className={styles.btnSecondary} style={{ alignSelf: "flex-start" }} onClick={() => setExpanded((e) => ({ ...e, [section.action]: true }))}>
                Show {items.length - limit} more
              </button>
            )}
          </section>
        );
      })}
    </div>
  );
}
