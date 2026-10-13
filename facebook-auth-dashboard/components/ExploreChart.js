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

// Short, human date label for the previous/current comparison bars below —
// "Sep 13" or "Sep 13 – Oct 12", never the bare ISO strings.
function formatDateRangeLabel(since, until) {
  if (!since || !until) return null;
  const fmt = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return since === until ? fmt(since) : `${fmt(since)} – ${fmt(until)}`;
}

// Every ISO date from `since` to `until`, inclusive — the real, full x-axis
// for a time-grouped chart, as opposed to whatever subset of dates happens
// to still have a surviving row after the "Filter results" panel (metric
// thresholds, status) has removed some. Without this, a filtered-out day
// simply isn't a data point at all rather than a gap, so the x-axis quietly
// shrinks to fit whatever's left and the line still looks like one
// continuous, unbroken trend — applying a filter to a chart could look like
// it did nothing even though it demonstrably changed the underlying rows.
function allDatesInRange(since, until) {
  if (!since || !until) return null;
  const dates = [];
  let d = new Date(`${since}T00:00:00Z`);
  const end = new Date(`${until}T00:00:00Z`);
  while (d <= end) {
    dates.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return dates;
}

// Every "possible combination" this app's query builder can produce reduces
// to one of four shapes, each wanting a different chart. The dimension that
// actually matters for "one series vs several" isn't literally "is a
// breakdown selected" — it's "do these rows represent more than one distinct
// thing" (`multiEntity`, `rows.label`'s distinct-value count), which is also
// true for multiple accounts (pages/explore.js prefixes `label` with the
// account name before handing rows here whenever more than one account is
// selected) or a breakdown, or both at once — same pivot-by-label logic
// handles all three:
//  - time-grouped, single entity: one row per date -> a plain line/trend,
//    optionally with a second metric's own line (secondaryMetricKey).
//  - time-grouped, multiple entities: one row per (date, entity) -> a
//    multi-line chart, one line per entity, pivoted by date — "the" series
//    is already spoken for by that pivot, so secondaryMetricKey/xAxisKey
//    (both about customizing a single metric's own axes) don't apply here.
//  - multiple entities, not time-grouped: one row per entity, no date -> a
//    bar chart ranked by the chosen metric, capped to the top N. `xAxisKey`
//    picks which row field categorizes the bars (default: the combined
//    name/breakdown `label`); `secondaryMetricKey` adds a second bar per
//    entity on its own right-hand axis.
//  - single entity, no time grouping (one aggregate row): nothing to plot as
//    a trend/category chart — only meaningful when comparing to the previous
//    period, as a 2-bar "then vs now" (labeled with the real date ranges,
//    not just "Previous"/"This period") — otherwise there's truly only one
//    number, so the table is the right place for it, not a chart.
function buildChartSpec({
  rows,
  chartMetricKey,
  secondaryMetricKey,
  xAxisKey,
  timeIncrement,
  multiEntity,
  compareToPrevious,
  since,
  until,
  previousSince,
  previousUntil,
}) {
  const hasTime = !!timeIncrement;
  const secondarySeriesFields = secondaryMetricKey ? [secondaryMetricKey] : [];

  if (hasTime && !multiEntity) {
    const byDate = new Map(rows.map((r) => [r.date, r]));
    const dates = allDatesInRange(since, until) || [...byDate.keys()].sort();
    const data = dates.map((date) => {
      const r = byDate.get(date);
      return {
        x: date,
        [chartMetricKey]: r ? r[chartMetricKey] : null,
        ...(secondaryMetricKey ? { [secondaryMetricKey]: r ? r[secondaryMetricKey] : null } : {}),
      };
    });
    return { type: "line", data, series: [chartMetricKey, ...secondarySeriesFields] };
  }

  if (hasTime && multiEntity) {
    const byDateAndLabel = new Map();
    const labels = [];
    for (const r of rows) {
      if (!labels.includes(r.label)) labels.push(r.label);
      if (!byDateAndLabel.has(r.date)) byDateAndLabel.set(r.date, {});
      byDateAndLabel.get(r.date)[r.label] = r[chartMetricKey];
    }
    const series = labels.slice(0, MAX_CHART_SERIES);
    const dates = allDatesInRange(since, until) || [...byDateAndLabel.keys()].sort();
    const data = dates.map((date) => {
      const atDate = byDateAndLabel.get(date) || {};
      const entry = { x: date };
      for (const label of series) entry[label] = label in atDate ? atDate[label] : null;
      return entry;
    });
    return { type: "line", data, series, truncatedSeries: labels.length > MAX_CHART_SERIES };
  }

  if (!hasTime && multiEntity) {
    const sorted = [...rows].sort((a, b) => (b[chartMetricKey] || 0) - (a[chartMetricKey] || 0));
    const top = sorted.slice(0, MAX_CHART_ROWS);
    return {
      type: "bar",
      data: top.map((r) => ({
        x: xAxisKey && r[xAxisKey] != null && r[xAxisKey] !== "" ? r[xAxisKey] : r.label,
        [chartMetricKey]: r[chartMetricKey],
        ...(secondaryMetricKey ? { [secondaryMetricKey]: r[secondaryMetricKey] } : {}),
      })),
      series: [chartMetricKey, ...secondarySeriesFields],
      truncatedRows: sorted.length > MAX_CHART_ROWS ? sorted.length : null,
    };
  }

  if (compareToPrevious && rows[0]) {
    const row = rows[0];
    return {
      type: "bar",
      data: [
        { x: formatDateRangeLabel(previousSince, previousUntil) || "Previous period", value: row._previous ? row._previous[chartMetricKey] : null },
        { x: formatDateRangeLabel(since, until) || "This period", value: row[chartMetricKey] },
      ],
      series: ["value"],
    };
  }

  return { type: "none" };
}

// `rows`/`meta` are the raw response from /api/fb/explore-insights;
// `chartMetricKey` is the primary metric plotted on the left Y axis.
// `secondaryMetricKey` (optional) adds a second series on its own right-hand
// Y axis — only where there's a single series already in play for the
// primary metric (see buildChartSpec's comment above for which shapes that
// is); silently ignored otherwise, with a note shown so picking it never
// looks like it simply did nothing. `xAxisKey` (optional) picks which row
// field categorizes a non-time bar chart's bars, instead of the default
// combined name/breakdown `label`. `effectiveCatalog` is the built-in
// catalog merged with the user's own custom metrics (lib/insightsMetrics.js's
// buildEffectiveCatalog) — passed in rather than imported directly so a
// custom metric's label/format resolve here the same way a built-in one's
// does.
export default function ExploreChart({ rows, meta, chartMetricKey, secondaryMetricKey, xAxisKey, currency, effectiveCatalog }) {
  const metric = effectiveCatalog.find((m) => m.key === chartMetricKey);
  if (!rows || rows.length === 0 || !metric) {
    return <p className={styles.sub}>No data to chart.</p>;
  }

  const multiEntity = new Set(rows.map((r) => r.label)).size > 1;
  const hasTime = !!meta.timeIncrement;
  const shapeSupportsSecondaryAxis = (hasTime && !multiEntity) || (!hasTime && multiEntity);
  const shapeSupportsXAxisChoice = !hasTime && multiEntity;

  const effectiveSecondaryKey = shapeSupportsSecondaryAxis ? secondaryMetricKey : null;
  const secondaryMetric = effectiveSecondaryKey ? effectiveCatalog.find((m) => m.key === effectiveSecondaryKey) : null;
  const effectiveXAxisKey = shapeSupportsXAxisChoice ? xAxisKey : null;

  const spec = buildChartSpec({
    rows,
    chartMetricKey,
    secondaryMetricKey: effectiveSecondaryKey,
    xAxisKey: effectiveXAxisKey,
    timeIncrement: meta.timeIncrement,
    multiEntity,
    compareToPrevious: meta.compareToPrevious,
    since: meta.since,
    until: meta.until,
    previousSince: meta.previousSince,
    previousUntil: meta.previousUntil,
  });

  if (spec.type === "none") {
    return (
      <p className={styles.sub}>
        This query has a single total with nothing to break it down by — add a breakdown or daily/weekly grouping
        above to get a chart, or view it in the table.
      </p>
    );
  }

  // Resolves a data key to the right formatter — the primary/secondary
  // metric's own format for their real keys, and the primary metric's format
  // for anything else (an entity-pivoted series' key is that entity's own
  // label, not a metric key, but every such series is still the same
  // primary metric; the 2-bar comparison's single series is literally keyed
  // "value", same reasoning).
  const formatFor = (key) => {
    if (key === effectiveSecondaryKey && secondaryMetric) return (v) => formatMetricValue(v, secondaryMetric.format, currency);
    return (v) => formatMetricValue(v, metric.format, currency);
  };
  const hasSecondarySeries = !!effectiveSecondaryKey && spec.series.includes(effectiveSecondaryKey);
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
      {secondaryMetricKey && !shapeSupportsSecondaryAxis && (
        <p className={styles.sub} style={{ marginBottom: 8 }}>
          A 2nd Y axis metric isn&apos;t shown for this chart shape (every line here is already one entity&apos;s own
          {` ${metric.label}`}).
        </p>
      )}
      {xAxisKey && !shapeSupportsXAxisChoice && (
        <p className={styles.sub} style={{ marginBottom: 8 }}>
          A custom X axis only applies to a category chart (no date grouping, more than one row).
        </p>
      )}
      <div style={{ width: "100%", height: 360 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ChartComponent data={spec.data}>
            <CartesianGrid stroke="rgba(var(--surface-tint-rgb),.06)" />
            <XAxis dataKey="x" stroke="var(--t3)" fontSize={11} />
            <YAxis yAxisId="left" stroke="var(--t3)" fontSize={11} tickFormatter={formatFor(chartMetricKey)} width={70} />
            {hasSecondarySeries && (
              <YAxis
                yAxisId="right"
                orientation="right"
                stroke="var(--t3)"
                fontSize={11}
                tickFormatter={formatFor(effectiveSecondaryKey)}
                width={70}
              />
            )}
            <Tooltip
              contentStyle={{ background: "var(--bg)", border: "1px solid rgba(var(--surface-tint-rgb),.12)", borderRadius: 8 }}
              labelStyle={{ color: "var(--t1)" }}
              itemStyle={{ color: "var(--t1)" }}
              formatter={(v, _name, item) => formatFor(item.dataKey)(v)}
            />
            {spec.series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
            {spec.series.map((key, i) => {
              const isSecondary = key === effectiveSecondaryKey;
              const yAxisId = isSecondary ? "right" : "left";
              const name = key === chartMetricKey ? metric.label : isSecondary ? secondaryMetric?.label || key : key;
              return spec.type === "line" ? (
                <Line
                  key={key}
                  yAxisId={yAxisId}
                  type="monotone"
                  dataKey={key}
                  name={name}
                  stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
                  strokeWidth={2}
                  dot={spec.data.length <= 31}
                  // Deliberately NOT connectNulls: a null here means a row
                  // that got excluded by the "Filter results" panel (or a
                  // genuinely dataless day) — bridging straight over it would
                  // make the filter's effect invisible, the line looking
                  // exactly as continuous as it did before filtering.
                />
              ) : (
                <Bar key={key} yAxisId={yAxisId} dataKey={key} name={name} fill={SERIES_COLORS[i % SERIES_COLORS.length]} />
              );
            })}
          </ChartComponent>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
