import Head from "next/head";
import dynamic from "next/dynamic";
import { getServerSession } from "next-auth/next";
import { useEffect, useMemo, useRef, useState } from "react";
import { authOptions } from "./api/auth/[...nextauth]";
import Layout from "@/components/Layout";
import Loader from "@/components/Loader";
import CacheStatus from "@/components/CacheStatus";
import SortableTable from "@/components/SortableTable";
import AccountSelect from "@/components/AccountSelect";
import { CloseIcon } from "@/components/icons";
import { useAccounts } from "@/components/AccountProvider";
import { getCachedEntry, setCachedEntry } from "@/lib/clientCache";
import { getExploreViews, setExploreViews } from "@/lib/clientStorage";
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
const EXPLORE_CACHE_MAX_ENTRIES = 50;
const MAX_VIEWS = 15;

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

function newViewId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `v${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

// One independent tab: its own account, its own query spec, its own
// fetched result/loading/error and view-mode — switching tabs never
// touches another tab's state.
function createBlankView(seedAccountId = "") {
  return {
    id: newViewId(),
    accountId: seedAccountId,
    rangePreset: "last_30d",
    customSince: "",
    customUntil: "",
    level: "account",
    breakdownGroup: "none",
    timeIncrement: "",
    metricKeys: ["spend", "impressions", "clicks", "ctr"],
    customFieldsText: "",
    compareToPrevious: false,
    result: null,
    resultFetchedAt: null,
    loading: false,
    error: null,
    viewMode: "table",
    chartMetricKey: null,
  };
}

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

function parseCustomFields(text) {
  return text
    .split(",")
    .map((f) => f.trim())
    .filter(Boolean);
}

// Pure: a view's current form fields -> the POST body /api/fb/explore-insights
// expects. No `force` baked in — that's passed separately to runQueryForView.
function buildQuerySpecFromView(view) {
  const range = computeRange(view.rangePreset, view.customSince, view.customUntil);
  return {
    accountId: view.accountId,
    level: view.level,
    breakdownGroup: view.breakdownGroup,
    metricKeys: view.metricKeys,
    customFields: parseCustomFields(view.customFieldsText),
    since: range?.since,
    until: range?.until,
    timeIncrement: view.timeIncrement || null,
    compareToPrevious: view.timeIncrement ? false : view.compareToPrevious,
  };
}

function isViewRunnable(view) {
  const range = computeRange(view.rangePreset, view.customSince, view.customUntil);
  const rangeDays = range ? inclusiveDayCount(range.since, range.until) : null;
  const rangeValid = !!range && rangeDays > 0 && rangeDays <= MAX_RANGE_DAYS;
  return !!view.accountId && rangeValid && view.metricKeys.length > 0;
}

function firstChartableKey(meta) {
  return meta.metricKeys.find(isChartableMetric) || null;
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

// Keeps at most MAX_VIEWS tabs, evicting the oldest one that isn't the
// currently active tab — same shape as lib/clientCache.js's own
// maxEntriesForPrefix pruning.
function withCapApplied(viewsList, protectedId) {
  if (viewsList.length < MAX_VIEWS) return viewsList;
  const evictIdx = viewsList[0].id === protectedId ? 1 : 0;
  return viewsList.filter((_, i) => i !== evictIdx);
}

function viewTitle(view, adAccounts, fallbackIndex) {
  const account = adAccounts.find((a) => a.id === view.accountId);
  const base = account?.name || `View ${fallbackIndex + 1}`;
  if (view.level === "account") return base;
  const levelLabel = LEVEL_OPTIONS.find((l) => l.value === view.level)?.label;
  return `${base} · ${levelLabel}`;
}

function describeQuery(view) {
  const levelLabel = LEVEL_OPTIONS.find((l) => l.value === view.level)?.label;
  const breakdownLabel = BREAKDOWN_GROUPS.find((g) => g.value === view.breakdownGroup)?.label;
  const parts = [levelLabel];
  if (view.breakdownGroup !== "none") parts.push(breakdownLabel);
  return `Updating — ${parts.join(" · ")}…`;
}

export default function Explore() {
  const { adAccounts, accountsError, selectedAccountId } = useAccounts();

  const [views, setViews] = useState(() => [createBlankView("")]);
  const [activeViewId, setActiveViewId] = useState(() => views[0].id);
  const activeView = views.find((v) => v.id === activeViewId) || views[0];

  const currency = adAccounts.find((a) => a.id === activeView.accountId)?.currency;

  const hasSeededInitialAccountRef = useRef(false);
  const hasRestoredRef = useRef(false);

  // One-time restore of previously-open tabs from localStorage — replaces
  // the single deterministic blank tab wholesale. Pre-populates each
  // restored tab's result from the shared query cache when still fresh, so
  // reopening the page shows the same data instead of blank tabs.
  useEffect(() => {
    if (hasRestoredRef.current) return;
    hasRestoredRef.current = true;
    const persisted = getExploreViews();
    if (!persisted?.views?.length) return;

    const hydrated = persisted.views.map((v) => {
      const cached =
        v.accountId && v.metricKeys?.length > 0
          ? getCachedEntry(EXPLORE_CACHE_PREFIX + JSON.stringify(buildQuerySpecFromView(v)))
          : null;
      return {
        ...v,
        result: cached?.data ?? null,
        resultFetchedAt: cached?.fetchedAt ?? null,
        loading: false,
        error: null,
      };
    });
    // One-time hydration from localStorage on mount, not derived state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setViews(hydrated);
    setActiveViewId(hydrated.some((v) => v.id === persisted.activeViewId) ? persisted.activeViewId : hydrated[0].id);
  }, []);

  // Seeds only the very first tab's account from the shared selector, once
  // it resolves (AccountProvider's own fetch may still be in flight when
  // this page first mounts) — a no-op if the restore effect above already
  // filled in a real accountId. Every other tab gets its account at
  // creation time, directly from the event handler that creates it.
  useEffect(() => {
    if (hasSeededInitialAccountRef.current || !selectedAccountId) return;
    hasSeededInitialAccountRef.current = true;
    // One-time seed of the first tab's account once the shared selector
    // resolves, not derived state.
    setViews((prev) => prev.map((v, i) => (i === 0 && !v.accountId ? { ...v, accountId: selectedAccountId } : v)));
  }, [selectedAccountId]);

  // Persists the open tabs' query specs (never their fetched results, which
  // are ephemeral and re-derived from the cache on restore) whenever they
  // change — a plain sync-to-external-system effect, not a state update.
  useEffect(() => {
    setExploreViews({
      activeViewId,
      views: views.map(({ result, resultFetchedAt, loading, error, ...spec }) => spec),
    });
  }, [views, activeViewId]);

  function updateView(id, patch) {
    setViews((prev) => prev.map((v) => (v.id === id ? { ...v, ...(typeof patch === "function" ? patch(v) : patch) } : v)));
  }

  function updateActive(patch) {
    updateView(activeViewId, patch);
  }

  function runQueryForView(view, force) {
    if (!isViewRunnable(view)) return;
    const spec = buildQuerySpecFromView(view);
    const cacheKey = EXPLORE_CACHE_PREFIX + JSON.stringify(spec);

    if (!force) {
      const cached = getCachedEntry(cacheKey);
      if (cached) {
        updateView(view.id, {
          result: cached.data,
          resultFetchedAt: cached.fetchedAt,
          error: null,
          chartMetricKey: firstChartableKey(cached.data.meta),
        });
        return;
      }
    }

    updateView(view.id, { loading: true, error: null });
    fetchExploreInsights(spec)
      .then((json) => {
        updateView(view.id, { result: json, resultFetchedAt: Date.now(), error: null, chartMetricKey: firstChartableKey(json.meta) });
        setCachedEntry(cacheKey, json, { prefix: EXPLORE_CACHE_PREFIX, maxEntriesForPrefix: EXPLORE_CACHE_MAX_ENTRIES });
      })
      .catch((err) => updateView(view.id, { error: err.message }))
      .finally(() => updateView(view.id, { loading: false }));
  }

  function createNewViewFromActive() {
    const newView = { ...activeView, id: newViewId(), result: null, resultFetchedAt: null, loading: false, error: null };
    setViews((prev) => [...withCapApplied(prev, activeViewId), newView]);
    setActiveViewId(newView.id);
    runQueryForView(newView, false);
  }

  function addBlankView() {
    const blank = createBlankView(selectedAccountId);
    setViews((prev) => [...withCapApplied(prev, activeViewId), blank]);
    setActiveViewId(blank.id);
  }

  function closeView(id) {
    if (views.length <= 1) return;
    const idx = views.findIndex((v) => v.id === id);
    if (idx === -1) return;
    const next = views.filter((v) => v.id !== id);
    setViews(next);
    if (id === activeViewId) setActiveViewId(next[Math.max(0, idx - 1)].id);
  }

  function toggleMetric(key) {
    updateActive((v) => ({
      metricKeys: v.metricKeys.includes(key) ? v.metricKeys.filter((k) => k !== key) : [...v.metricKeys, key],
    }));
  }

  const range = computeRange(activeView.rangePreset, activeView.customSince, activeView.customUntil);
  const rangeDays = range ? inclusiveDayCount(range.since, range.until) : null;
  const rangeValid = !!range && rangeDays > 0 && rangeDays <= MAX_RANGE_DAYS;
  const canRunQuery = !!activeView.accountId && rangeValid && activeView.metricKeys.length > 0;
  const compareDisabled = activeView.timeIncrement !== "";

  const customFields = useMemo(() => parseCustomFields(activeView.customFieldsText), [activeView.customFieldsText]);

  const result = activeView.result;
  const chartableMetricKeys = result ? result.meta.metricKeys.filter(isChartableMetric) : [];
  const isRerun = activeView.loading && !!result;

  return (
    <Layout>
      <Head>
        <title>Explore · Facebook Auth Dashboard</title>
      </Head>
      <div className={styles.page}>
        <main className={styles.main} style={{ maxWidth: 1200, margin: "0 auto" }}>
          <h1 className={styles.h1}>Explore</h1>
          <p className={styles.sub} style={{ marginTop: -8 }}>
            Build any view of Facebook Ads data — pick an account, a date range (up to 30 days), a level, a
            breakdown, and whatever metrics you want, then view it as a table or chart. Keep several views open at
            once, like browser tabs — each with its own account and query.
          </p>

          {accountsError && <div className={styles.error}>Error loading ad accounts: {accountsError}</div>}

          <div style={{ display: "flex", alignItems: "flex-end", gap: 6, flexWrap: "wrap" }}>
            {views.map((v, i) => {
              const isActive = v.id === activeViewId;
              return (
                <div
                  key={v.id}
                  onClick={() => setActiveViewId(v.id)}
                  title={viewTitle(v, adAccounts, i)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "8px 10px",
                    borderRadius: "10px 10px 0 0",
                    cursor: "pointer",
                    fontSize: 12.5,
                    fontWeight: 600,
                    maxWidth: 190,
                    background: isActive ? "var(--bg)" : "transparent",
                    border: "1px solid var(--border)",
                    borderBottom: isActive ? "2px solid var(--purple)" : "1px solid var(--border)",
                    color: isActive ? "var(--t1)" : "var(--t2)",
                  }}
                >
                  {v.loading && <span className={`${styles.spinner} ${styles.spinnerSm}`} />}
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {viewTitle(v, adAccounts, i)}
                  </span>
                  {views.length > 1 && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        closeView(v.id);
                      }}
                      title="Close this view"
                      style={{
                        background: "none",
                        border: "none",
                        padding: 0,
                        cursor: "pointer",
                        color: "inherit",
                        display: "flex",
                        flexShrink: 0,
                      }}
                    >
                      <CloseIcon size={11} />
                    </button>
                  )}
                </div>
              );
            })}
            <button
              type="button"
              onClick={addBlankView}
              title="New view"
              className={styles.btnSecondary}
              style={{ padding: "6px 12px", borderRadius: "10px 10px 0 0" }}
            >
              +
            </button>
          </div>

          <section className={styles.card} style={{ display: "flex", flexDirection: "column", gap: 20, marginTop: 0, borderTopLeftRadius: 0 }}>
            <div>
              <h2 className={styles.h2}>Account</h2>
              <AccountSelect
                accounts={adAccounts}
                value={activeView.accountId}
                onChange={(id) => updateActive({ accountId: id })}
                style={{ width: "100%", maxWidth: 420 }}
              />
            </div>

            <div>
              <h2 className={styles.h2}>Date range</h2>
              <div className={styles.tabGroup} style={{ marginBottom: 10 }}>
                {RANGE_PRESETS.map((p) => (
                  <button
                    key={p.key}
                    className={activeView.rangePreset === p.key ? `${styles.tab} ${styles.tabActive}` : styles.tab}
                    onClick={() => updateActive({ rangePreset: p.key })}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              {activeView.rangePreset === "custom" && (
                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <input
                    type="date"
                    className={styles.select}
                    value={activeView.customSince}
                    max={activeView.customUntil || isoDate(todayUTC())}
                    onChange={(e) => updateActive({ customSince: e.target.value })}
                  />
                  <span className={styles.muted}>to</span>
                  <input
                    type="date"
                    className={styles.select}
                    value={activeView.customUntil}
                    min={activeView.customSince || undefined}
                    max={
                      activeView.customSince
                        ? [addDaysUTC(activeView.customSince, MAX_RANGE_DAYS - 1), isoDate(todayUTC())].sort()[0]
                        : isoDate(todayUTC())
                    }
                    onChange={(e) => updateActive({ customUntil: e.target.value })}
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
                    className={activeView.level === l.value ? `${styles.tab} ${styles.tabActive}` : styles.tab}
                    onClick={() => updateActive({ level: l.value })}
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
                value={activeView.breakdownGroup}
                onChange={(e) => updateActive({ breakdownGroup: e.target.value })}
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
                    className={activeView.timeIncrement === o.value ? `${styles.tab} ${styles.tabActive}` : styles.tab}
                    onClick={() => updateActive({ timeIncrement: o.value })}
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
                        const selected = activeView.metricKeys.includes(m.key);
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
                  value={activeView.customFieldsText}
                  onChange={(e) => updateActive({ customFieldsText: e.target.value })}
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
                  className={!activeView.compareToPrevious ? `${styles.tab} ${styles.tabActive}` : styles.tab}
                  onClick={() => updateActive({ compareToPrevious: false })}
                >
                  Off
                </button>
                <button
                  className={activeView.compareToPrevious ? `${styles.tab} ${styles.tabActive}` : styles.tab}
                  onClick={() => updateActive({ compareToPrevious: true })}
                  disabled={compareDisabled}
                >
                  On
                </button>
              </div>
            </div>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button
                type="button"
                className={styles.btnPrimary}
                disabled={!canRunQuery || activeView.loading}
                onClick={() => runQueryForView(activeView, false)}
              >
                {activeView.loading ? "Updating…" : "Update This View"}
              </button>
              <button type="button" className={styles.btnSecondary} disabled={!canRunQuery} onClick={createNewViewFromActive}>
                + Create New View
              </button>
            </div>
          </section>

          {activeView.error && <div className={styles.error}>Error: {activeView.error}</div>}
          {activeView.loading && !result && <Loader label="Running your query…" />}

          {result && (
            <section className={styles.card} style={{ position: "relative", display: "flex", flexDirection: "column", gap: 16 }}>
              {isRerun && (
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    borderRadius: 14,
                    background: "rgba(10,9,20,.72)",
                    backdropFilter: "blur(2px)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    zIndex: 20,
                  }}
                >
                  <Loader label={describeQuery(activeView)} />
                </div>
              )}

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
                <CacheStatus label="Result" fetchedAt={activeView.resultFetchedAt} loading={false} onRefresh={() => runQueryForView(activeView, true)} />
                <div className={styles.tabGroup}>
                  <button
                    className={activeView.viewMode === "table" ? `${styles.tab} ${styles.tabActive}` : styles.tab}
                    onClick={() => updateActive({ viewMode: "table" })}
                  >
                    Table
                  </button>
                  <button
                    className={activeView.viewMode === "chart" ? `${styles.tab} ${styles.tabActive}` : styles.tab}
                    onClick={() => updateActive({ viewMode: "chart" })}
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

              {activeView.viewMode === "chart" && chartableMetricKeys.length > 0 && (
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span className={styles.muted}>Chart metric</span>
                  <select
                    className={styles.select}
                    value={activeView.chartMetricKey || ""}
                    onChange={(e) => updateActive({ chartMetricKey: e.target.value })}
                  >
                    {chartableMetricKeys.map((key) => (
                      <option key={key} value={key}>
                        {METRIC_CATALOG.find((m) => m.key === key)?.label || key}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {activeView.viewMode === "table" ? (
                <ExploreResultsTable result={result} currency={currency} />
              ) : activeView.chartMetricKey ? (
                <ExploreChart rows={result.rows} meta={result.meta} chartMetricKey={activeView.chartMetricKey} currency={currency} />
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

  // A level's own name (e.g. an ad) and a breakdown's value (e.g. "25-34,
  // male") are two different things about a row, not one — shown as
  // separate columns whenever both are present, rather than combined into a
  // single string where an ad's own name became indistinguishable from the
  // breakdown value sitting next to it.
  const hasDate = !!meta.timeIncrement;
  const hasEntity = meta.level !== "account";
  const hasBreakdown = meta.breakdownGroup !== "none";

  const leadingColumns = [];
  if (hasDate) {
    leadingColumns.push({ key: "date", label: "Date", maxWidth: 120 });
  }
  if (hasEntity) {
    leadingColumns.push({
      key: "entityLabel",
      label: LEVEL_OPTIONS.find((l) => l.value === meta.level)?.label || "Name",
      maxWidth: 240,
    });
  }
  if (hasBreakdown) {
    leadingColumns.push({
      key: "breakdownLabel",
      label: BREAKDOWN_GROUPS.find((g) => g.value === meta.breakdownGroup)?.label || "Breakdown",
      maxWidth: 200,
    });
  }
  if (leadingColumns.length === 0) {
    leadingColumns.push({ key: "label", label: "Total", maxWidth: 160 });
  }

  const columns = [
    ...leadingColumns,
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
        searchKeys={leadingColumns.map((c) => c.key)}
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
