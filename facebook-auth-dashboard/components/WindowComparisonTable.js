import Loader from "./Loader";
import { LOWER_IS_BETTER_METRIC_KEYS, isUnitMetric, formatMetricValue } from "@/lib/insightsMetrics";
import styles from "@/styles/Home.module.css";

// Shared with components/EntityDrillDown.js, which renders one of these per
// drilled-into entity (adset/ad) so a user doing root-cause analysis sees the
// exact same before/after window shape there as on the top-level changed
// entity in components/EntityChangesDrawer.js, instead of a different,
// cheaper-looking summary.
export const DEFAULT_COMPARISON_METRIC_KEYS = ["spend", "purchases", "cost_per_purchase", "roas"];

// Per explicit ask: the change's own cumulative total and its immediate
// aftermath first, then the "before" windows nearest-to-furthest. Still
// grouped (see WINDOW_GROUP) so the table draws one visible divider at the
// change itself — "after" windows all land contiguously on the left of it
// here, "before" windows contiguously on the right.
export const WINDOW_ORDER = ["sinceChange", "threeDaysAfter", "sevenDaysAfter", "oneDayBefore", "threeDaysBefore", "sevenDaysBefore"];
export const WINDOW_LABEL = {
  sevenDaysBefore: "7 Days Before",
  threeDaysBefore: "3 Days Before",
  oneDayBefore: "1 Day Before",
  sinceChange: "Since Change",
  threeDaysAfter: "3 Days Post Change",
  sevenDaysAfter: "7 Days Post Change",
};
const WINDOW_GROUP = {
  sevenDaysBefore: "before",
  threeDaysBefore: "before",
  oneDayBefore: "before",
  sinceChange: "after",
  threeDaysAfter: "after",
  sevenDaysAfter: "after",
};
const GROUP_LABEL = { before: "Before the Change", after: "After the Change" };

// Renders the metric-rows × window-columns comparison grid — the shared core
// of both the top-level Investigate drawer and each per-entity drill-down
// row. `windows` is the `{ [windowName]: {since,until,days,metrics,overlapsChange?,partial?} }`
// shape returned by pages/api/fb/recent-changes/investigate.js; `catalog` is
// the metric catalog to resolve `metricKeys` labels/formats against.
export default function WindowComparisonTable({ windows, metricKeys, catalog, loading, currency }) {
  // Drops a window entirely (header and every metric's cell) only when it
  // genuinely doesn't apply yet (the window object itself is `null` — e.g.
  // `threeDaysAfter`/`sevenDaysAfter` when the change happened today itself,
  // so not even one post-change day exists yet; otherwise they show a real,
  // growing `partial` total instead — see `daysAfterChangeWindow` in
  // pages/api/fb/recent-changes/investigate.js). A window whose Graph call
  // actually failed still has a real object (with `error` set and
  // `metrics: null`) and stays visible, rendered as a dedicated error cell
  // below — hiding a *failed* window looked identical to "this window
  // doesn't apply," which silently made it look like post-change data simply
  // didn't exist instead of surfacing that the fetch itself broke. While
  // still loading, every window is kept so the skeleton doesn't jump once
  // data arrives.
  const visibleWindowNames = loading ? WINDOW_ORDER : WINDOW_ORDER.filter((name) => windows?.[name] != null);

  // One visible divider at the change itself — the last "before" column and
  // the first "after" column each get a heavier border, and a spanning
  // group-label row sits above the usual per-window header row, so "when did
  // metrics start, when did they end" reads at a glance instead of only
  // being inferable from each column's own label.
  const dividerBefore = (name) => {
    const idx = visibleWindowNames.indexOf(name);
    return idx > 0 && WINDOW_GROUP[visibleWindowNames[idx - 1]] !== WINDOW_GROUP[name];
  };
  const groupRuns = [];
  for (const name of visibleWindowNames) {
    const group = WINDOW_GROUP[name];
    const last = groupRuns[groupRuns.length - 1];
    if (last && last.group === group) last.count++;
    else groupRuns.push({ group, count: 1 });
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th />
            {groupRuns.map((run, i) => (
              <th
                key={i}
                colSpan={run.count}
                className={styles.muted}
                style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.3, borderLeft: i > 0 ? "2px solid var(--border)" : undefined }}
              >
                {GROUP_LABEL[run.group]}
              </th>
            ))}
          </tr>
          <tr>
            <th>Metric</th>
            {visibleWindowNames.map((name) => {
              const w = windows?.[name];
              return (
                <th
                  key={name}
                  className={name === "sinceChange" ? styles.drawerSinceChangeCol : undefined}
                  style={dividerBefore(name) ? { borderLeft: "2px solid var(--border)" } : undefined}
                >
                  {WINDOW_LABEL[name]}
                  {w && !w.error && <span className={styles.muted}> ({w.days}d{w.partial ? ", so far" : ""})</span>}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {metricKeys.map((key) => {
            const metric = catalog.find((m) => m.key === key);
            if (!metric) return null;
            const unit = isUnitMetric(metric);
            const lowerIsBetter = LOWER_IS_BETTER_METRIC_KEYS.has(metric.key);

            // Best/worst highlighting only ever considers a "clean" window —
            // one that neither overlaps the change (mixes pre- and
            // post-change delivery) nor is still a partial, still-accruing
            // total (see `partial` below). Those two still render their own
            // real number in the cell (or, for `overlapsChange`, a muted
            // explanation instead) — they're just never crowned "best" or
            // "worst" against a set of genuinely comparable windows. This
            // only ever runs on `isUnitMetric` rows (ROAS, CTR, Cost Per
            // Purchase, …) — rates that are already window-length-
            // independent — so comparing each window's raw value here (a
            // genuine sum for an additive metric like Spend, same
            // aggregation convention as the rest of this app) rather than a
            // per-day average never makes a longer window's bigger total
            // misleadingly "win."
            const comparableValues = visibleWindowNames.map((name) => {
              const w = windows?.[name];
              if (!w || w.overlapsChange || w.partial) return null;
              return w.metrics?.[key] ?? null;
            });
            let bestValue = null;
            let worstValue = null;
            if (unit && !loading) {
              const numeric = comparableValues.filter((v) => typeof v === "number" && !isNaN(v));
              if (numeric.length > 1) {
                const max = Math.max(...numeric);
                const min = Math.min(...numeric);
                if (max !== min) {
                  bestValue = lowerIsBetter ? min : max;
                  worstValue = lowerIsBetter ? max : min;
                }
              }
            }

            return (
              <tr key={key}>
                <td>{metric.label}</td>
                {visibleWindowNames.map((name) => {
                  const cellClass = name === "sinceChange" ? styles.drawerSinceChangeCol : undefined;
                  if (loading) {
                    return (
                      <td key={name} className={cellClass}>
                        <Loader inline />
                      </td>
                    );
                  }
                  const w = windows?.[name];
                  const dividerStyle = dividerBefore(name) ? { borderLeft: "2px solid var(--border)" } : undefined;
                  if (!w) return <td key={name} className={cellClass} style={dividerStyle}>—</td>;
                  if (w.error) {
                    return (
                      <td key={name} className={`${styles.muted} ${cellClass || ""}`} style={dividerStyle} title={w.error}>
                        Error
                      </td>
                    );
                  }
                  if (w.overlapsChange) {
                    return (
                      <td
                        key={name}
                        className={`${styles.muted} ${cellClass || ""}`}
                        style={dividerStyle}
                        title="This window spans both before and after the change, so it isn't a clean post-change read."
                      >
                        Includes pre-change days
                      </td>
                    );
                  }
                  const value = w.metrics?.[key] ?? null;
                  const tone = value === bestValue ? "var(--green)" : value === worstValue ? "var(--red)" : undefined;
                  return (
                    <td key={name} className={cellClass} style={{ ...dividerStyle, ...(tone ? { color: tone, fontWeight: 700 } : undefined) }}>
                      {formatMetricValue(value, metric.format, currency)}
                      {w.partial && (
                        <span className={styles.muted} style={{ marginLeft: 4, fontWeight: 400 }} title="Today isn't over yet — this total is still accruing.">
                          *
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
