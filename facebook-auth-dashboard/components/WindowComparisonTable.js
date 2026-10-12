import Loader from "./Loader";
import { RATE_METRIC_KEYS, LOWER_IS_BETTER_METRIC_KEYS, isUnitMetric, formatMetricValue } from "@/lib/insightsMetrics";
import styles from "@/styles/Home.module.css";

// Shared with components/EntityDrillDown.js, which renders one of these per
// drilled-into entity (adset/ad) so a user doing root-cause analysis sees the
// exact same before/after window shape there as on the top-level changed
// entity in components/InvestigateDrawer.js, instead of a different,
// cheaper-looking summary.
export const DEFAULT_COMPARISON_METRIC_KEYS = ["spend", "purchases", "cost_per_purchase", "roas"];

// Most recent → least recent, left to right: the two "right now" snapshots
// first, then the change's own cumulative total (which can be short or very
// long depending on how long ago the change happened), then progressively
// further back in time relative to the change itself.
export const WINDOW_ORDER = ["last3Days", "last7Days", "sinceChange", "oneDayBefore", "threeDaysBefore", "sevenDaysBefore"];
export const WINDOW_LABEL = {
  last3Days: "Last 3 Days",
  last7Days: "Last 7 Days",
  sinceChange: "Since Change",
  oneDayBefore: "1 Day Before",
  threeDaysBefore: "3 Days Before",
  sevenDaysBefore: "7 Days Before",
};

// Additive metrics (a genuine total over the window — Spend, Purchases, …)
// need dividing by the window's own day-count before two different-length
// windows are actually comparable at a glance — a 7-day Spend total next to
// a 1-day one is 7x larger for no interesting reason. Rate/ratio metrics
// (percent/decimal format — ROAS, CTR — plus the currency-format ones in
// RATE_METRIC_KEYS, like Cost Per Purchase, which are already "cost ÷
// something" and would get silently diluted by a second division) are
// window-independent and shown as-is.
export function normalizedValue(metric, rawValue, days) {
  if (rawValue == null) return null;
  const isAdditiveTotal = (metric.format === "number" || metric.format === "currency") && !RATE_METRIC_KEYS.has(metric.key);
  if (isAdditiveTotal && days > 1) return rawValue / days;
  return rawValue;
}

// Renders the metric-rows × window-columns comparison grid — the shared core
// of both the top-level Investigate drawer and each per-entity drill-down
// row. `windows` is the `{ [windowName]: {since,until,days,metrics,tooRecent?,overlapsChange?} }`
// shape returned by pages/api/fb/recent-changes/investigate.js; `catalog` is
// the metric catalog to resolve `metricKeys` labels/formats against.
export default function WindowComparisonTable({ windows, metricKeys, catalog, loading, currency }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Metric</th>
            {WINDOW_ORDER.map((name) => {
              const w = windows?.[name];
              return (
                <th key={name} className={name === "sinceChange" ? styles.drawerSinceChangeCol : undefined}>
                  {WINDOW_LABEL[name]}
                  {w && !w.tooRecent && <span className={styles.muted}> ({w.days}d)</span>}
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

            // Pre-compute every window's displayed value once, so the
            // best/worst comparison below (unit metrics only) reads the
            // exact same numbers the cells render, never a second,
            // possibly-divergent one. A window that's too recent or
            // overlaps the change (mixes pre- and post-change delivery) is
            // excluded from the comparison entirely, the same way it's
            // excluded from the rendered value.
            const cellValues = WINDOW_ORDER.map((name) => {
              const w = windows?.[name];
              if (!w || w.tooRecent || w.overlapsChange) return null;
              return normalizedValue(metric, w.metrics?.[key], w.days);
            });
            let bestValue = null;
            let worstValue = null;
            if (unit && !loading) {
              const numeric = cellValues.filter((v) => typeof v === "number" && !isNaN(v));
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
                {WINDOW_ORDER.map((name, i) => {
                  const cellClass = name === "sinceChange" ? styles.drawerSinceChangeCol : undefined;
                  if (loading) {
                    return (
                      <td key={name} className={cellClass}>
                        <Loader inline />
                      </td>
                    );
                  }
                  const w = windows?.[name];
                  if (!w) return <td key={name} className={cellClass}>—</td>;
                  if (w.tooRecent) {
                    return (
                      <td key={name} className={`${styles.muted} ${cellClass || ""}`}>
                        Not enough time yet
                      </td>
                    );
                  }
                  if (w.overlapsChange) {
                    return (
                      <td
                        key={name}
                        className={`${styles.muted} ${cellClass || ""}`}
                        title="This window spans both before and after the change, so it isn't a clean post-change read."
                      >
                        Includes pre-change days
                      </td>
                    );
                  }
                  const value = cellValues[i];
                  const tone = value === bestValue ? "var(--green)" : value === worstValue ? "var(--red)" : undefined;
                  return (
                    <td key={name} className={cellClass} style={tone ? { color: tone, fontWeight: 700 } : undefined}>
                      {formatMetricValue(value, metric.format, currency)}
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
