import Loader from "./Loader";
import { formatMetricValue } from "@/lib/insightsMetrics";
import styles from "@/styles/Home.module.css";

const dayLabel = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

// The "Day by day" counterpart of WindowComparisonTable: one row per calendar day around the investigated day, one column
// per selected metric. `days` is the `[{ date, metrics }]` list from pages/api/fb/recent-changes/investigate.js?mode=daily.
export default function DailyBreakdownTable({ days, changeDay, today, metricKeys, catalog, loading, currency }) {
  const metrics = metricKeys.map((key) => catalog.find((m) => m.key === key)).filter(Boolean);
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
                    <td key={m.key}>{formatMetricValue(day.metrics?.[m.key] ?? null, m.format, currency)}</td>
                  ))}
                </tr>
              );
            })}
        </tbody>
      </table>
    </div>
  );
}
