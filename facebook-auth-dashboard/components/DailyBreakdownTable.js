import Loader from "./Loader";
import { LOWER_IS_BETTER_METRIC_KEYS, formatMetricValue } from "@/lib/insightsMetrics";
import styles from "@/styles/Home.module.css";

const dayLabel = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

// Tints each cell from red (the column's worst day) to green (its best day), so the trend reads at a glance. Cost-type
// metrics are best when lowest, everything else when highest. A column whose days are all equal stays plain.
function columnTints(days, key) {
  const values = (days || []).map((d) => d.metrics?.[key]).filter((v) => typeof v === "number" && !isNaN(v));
  if (values.length < 2) return () => undefined;
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) return () => undefined;
  const lowerIsBetter = LOWER_IS_BETTER_METRIC_KEYS.has(key);
  return (v) => {
    if (typeof v !== "number" || isNaN(v)) return undefined;
    const t = (v - min) / (max - min);
    const goodness = lowerIsBetter ? 1 - t : t;
    const strength = Math.round(Math.abs(goodness - 0.5) * 2 * 38);
    return `color-mix(in srgb, var(${goodness >= 0.5 ? "--green" : "--red"}) ${strength}%, transparent)`;
  };
}

// The "Day by day" counterpart of WindowComparisonTable: one row per calendar day from the investigated day onward, one column
// per selected metric. `days` is the `[{ date, metrics }]` list from pages/api/fb/recent-changes/investigate.js?mode=daily.
export default function DailyBreakdownTable({ days: allDays, changeDay, today, metricKeys, catalog, loading, currency }) {
  // Earlier days in a cached copy of the old window are dropped, so only the selected day onward ever shows.
  const days = (allDays || []).filter((d) => !changeDay || d.date >= changeDay);
  const metrics = metricKeys.map((key) => catalog.find((m) => m.key === key)).filter(Boolean);
  const tints = Object.fromEntries(metrics.map((m) => [m.key, columnTints(days, m.key)]));
  return (
    <div style={{ overflowX: "auto" }}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Day</th>
            {metrics.map((m) => (
              <th key={m.key}>{m.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading && (
            <tr>
              <td colSpan={metrics.length + 1}>
                <Loader inline /> Loading daily numbers…
              </td>
            </tr>
          )}
          {!loading &&
            (days || []).map((day) => {
              const isChangeDay = day.date === changeDay;
              const isToday = day.date === today;
              return (
                <tr key={day.date} className={isChangeDay ? styles.drawerSinceChangeCol : undefined} style={day.date === changeDay ? { borderTop: "2px solid var(--border)", borderBottom: "2px solid var(--border)" } : undefined}>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {dayLabel(day.date)}
                    {isChangeDay && <span className={styles.badgeInfo} style={{ marginLeft: 6 }}>Selected day</span>}
                    {isToday && !isChangeDay && (
                      <span className={styles.muted} style={{ marginLeft: 6 }} title="Today isn't over yet — these totals are still accruing.">
                        so far
                      </span>
                    )}
                  </td>
                  {metrics.map((m) => (
                    <td key={m.key} style={{ background: tints[m.key](day.metrics?.[m.key]) }}>
                      {formatMetricValue(day.metrics?.[m.key] ?? null, m.format, currency)}
                    </td>
                  ))}
                </tr>
              );
            })}
        </tbody>
      </table>
    </div>
  );
}
