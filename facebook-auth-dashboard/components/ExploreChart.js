import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { formatMetricValue } from "@/lib/insightsMetrics";
import styles from "@/styles/Home.module.css";

const MAX_CHART_ROWS = 20;
const MAX_CHART_SERIES = 8;
const SERIES_COLORS = [
  "var(--purple)",
  "#4ade80",
  "#fbbf24",
  "#60a5fa",
  "#f472b6",
  "#a78bfa",
  "#34d399",
  "#fb923c",
];

// Every "possible combination" this app's query builder can produce reduces
// to one of four shapes, each wanting a different chart:
//  - time-grouped, no breakdown: one row per date -> a plain line/trend.
//  - time-grouped + breakdown: one row per (date, breakdown value) -> a
//    multi-line chart, one line per breakdown value, pivoted by date.
//  - breakdown, not time-grouped: one row per breakdown value, no date ->
//    a bar chart ranked by the chosen metric, capped to the top N.
//  - neither (one aggregate row): nothing to plot as a trend/category chart
//    — only meaningful when comparing to the previous period, as a 2-bar
//    "then vs now" — otherwise there's truly only one number, so the table
//    is the right place for it, not a chart.
function buildChartSpec({ rows, chartMetricKey, timeIncrement, hasBreakdown, compareToPrevious }) {
  const hasTime = !!timeIncrement;

  if (hasTime && !hasBreakdown) {
    const data = [...rows].sort((a, b) => (a.date || "").localeCompare(b.date || "")).map((r) => ({
      x: r.date,
      [chartMetricKey]: r[chartMetricKey],
    }));
    return { type: "line", data, series: [chartMetricKey] };
  }

  if (hasTime && hasBreakdown) {
    const byDate = new Map();
    const labels = [];
    for (const r of rows) {
      if (!labels.includes(r.label)) labels.push(r.label);
      if (!byDate.has(r.date)) byDate.set(r.date, { x: r.date });
      byDate.get(r.date)[r.label] = r[chartMetricKey];
    }
    const data = [...byDate.values()].sort((a, b) => a.x.localeCompare(b.x));
    const series = labels.slice(0, MAX_CHART_SERIES);
    return { type: "line", data, series, truncatedSeries: labels.length > MAX_CHART_SERIES };
  }

  if (!hasTime && hasBreakdown) {
    const sorted = [...rows].sort((a, b) => (b[chartMetricKey] || 0) - (a[chartMetricKey] || 0));
    const top = sorted.slice(0, MAX_CHART_ROWS);
    return {
      type: "bar",
      data: top.map((r) => ({ x: r.label, [chartMetricKey]: r[chartMetricKey] })),
      series: [chartMetricKey],
      truncatedRows: sorted.length > MAX_CHART_ROWS ? sorted.length : null,
    };
  }

  if (compareToPrevious && rows[0]) {
    const row = rows[0];
    return {
      type: "bar",
      data: [
        { x: "Previous period", value: row._previous ? row._previous[chartMetricKey] : null },
        { x: "This period", value: row[chartMetricKey] },
      ],
      series: ["value"],
    };
  }

  return { type: "none" };
}

// `rows`/`meta` are the raw response from /api/fb/explore-insights;
// `chartMetricKey` is the one metric the user picked to plot (metrics/
// breakdown values can both be numerous — plotting exactly one keeps every
// shape above legible rather than attempting every metric at once).
// `effectiveCatalog` is the built-in catalog merged with the user's own
// custom metrics (lib/insightsMetrics.js's buildEffectiveCatalog) — passed
// in rather than imported directly so a custom metric's label/format
// resolve here the same way a built-in one's does.
export default function ExploreChart({ rows, meta, chartMetricKey, currency, effectiveCatalog }) {
  const metric = effectiveCatalog.find((m) => m.key === chartMetricKey);
  if (!rows || rows.length === 0 || !metric) {
    return <p className={styles.sub}>No data to chart.</p>;
  }

  const spec = buildChartSpec({
    rows,
    chartMetricKey,
    timeIncrement: meta.timeIncrement,
    hasBreakdown: meta.breakdownGroup !== "none",
    compareToPrevious: meta.compareToPrevious,
  });

  if (spec.type === "none") {
    return (
      <p className={styles.sub}>
        This query has a single total with nothing to break it down by — add a breakdown or daily/weekly grouping
        above to get a chart, or view it in the table.
      </p>
    );
  }

  const formatValue = (v) => formatMetricValue(v, metric.format, currency);
  const ChartComponent = spec.type === "line" ? LineChart : BarChart;

  return (
    <div>
      {spec.truncatedRows && (
        <p className={styles.sub} style={{ marginBottom: 8 }}>
          Showing the top {MAX_CHART_ROWS} of {spec.truncatedRows} rows by {metric.label} — see the table for the
          rest.
        </p>
      )}
      {spec.truncatedSeries && (
        <p className={styles.sub} style={{ marginBottom: 8 }}>
          Showing the first {MAX_CHART_SERIES} series — see the table for the rest.
        </p>
      )}
      <div style={{ width: "100%", height: 360 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ChartComponent data={spec.data}>
            <CartesianGrid stroke="rgba(255,255,255,.06)" />
            <XAxis dataKey="x" stroke="var(--t3)" fontSize={11} />
            <YAxis stroke="var(--t3)" fontSize={11} tickFormatter={formatValue} width={70} />
            <Tooltip
              contentStyle={{ background: "#13112b", border: "1px solid rgba(255,255,255,.12)", borderRadius: 8 }}
              labelStyle={{ color: "var(--t1)" }}
              formatter={(v) => formatValue(v)}
            />
            {spec.series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
            {spec.series.map((key, i) =>
              spec.type === "line" ? (
                <Line
                  key={key}
                  type="monotone"
                  dataKey={key}
                  name={key === chartMetricKey ? metric.label : key}
                  stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
                  strokeWidth={2}
                  dot={spec.data.length <= 31}
                  connectNulls
                />
              ) : (
                <Bar
                  key={key}
                  dataKey={key}
                  name={key === chartMetricKey ? metric.label : key}
                  fill={SERIES_COLORS[i % SERIES_COLORS.length]}
                />
              )
            )}
          </ChartComponent>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
