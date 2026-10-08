import Head from "next/head";
import dynamic from "next/dynamic";
import { getServerSession } from "next-auth/next";
import { useMemo, useState } from "react";
import { authOptions } from "./api/auth/[...nextauth]";
import Layout from "@/components/Layout";
import Loader from "@/components/Loader";
import CacheStatus from "@/components/CacheStatus";
import SortableTable from "@/components/SortableTable";
import { useAccounts } from "@/components/AccountProvider";
import { getCachedEntry, setCachedEntry } from "@/lib/clientCache";
import {
  LEVEL_OPTIONS,
  BREAKDOWN_GROUPS,
  METRIC_CATALOG,
  formatMetricValue,
  isChartableMetric,
} from "@/lib/insightsMetrics";
import styles from "@/styles/Home.module.css";

// Recharts measures its container via ResizeObserver, so it can't be
// server-rendered — loaded only on this route, only on the client.
const ExploreChart = dynamic(() => import("@/components/ExploreChart"), { ssr: false });

const MAX_RANGE_DAYS = 30;
const EXPLORE_CACHE_PREFIX = "explore:";
const EXPLORE_CACHE_MAX_ENTRIES = 20;

const RANGE_PRESETS = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "last_7d", label: "Last 7 Days" },
  { key: "last_14d", label: "Last 14 Days" },
  { key: "last_30d", label: "Last 30 Days" },
  { key: "custom", label: "Custom" },
];

const TIME_GROUPING_OPTIONS = [
  { value: "", label: "No grouping (totals)" },
  { value: "1", label: "Daily" },
  { value: "7", label: "Weekly" },
];

const METRIC_GROUPS = [...new Set(METRIC_CATALOG.map((m) => m.group))];

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function addDaysUTC(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return isoDate(d);
}

function todayUTC() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

// Every preset resolves to a concrete {since, until} — "custom" is the only
// one that depends on user input rather than "now".
function computeRange(preset, customSince, customUntil) {
  const today = todayUTC();
  switch (preset) {
    case "today":
      return { since: isoDate(today), until: isoDate(today) };
    case "yesterday": {
      const y = addDaysUTC(isoDate(today), -1);
      return { since: y, until: y };
    }
    case "last_7d":
      return { since: addDaysUTC(isoDate(today), -6), until: isoDate(today) };
    case "last_14d":
      return { since: addDaysUTC(isoDate(today), -13), until: isoDate(today) };
    case "last_30d":
      return { since: addDaysUTC(isoDate(today), -29), until: isoDate(today) };
    case "custom":
      return customSince && customUntil ? { since: customSince, until: customUntil } : null;
    default:
      return null;
  }
}

function inclusiveDayCount(since, until) {
  return Math.round((new Date(`${until}T00:00:00Z`) - new Date(`${since}T00:00:00Z`)) / 86400000) + 1;
}

async function fetchExploreInsights(body) {
  const res = await fetch("/api/fb/explore-insights", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json;
}

export default function Explore() {
  const { adAccounts, accountsError, selectedAccountId, setSelectedAccountId } = useAccounts();
  const currency = adAccounts.find((a) => a.id === selectedAccountId)?.currency;

  const [rangePreset, setRangePreset] = useState("last_30d");
  const [customSince, setCustomSince] = useState("");
  const [customUntil, setCustomUntil] = useState("");
  const [level, setLevel] = useState("account");
  const [breakdownGroup, setBreakdownGroup] = useState("none");
  const [timeIncrement, setTimeIncrement] = useState("");
  const [metricKeys, setMetricKeys] = useState(["spend", "impressions", "clicks", "ctr"]);
  const [customFieldsText, setCustomFieldsText] = useState("");
  const [compareToPrevious, setCompareToPrevious] = useState(false);

  const [result, setResult] = useState(null);
  const [resultFetchedAt, setResultFetchedAt] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [viewMode, setViewMode] = useState("table");
  const [chartMetricKey, setChartMetricKey] = useState(null);

  const range = computeRange(rangePreset, customSince, customUntil);
  const rangeDays = range ? inclusiveDayCount(range.since, range.until) : null;
  const rangeValid = !!range && rangeDays > 0 && rangeDays <= MAX_RANGE_DAYS;

  const customFields = useMemo(
    () =>
      customFieldsText
        .split(",")
        .map((f) => f.trim())
        .filter(Boolean),
    [customFieldsText]
  );

  const canRunQuery = !!selectedAccountId && rangeValid && metricKeys.length > 0;
  const compareDisabled = timeIncrement !== "";

  function toggleMetric(key) {
    setMetricKeys((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }

  function buildQuerySpec(force) {
    return {
      accountId: selectedAccountId,
      level,
      breakdownGroup,
      metricKeys,
      customFields,
      since: range.since,
      until: range.until,
      timeIncrement: timeIncrement || null,
      compareToPrevious: compareDisabled ? false : compareToPrevious,
      force,
    };
  }

  function runQuery(force) {
    if (!canRunQuery) return;
    const spec = buildQuerySpec(force);
    const cacheKey = EXPLORE_CACHE_PREFIX + JSON.stringify(spec);

    if (!force) {
      const cached = getCachedEntry(cacheKey);
      if (cached) {
        setResult(cached.data);
        setResultFetchedAt(cached.fetchedAt);
        setError(null);
        const firstChartable = cached.data.meta.metricKeys.find(isChartableMetric);
        setChartMetricKey(firstChartable || null);
        return;
      }
    }

    setLoading(true);
    setError(null);
    fetchExploreInsights(spec)
      .then((json) => {
        setResult(json);
        setResultFetchedAt(Date.now());
        setCachedEntry(cacheKey, json, { prefix: EXPLORE_CACHE_PREFIX, maxEntriesForPrefix: EXPLORE_CACHE_MAX_ENTRIES });
        const firstChartable = json.meta.metricKeys.find(isChartableMetric);
        setChartMetricKey(firstChartable || null);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  const chartableMetricKeys = result ? result.meta.metricKeys.filter(isChartableMetric) : [];

  return (
    <Layout>
      <Head>
        <title>Explore · Facebook Auth Dashboard</title>
      </Head>
      <div className={styles.page}>
        <main className={styles.main} style={{ maxWidth: 1200, margin: "0 auto" }}>
          <h1 className={styles.h1}>Explore</h1>
          <p className={styles.sub} style={{ marginTop: -8 }}>
            Build any view of this account&apos;s Facebook Ads data — pick a date range (up to 30 days), a level, a
            breakdown, and whatever metrics you want, then view it as a table or chart. Nothing runs until you click
            Run Query.
          </p>

          {accountsError && <div className={styles.error}>Error loading ad accounts: {accountsError}</div>}

          <section className={styles.card} style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <div>
              <h2 className={styles.h2}>Account</h2>
              <select
                className={styles.select}
                style={{ width: "100%", maxWidth: 420 }}
                value={selectedAccountId}
                onChange={(e) => setSelectedAccountId(e.target.value)}
              >
                <option value="" disabled>
                  Select an account…
                </option>
                {adAccounts.map((acc) => (
                  <option key={acc.id} value={acc.id}>
                    {acc.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <h2 className={styles.h2}>Date range</h2>
              <div className={styles.tabGroup} style={{ marginBottom: 10 }}>
                {RANGE_PRESETS.map((p) => (
                  <button
                    key={p.key}
                    className={rangePreset === p.key ? `${styles.tab} ${styles.tabActive}` : styles.tab}
                    onClick={() => setRangePreset(p.key)}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              {rangePreset === "custom" && (
                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <input
                    type="date"
                    className={styles.select}
                    value={customSince}
                    max={customUntil || isoDate(todayUTC())}
                    onChange={(e) => setCustomSince(e.target.value)}
                  />
                  <span className={styles.muted}>to</span>
                  <input
                    type="date"
                    className={styles.select}
                    value={customUntil}
                    min={customSince || undefined}
                    max={
                      customSince
                        ? [addDaysUTC(customSince, MAX_RANGE_DAYS - 1), isoDate(todayUTC())].sort()[0]
                        : isoDate(todayUTC())
                    }
                    onChange={(e) => setCustomUntil(e.target.value)}
                  />
                </div>
              )}
              {range && !rangeValid && (
                <p className={styles.sub} style={{ color: "#ff7070", marginTop: 8 }}>
                  Date range cannot exceed {MAX_RANGE_DAYS} days (currently {rangeDays}).
                </p>
              )}
            </div>

            <div>
              <h2 className={styles.h2}>Level</h2>
              <div className={styles.tabGroup}>
                {LEVEL_OPTIONS.map((l) => (
                  <button
                    key={l.value}
                    className={level === l.value ? `${styles.tab} ${styles.tabActive}` : styles.tab}
                    onClick={() => setLevel(l.value)}
                  >
                    {l.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <h2 className={styles.h2}>Breakdown</h2>
              <p className={styles.sub} style={{ marginBottom: 10 }}>
                One breakdown at a time — Meta restricts which dimensions can combine, so these are pre-combined,
                known-good groups rather than a free pick-any-combination list.
              </p>
              <select
                className={styles.select}
                style={{ width: "100%", maxWidth: 420 }}
                value={breakdownGroup}
                onChange={(e) => setBreakdownGroup(e.target.value)}
              >
                {BREAKDOWN_GROUPS.map((g) => (
                  <option key={g.value} value={g.value}>
                    {g.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <h2 className={styles.h2}>Group by time</h2>
              <div className={styles.tabGroup}>
                {TIME_GROUPING_OPTIONS.map((o) => (
                  <button
                    key={o.value}
                    className={timeIncrement === o.value ? `${styles.tab} ${styles.tabActive}` : styles.tab}
                    onClick={() => setTimeIncrement(o.value)}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <h2 className={styles.h2}>Metrics</h2>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {METRIC_GROUPS.map((group) => (
                  <div key={group}>
                    <p className={styles.muted} style={{ marginBottom: 6 }}>
                      {group}
                    </p>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {METRIC_CATALOG.filter((m) => m.group === group).map((m) => {
                        const selected = metricKeys.includes(m.key);
                        return (
                          <button
                            key={m.key}
                            type="button"
                            onClick={() => toggleMetric(m.key)}
                            className={selected ? styles.badgeInfo : styles.pill}
                            style={
                              selected
                                ? { cursor: "pointer" }
                                : { cursor: "pointer", background: "transparent", border: "1px dashed var(--border)", color: "var(--t2)" }
                            }
                          >
                            {selected ? "✓ " : "+ "}
                            {m.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 14 }}>
                <p className={styles.sub} style={{ marginBottom: 6 }}>
                  Not finding a field above? Add any raw Facebook Insights field name (comma-separated) — anything
                  Meta exposes, passed straight through.
                </p>
                <input
                  type="text"
                  className={styles.select}
                  style={{ width: "100%" }}
                  placeholder="e.g. website_ctr, mobile_app_purchase_roas"
                  value={customFieldsText}
                  onChange={(e) => setCustomFieldsText(e.target.value)}
                />
              </div>
            </div>

            <div>
              <h2 className={styles.h2}>Compare to previous period</h2>
              <p className={styles.sub} style={{ marginBottom: 10 }}>
                Shows each row&apos;s change against the immediately preceding period of equal length — a 7-day
                range compares week-over-week.
                {compareDisabled && " Not available together with daily/weekly grouping."}
              </p>
              <div className={styles.tabGroup}>
                <button
                  className={!compareToPrevious ? `${styles.tab} ${styles.tabActive}` : styles.tab}
                  onClick={() => setCompareToPrevious(false)}
                >
                  Off
                </button>
                <button
                  className={compareToPrevious ? `${styles.tab} ${styles.tabActive}` : styles.tab}
                  onClick={() => setCompareToPrevious(true)}
                  disabled={compareDisabled}
                >
                  On
                </button>
              </div>
            </div>

            <button type="button" className={styles.btnPrimary} style={{ alignSelf: "flex-start" }} disabled={!canRunQuery || loading} onClick={() => runQuery(false)}>
              {loading ? "Running…" : "Run Query"}
            </button>
          </section>

          {error && <div className={styles.error}>Error: {error}</div>}
          {loading && !result && <Loader label="Running your query…" />}

          {result && (
            <section className={styles.card} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
                <CacheStatus label="Result" fetchedAt={resultFetchedAt} loading={loading} onRefresh={() => runQuery(true)} />
                <div className={styles.tabGroup}>
                  <button
                    className={viewMode === "table" ? `${styles.tab} ${styles.tabActive}` : styles.tab}
                    onClick={() => setViewMode("table")}
                  >
                    Table
                  </button>
                  <button
                    className={viewMode === "chart" ? `${styles.tab} ${styles.tabActive}` : styles.tab}
                    onClick={() => setViewMode("chart")}
                  >
                    Chart
                  </button>
                </div>
              </div>

              <p className={styles.sub}>
                {result.meta.since} → {result.meta.until}
                {result.meta.compareToPrevious && ` · vs. ${result.meta.previousSince} → ${result.meta.previousUntil}`}
                {" · "}
                {result.meta.rowCount} row{result.meta.rowCount === 1 ? "" : "s"}
              </p>

              {viewMode === "chart" && chartableMetricKeys.length > 0 && (
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span className={styles.muted}>Chart metric</span>
                  <select className={styles.select} value={chartMetricKey || ""} onChange={(e) => setChartMetricKey(e.target.value)}>
                    {chartableMetricKeys.map((key) => (
                      <option key={key} value={key}>
                        {METRIC_CATALOG.find((m) => m.key === key)?.label || key}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {viewMode === "table" ? (
                <ExploreResultsTable result={result} currency={currency} />
              ) : chartMetricKey ? (
                <ExploreChart rows={result.rows} meta={result.meta} chartMetricKey={chartMetricKey} currency={currency} />
              ) : (
                <p className={styles.sub}>No chartable metric selected — quality rankings are table-only.</p>
              )}
            </section>
          )}
        </main>
      </div>
    </Layout>
  );
}

// The delta, when comparing, renders directly under its own metric's value
// in the same cell/column — not as a separate trailing column. With several
// metrics selected, a separate "<Metric> Δ%" column per metric pushed the
// comparison for e.g. Spend far off to the right of the Spend column itself,
// behind a horizontal scroll, making the two hard to read together.
function DeltaBadge({ value }) {
  if (typeof value !== "number") return null;
  const color = value > 0 ? "#4ade80" : value < 0 ? "#ff7070" : "var(--t2)";
  const arrow = value > 0 ? "▲" : value < 0 ? "▼" : "";
  return (
    <div style={{ fontSize: 11, color, marginTop: 2 }}>
      {arrow} {Math.abs(value).toFixed(1)}%
    </div>
  );
}

function ExploreResultsTable({ result, currency }) {
  const { rows, meta } = result;
  const allKeys = [...meta.metricKeys, ...meta.customFields];

  const columns = [
    { key: "label", label: meta.breakdownGroup === "none" ? "Period" : "Breakdown", maxWidth: 260 },
    ...allKeys.map((key) => {
      const metric = METRIC_CATALOG.find((m) => m.key === key);
      const format = metric?.format || "number";
      const label = metric?.label || key;
      const comparable = meta.compareToPrevious && format !== "text";
      return {
        key,
        label,
        align: "right",
        sortValue: (row) => (typeof row[key] === "number" ? row[key] : -Infinity),
        render: (row) => {
          const value = formatMetricValue(row[key], format, currency);
          if (!comparable) return value;
          return (
            <div>
              <div>{value}</div>
              <DeltaBadge value={row._deltaPct?.[key]} />
            </div>
          );
        },
      };
    }),
  ];

  return (
    <div style={{ overflowX: "auto" }}>
      <SortableTable
        rows={rows}
        columns={columns}
        defaultSortKey={meta.metricKeys[0] || "label"}
        maxHeight={480}
        searchable={rows.length > 6}
        searchKeys={["label"]}
        searchPlaceholder="Search rows…"
      />
    </div>
  );
}

export async function getServerSideProps(context) {
  const session = await getServerSession(context.req, context.res, authOptions);

  if (!session) {
    return { redirect: { destination: "/", permanent: false } };
  }

  return { props: {} };
}
