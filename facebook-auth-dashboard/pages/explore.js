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
import { getExploreViews, setExploreViews, getCustomMetrics, setCustomMetrics } from "@/lib/clientStorage";
import {
  LEVEL_OPTIONS,
  BREAKDOWN_GROUPS,
  METRIC_CATALOG,
  formatMetricValue,
  buildEffectiveCatalog,
} from "@/lib/insightsMetrics";
import styles from "@/styles/Home.module.css";

// Recharts measures its container via ResizeObserver, so it can't be
// server-rendered — loaded only on this route, only on the client.
const ExploreChart = dynamic(() => import("@/components/ExploreChart"), { ssr: false });

const MAX_RANGE_DAYS = 90;
const EXPLORE_CACHE_PREFIX = "explore:";
const EXPLORE_CACHE_MAX_ENTRIES = 50;
const MAX_VIEWS = 15;

const RANGE_PRESETS = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "last_7d", label: "Last 7 Days" },
  { key: "last_14d", label: "Last 14 Days" },
  { key: "last_30d", label: "Last 30 Days" },
  { key: "last_90d", label: "Last 90 Days" },
  { key: "custom", label: "Custom" },
];

const TIME_GROUPING_OPTIONS = [
  { value: "", label: "No grouping (totals)" },
  { value: "1", label: "Daily" },
  { value: "7", label: "Weekly" },
];

function newViewId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `v${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

// Prefixed distinctly from newViewId() so a custom metric's id can never be
// mistaken for (or collide with) a view id or a built-in catalog key.
function newCustomMetricId() {
  return `cm_${newViewId()}`;
}

// Only these formats are plottable as a numeric axis — mirrors
// lib/insightsMetrics.js's own CHARTABLE_FORMATS, kept local here since this
// needs to check against `effectiveCatalog` (built-ins + this user's custom
// metrics), not just the built-in catalog the exported isChartableMetric()
// is scoped to.
const CHARTABLE_FORMATS = new Set(["number", "currency", "percent", "decimal"]);

// A currency-format metric can't be honestly charted on one shared axis once
// more than one (possibly differently-currencied) account is selected — it
// stays table-only (where each row already renders in its own account's
// currency) rather than silently picking one account's currency for the
// whole chart. `accountCount` is the number of accounts in the *result*
// being charted, not necessarily the view's current selection.
function isChartableForView(key, catalog, accountCount) {
  const metric = catalog.find((m) => m.key === key);
  if (!metric || !CHARTABLE_FORMATS.has(metric.format)) return false;
  if (metric.format === "currency" && accountCount > 1) return false;
  return true;
}

const MAX_ACCOUNTS_PER_VIEW = 10;

// "Exclude rows by name" is intentionally independent of the selected Level
// — filtering by Campaign name while viewing Account-level totals is exactly
// the point (exclude that campaign's numbers from the total, not just hide a
// row), so every field is always offered regardless of `view.level`. The
// backend (pages/api/fb/explore-insights.js) fetches at whatever level is
// actually needed to see the filtered-on name and re-aggregates back up to
// the requested level; `rank` mirrors its LEVEL_RANK so the client can tell
// *before* running the query whether that re-aggregation ("rollup") will
// happen for the current level + filters, to explain why Reach-derived
// metrics disappear when it does (see REACH_DEPENDENT_METRIC_KEYS below).
const NAME_FILTER_FIELDS = [
  { field: "campaignName", label: "Campaign name", level: "campaign", rank: 1 },
  { field: "adsetName", label: "Ad set name", level: "adset", rank: 2 },
  { field: "adName", label: "Ad name", level: "ad", rank: 3 },
];
const LEVEL_RANK = { account: 0, campaign: 1, adset: 2, ad: 3 };

// Mirrors the backend's own REACH_DEPENDENT_KEYS exactly (same reasoning:
// Facebook's own deduplicated Reach/Unique Clicks counts — and everything
// derived from them — can't be correctly reconstructed once rows from
// several campaigns/ad sets/ads are summed together into one rolled-up
// total). Used here only to explain *why* a metric disappeared from a
// result, never to decide what the backend actually computes.
const REACH_DEPENDENT_METRIC_KEYS = new Set(["reach", "frequency", "cpp", "unique_clicks", "unique_ctr"]);

// Whether the current level + active filters combination would force the
// backend to fetch at a finer level and roll the result back up — i.e.
// whether at least one filter targets an entity finer than `level` itself.
// Purely informational on the client (the backend makes the authoritative
// decision from the same data); used to show a heads-up before running the
// query rather than only after.
function wouldNeedRollup(level, activeFilters) {
  return activeFilters.some((f) => {
    const def = NAME_FILTER_FIELDS.find((d) => d.field === f.field);
    return def && def.rank > LEVEL_RANK[level];
  });
}

// One independent tab: its own account(s), its own query spec, its own
// fetched result/loading/error and view-mode — switching tabs never touches
// another tab's state. `accountIds` is always an array (even length-1) —
// a single uniform field rather than a separate "one account" vs "several
// accounts" shape to keep in sync.
function createBlankView(seedAccountId = "") {
  return {
    id: newViewId(),
    // A user-chosen tab name, overriding the auto-derived account/level
    // title below — null until they rename it (double-click the tab).
    customTitle: null,
    accountIds: seedAccountId ? [seedAccountId] : [],
    rangePreset: "last_30d",
    customSince: "",
    customUntil: "",
    level: "account",
    breakdownGroup: "none",
    timeIncrement: "",
    metricKeys: ["spend", "impressions", "clicks", "ctr"],
    customFieldsText: "",
    compareToPrevious: false,
    // Null (not an empty string) means "no custom comparison start date" —
    // compareToPrevious then defaults to the immediately-preceding period of
    // equal length, computed server-side. Set to a YYYY-MM-DD string once the
    // user picks "Custom start date" below; the comparison period's end date
    // is always derived from it (same length as the primary range), never
    // picked independently.
    compareCustomSince: "",
    // Exclude any row whose campaign/ad set/ad name contains one of these
    // (case-insensitive) — sent to the backend as part of the query spec
    // (see buildQuerySpecFromView), since excluding, say, a campaign while
    // viewing Account-level totals means the backend has to re-fetch at
    // Campaign level and re-sum what's left, not just hide an already-fetched
    // row. Takes effect next time the query runs, same as every other field
    // on this view (Level, Breakdown, Metrics, …) — not applied instantly.
    nameFilters: [],
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
    case "last_90d":
      return { since: addDaysUTC(isoDate(today), -89), until: isoDate(today) };
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

// A custom comparison period is always the same length as the primary range
// — only its *start* is the user's choice, mirroring the backend's own
// enforcement of this in pages/api/fb/explore-insights.js. Returns null
// whenever there's no (valid) custom start date to compute from, so callers
// can fall back to the default immediately-preceding-period behavior.
function customPreviousRangeFor(view, rangeDays) {
  if (!view.compareToPrevious || view.timeIncrement || !view.compareCustomSince || !rangeDays) return null;
  return { since: view.compareCustomSince, until: addDaysUTC(view.compareCustomSince, rangeDays - 1) };
}

// Pure: a view's current form fields -> the POST body /api/fb/explore-insights
// expects. No `force` baked in — that's passed separately to runQueryForView.
// `customMetrics` (this user's full saved list) is filtered down to just the
// definitions actually selected in `view.metricKeys` — the backend has no
// localStorage access, so a selected custom metric's full definition (not
// just its id) has to travel in the request. `nameFilters` IS part of the
// query spec (and so the cache key) — excluding, say, a campaign while
// viewing Account totals changes what the backend actually fetches and sums
// (see pages/api/fb/explore-insights.js), not just what's displayed from an
// already-fetched result.
function buildQuerySpecFromView(view, customMetrics) {
  const range = computeRange(view.rangePreset, view.customSince, view.customUntil);
  const rangeDays = range ? inclusiveDayCount(range.since, range.until) : null;
  const customPrevious = customPreviousRangeFor(view, rangeDays);
  return {
    // Sorted so picking the same accounts in a different order (the
    // multi-select doesn't guarantee pick order survives) still produces the
    // same cache key / request body.
    accountIds: [...view.accountIds].sort(),
    level: view.level,
    breakdownGroup: view.breakdownGroup,
    metricKeys: view.metricKeys,
    customFields: parseCustomFields(view.customFieldsText),
    customMetrics: (customMetrics || [])
      .filter((cm) => view.metricKeys.includes(cm.id))
      .map((cm) => ({ id: cm.id, numeratorKey: cm.numeratorKey, denominatorKey: cm.denominatorKey })),
    // Only filters with real text to match on travel in the request — an
    // in-progress, not-yet-"+ Exclude"d entry never reaches `nameFilters` in
    // the first place (see addNameFilter below), but this stays defensive
    // against any other path that might someday add one with a blank value.
    nameFilters: (view.nameFilters || []).filter((f) => f.value.trim()).map((f) => ({ field: f.field, value: f.value.trim() })),
    since: range?.since,
    until: range?.until,
    timeIncrement: view.timeIncrement || null,
    compareToPrevious: view.timeIncrement ? false : view.compareToPrevious,
    // Omitted (not `null`) when there's no custom start date, so
    // JSON.stringify drops the keys entirely — a view that's never touched
    // this feature produces the exact same cache key / request body as
    // before it existed, and the backend falls back to its own default
    // immediately-preceding-period computation.
    previousSince: customPrevious?.since,
    previousUntil: customPrevious?.until,
  };
}

function isViewRunnable(view, catalog) {
  const range = computeRange(view.rangePreset, view.customSince, view.customUntil);
  const rangeDays = range ? inclusiveDayCount(range.since, range.until) : null;
  const rangeValid = !!range && rangeDays > 0 && rangeDays <= MAX_RANGE_DAYS;
  const metricsResolve = view.metricKeys.length > 0 && view.metricKeys.every((k) => catalog.some((m) => m.key === k));
  const customPrevious = customPreviousRangeFor(view, rangeDays);
  const customPreviousValid = !customPrevious || customPrevious.until <= isoDate(todayUTC());
  return view.accountIds.length > 0 && rangeValid && metricsResolve && customPreviousValid;
}

function firstChartableKey(metricKeys, catalog, accountCount) {
  return metricKeys.find((k) => isChartableForView(k, catalog, accountCount)) || null;
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
  // A user-set name wins outright — no auto-appended level suffix either,
  // so renaming a tab gives full control over what it says, not just a
  // prefix in front of what this function would otherwise have produced.
  if (view.customTitle) return view.customTitle;
  const names = view.accountIds.map((id) => adAccounts.find((a) => a.id === id)?.name).filter(Boolean);
  const base =
    names.length === 0
      ? `View ${fallbackIndex + 1}`
      : names.length === 1
        ? names[0]
        : `${names[0]} +${names.length - 1} more`;
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

  // Which tab (if any) is currently showing its rename text input in place
  // of its label — at most one at a time, cleared on commit/cancel/blur.
  const [renamingViewId, setRenamingViewId] = useState(null);
  const [renameDraft, setRenameDraft] = useState("");

  function startRenaming(view, fallbackIndex) {
    setRenamingViewId(view.id);
    setRenameDraft(view.customTitle || viewTitle(view, adAccounts, fallbackIndex));
  }

  function commitRename() {
    if (renamingViewId) updateView(renamingViewId, { customTitle: renameDraft.trim() || null });
    setRenamingViewId(null);
  }

  function cancelRename() {
    setRenamingViewId(null);
  }

  // Per-account currency lookup — the table formats each row in its OWN
  // account's currency (a row's `accountId` is always present, single- or
  // multi-account alike), rather than one view-level currency that would be
  // wrong for every account but the first once more than one is selected.
  const currencyByAccountId = useMemo(() => new Map(adAccounts.map((a) => [a.id, a.currency])), [adAccounts]);
  // The chart, by contrast, keeps a single shared axis — only meaningful for
  // exactly one account's currency, and only ever actually used when a
  // currency-format metric is charted, which isChartableForView already
  // restricts to the single-account case.
  const chartCurrency =
    activeView.accountIds.length === 1 ? currencyByAccountId.get(activeView.accountIds[0]) : undefined;

  // User-defined ratio metrics (numerator ÷ denominator, both built-in
  // catalog keys), shared across every open view — not per-view state, since
  // these are "what this user has defined" rather than part of any one
  // query. `effectiveCatalog` merges them into the built-in catalog so the
  // metric-picker pills, the chart-metric dropdown, and the results table's
  // column lookup all work against custom metrics with no further changes.
  const [customMetrics, setCustomMetricsState] = useState(() => getCustomMetrics());
  const effectiveCatalog = useMemo(() => buildEffectiveCatalog(customMetrics), [customMetrics]);
  const metricGroups = useMemo(() => [...new Set(effectiveCatalog.map((m) => m.group))], [effectiveCatalog]);

  // Custom-metric creation form fields — restricted to METRIC_CATALOG (the
  // built-in catalog only, never effectiveCatalog) so a custom metric can
  // never reference another custom metric. No principled resolution order
  // exists for that without cycle detection, which this deliberately-simple
  // ratio-only feature doesn't need; the server independently rejects it too.
  const [customMetricLabel, setCustomMetricLabel] = useState("");
  const [customMetricNumerator, setCustomMetricNumerator] = useState("");
  const [customMetricDenominator, setCustomMetricDenominator] = useState("");

  function saveCustomMetric(def) {
    const next = [...customMetrics, def];
    setCustomMetricsState(next);
    setCustomMetrics(next);
  }

  function createCustomMetric() {
    if (!customMetricLabel.trim() || !customMetricNumerator || !customMetricDenominator) return;
    saveCustomMetric({
      id: newCustomMetricId(),
      label: customMetricLabel.trim(),
      numeratorKey: customMetricNumerator,
      denominatorKey: customMetricDenominator,
      format: "decimal",
    });
    setCustomMetricLabel("");
    setCustomMetricNumerator("");
    setCustomMetricDenominator("");
  }

  // "Exclude rows by name" creation form — always offers all three fields
  // regardless of the active view's level (see NAME_FILTER_FIELDS above).
  const [newFilterField, setNewFilterField] = useState("campaignName");
  const [newFilterValue, setNewFilterValue] = useState("");

  function deleteCustomMetric(id) {
    const next = customMetrics.filter((cm) => cm.id !== id);
    setCustomMetricsState(next);
    setCustomMetrics(next);
    // Sweep the deleted metric out of every open view so a restored view
    // never keeps a dangling reference to a metric that no longer exists.
    setViews((prev) =>
      prev.map((v) => ({
        ...v,
        metricKeys: v.metricKeys.filter((k) => k !== id),
        chartMetricKey: v.chartMetricKey === id ? null : v.chartMetricKey,
      }))
    );
  }

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

    // Read directly rather than closing over the `customMetrics` state (both
    // resolve to the same value at mount, since that state's own initializer
    // is this same getCustomMetrics() call) — keeps this effect's dependency
    // list honestly empty for what's a genuine one-time restore.
    const customMetricsAtMount = getCustomMetrics();
    const hydrated = persisted.views.map((v) => {
      // Migrate a view persisted before multi-account support (single
      // `accountId`) to the current `accountIds` array shape, before
      // anything below reads it. Same reasoning for `nameFilters`/
      // `compareCustomSince` — a view saved before those fields existed has
      // neither, and several render paths below call `.length`/`.filter` on
      // `nameFilters` with no further fallback, so this is where it has to
      // be backfilled, not just wherever it's read.
      const accountIds = v.accountIds ?? (v.accountId ? [v.accountId] : []);
      const migrated = { ...v, accountIds, nameFilters: v.nameFilters || [], compareCustomSince: v.compareCustomSince || "" };
      delete migrated.accountId;
      const cached =
        accountIds.length > 0 && v.metricKeys?.length > 0
          ? getCachedEntry(EXPLORE_CACHE_PREFIX + JSON.stringify(buildQuerySpecFromView(migrated, customMetricsAtMount)))
          : null;
      return {
        ...migrated,
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
    setViews((prev) => prev.map((v, i) => (i === 0 && v.accountIds.length === 0 ? { ...v, accountIds: [selectedAccountId] } : v)));
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
    if (!isViewRunnable(view, effectiveCatalog)) return;
    const spec = buildQuerySpecFromView(view, customMetrics);
    const cacheKey = EXPLORE_CACHE_PREFIX + JSON.stringify(spec);

    if (!force) {
      const cached = getCachedEntry(cacheKey);
      if (cached) {
        updateView(view.id, {
          result: cached.data,
          resultFetchedAt: cached.fetchedAt,
          error: null,
          chartMetricKey: firstChartableKey(cached.data.meta.metricKeys, effectiveCatalog, cached.data.meta.accountIds.length),
        });
        return;
      }
    }

    updateView(view.id, { loading: true, error: null });
    fetchExploreInsights(spec)
      .then((json) => {
        updateView(view.id, {
          result: json,
          resultFetchedAt: Date.now(),
          error: null,
          chartMetricKey: firstChartableKey(json.meta.metricKeys, effectiveCatalog, json.meta.accountIds.length),
        });
        setCachedEntry(cacheKey, json, { prefix: EXPLORE_CACHE_PREFIX, maxEntriesForPrefix: EXPLORE_CACHE_MAX_ENTRIES });
      })
      .catch((err) => updateView(view.id, { error: err.message }))
      .finally(() => updateView(view.id, { loading: false }));
  }

  function createNewViewFromActive() {
    // customTitle resets — a duplicated tab showing the active tab's own
    // custom name would read as two tabs with the same, now-ambiguous label;
    // it falls back to the usual auto-derived account/level title instead.
    const newView = {
      ...activeView,
      id: newViewId(),
      customTitle: null,
      result: null,
      resultFetchedAt: null,
      loading: false,
      error: null,
    };
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
  const metricsResolve =
    activeView.metricKeys.length > 0 && activeView.metricKeys.every((k) => effectiveCatalog.some((m) => m.key === k));
  const compareDisabled = activeView.timeIncrement !== "";
  const customPrevious = customPreviousRangeFor(activeView, rangeDays);
  const customPreviousValid = !customPrevious || customPrevious.until <= isoDate(todayUTC());
  const canRunQuery = activeView.accountIds.length > 0 && rangeValid && metricsResolve && customPreviousValid;

  const customFields = useMemo(() => parseCustomFields(activeView.customFieldsText), [activeView.customFieldsText]);

  // Whether running this exact view, as currently configured, would make the
  // backend fetch at a finer level than `activeView.level` and roll the
  // result back up — shown as a heads-up before running the query, and used
  // to explain why Reach-derived metrics won't be in the result.
  const activeNameFilters = useMemo(() => (activeView.nameFilters || []).filter((f) => f.value.trim()), [activeView.nameFilters]);
  const willRollup = wouldNeedRollup(activeView.level, activeNameFilters);

  function addNameFilter() {
    const value = newFilterValue.trim();
    if (!value) return;
    updateActive((v) => ({ nameFilters: [...(v.nameFilters || []), { id: newViewId(), field: newFilterField, value }] }));
    setNewFilterValue("");
  }

  function removeNameFilter(id) {
    updateActive((v) => ({ nameFilters: (v.nameFilters || []).filter((f) => f.id !== id) }));
  }

  const result = activeView.result;
  const chartableMetricKeys = result
    ? result.meta.metricKeys.filter((k) => isChartableForView(k, effectiveCatalog, result.meta.accountIds.length))
    : [];
  const isRerun = activeView.loading && !!result;

  // Prefixes each row's `label` with its account's name whenever more than
  // one account is selected, so ExploreChart's pivot-by-label logic
  // naturally separates accounts into distinct lines/bars/series — purely a
  // render-time view of the data, never mutating `result.rows` itself (the
  // same row objects may be sitting in lib/clientCache.js's stored entry).
  // Excluded-by-name rows are already absent from `result.rows` itself (the
  // backend applies — and, where necessary, re-aggregates around — every
  // active name filter before ever returning a result), so there's no
  // separate client-side filtering step here any more.
  const chartRows = useMemo(() => {
    if (!result) return [];
    if (result.meta.accountIds.length <= 1) return result.rows;
    return result.rows.map((r) => ({
      ...r,
      label: `${adAccounts.find((a) => a.id === r.accountId)?.name || r.accountId} — ${r.label}`,
    }));
  }, [result, adAccounts]);

  function handleExportCsv() {
    if (!result) return;
    const csv = toCsvString(buildCsvTable(result.rows, result.meta, adAccounts, currencyByAccountId, effectiveCatalog));
    const viewIndex = views.findIndex((v) => v.id === activeView.id);
    const slug = viewTitle(activeView, adAccounts, viewIndex === -1 ? 0 : viewIndex)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    downloadCsv(`explore-${slug || "report"}-${result.meta.since}-to-${result.meta.until}.csv`, csv);
  }

  return (
    <Layout>
      <Head>
        <title>Explore · Facebook Auth Dashboard</title>
      </Head>
      <div className={styles.page}>
        <main className={styles.main} style={{ maxWidth: 1200, margin: "0 auto" }}>
          <h1 className={styles.h1}>Explore</h1>
          <p className={styles.sub} style={{ marginTop: -8 }}>
            Build any view of Facebook Ads data — pick an account, a date range (up to 90 days), a level, a
            breakdown, and whatever metrics you want, then view it as a table or chart. Keep several views open at
            once, like browser tabs — each with its own account and query.
          </p>

          {accountsError && <div className={styles.error}>Error loading ad accounts: {accountsError}</div>}

          <div
            style={{
              display: "flex",
              alignItems: "flex-end",
              gap: 6,
              flexWrap: "wrap",
              position: "sticky",
              top: 0,
              zIndex: 5,
              background: "var(--bg)",
              paddingTop: 8,
              paddingBottom: 2,
            }}
          >
            {views.map((v, i) => {
              const isActive = v.id === activeViewId;
              const isRenaming = renamingViewId === v.id;
              return (
                <div
                  key={v.id}
                  onClick={() => setActiveViewId(v.id)}
                  title={isRenaming ? undefined : `${viewTitle(v, adAccounts, i)} — double-click to rename`}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "8px 10px",
                    borderRadius: "10px 10px 0 0",
                    cursor: "pointer",
                    fontSize: 12.5,
                    fontWeight: 600,
                    maxWidth: isRenaming ? 220 : 190,
                    background: isActive ? "var(--bg)" : "transparent",
                    border: "1px solid var(--border)",
                    borderBottom: isActive ? "2px solid var(--purple)" : "1px solid var(--border)",
                    color: isActive ? "var(--t1)" : "var(--t2)",
                  }}
                >
                  {v.loading && <span className={`${styles.spinner} ${styles.spinnerSm}`} />}
                  {isRenaming ? (
                    <input
                      type="text"
                      autoFocus
                      className={styles.select}
                      value={renameDraft}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setRenameDraft(e.target.value)}
                      onBlur={commitRename}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitRename();
                        if (e.key === "Escape") cancelRename();
                      }}
                      style={{ width: 140, fontSize: 12.5, padding: "2px 6px" }}
                    />
                  ) : (
                    <span
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        startRenaming(v, i);
                      }}
                      style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                    >
                      {viewTitle(v, adAccounts, i)}
                    </span>
                  )}
                  {views.length > 1 && !isRenaming && (
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
              <p className={styles.sub} style={{ marginBottom: 10 }}>
                Pick one or more accounts — results from all of them come back merged into this one view, tagged
                with which account each row came from (up to {MAX_ACCOUNTS_PER_VIEW} at a time).
              </p>
              <AccountSelect
                multiple
                accounts={adAccounts}
                values={activeView.accountIds}
                onChange={(ids) => updateActive({ accountIds: ids })}
                maxSelected={MAX_ACCOUNTS_PER_VIEW}
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
              <h2 className={styles.h2}>Exclude rows by name</h2>
              <p className={styles.sub} style={{ marginBottom: 10 }}>
                Exclude any campaign, ad set, or ad whose name contains the text below — works at any Level above,
                not just the matching one: e.g. exclude a campaign by name while still viewing Account-level totals,
                and that campaign&apos;s numbers come out of the total, not just off the screen. Add as many as you
                like; takes effect next time you run the query.
              </p>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <select className={styles.select} value={newFilterField} onChange={(e) => setNewFilterField(e.target.value)}>
                  {NAME_FILTER_FIELDS.map((f) => (
                    <option key={f.field} value={f.field}>
                      {f.label}
                    </option>
                  ))}
                </select>
                <span className={styles.muted}>contains</span>
                <input
                  type="text"
                  className={styles.select}
                  placeholder="e.g. ABCD"
                  value={newFilterValue}
                  onChange={(e) => setNewFilterValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") addNameFilter();
                  }}
                  style={{ width: 200 }}
                />
                <button type="button" className={styles.btnSecondary} disabled={!newFilterValue.trim()} onClick={addNameFilter}>
                  + Exclude
                </button>
              </div>
              {(activeView.nameFilters || []).length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
                  {activeView.nameFilters.map((f) => (
                    <span key={f.id} className={styles.pill} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      {NAME_FILTER_FIELDS.find((o) => o.field === f.field)?.label || f.field}: &quot;{f.value}&quot;
                      <button
                        type="button"
                        onClick={() => removeNameFilter(f.id)}
                        title="Remove filter"
                        style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "inherit", display: "flex" }}
                      >
                        <CloseIcon size={10} />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              {willRollup && (
                <p className={styles.sub} style={{ marginTop: 8 }}>
                  A filter above needs finer-grained data than {LEVEL_OPTIONS.find((l) => l.value === activeView.level)?.label}{" "}
                  level shows — results will be fetched at the finer level and combined back up, excluding the
                  matching entities entirely. Reach, Frequency, CPP, and Unique CTR won&apos;t be available in this
                  result: Facebook&apos;s reach/unique-click counts can&apos;t be correctly combined across entities.
                </p>
              )}
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
                {metricGroups.map((group) => (
                  <div key={group}>
                    <p className={styles.muted} style={{ marginBottom: 6 }}>
                      {group}
                    </p>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {effectiveCatalog.filter((m) => m.group === group).map((m) => {
                        const selected = activeView.metricKeys.includes(m.key);
                        // Still toggleable (so an already-selected one can be
                        // turned off), but visually flagged — it'll be
                        // silently absent from the result anyway once a
                        // filter forces a rollup, see the note below.
                        const unavailable = willRollup && REACH_DEPENDENT_METRIC_KEYS.has(m.key);
                        return (
                          <button
                            key={m.key}
                            type="button"
                            onClick={() => toggleMetric(m.key)}
                            title={unavailable ? "Not available while a name filter requires combining finer-grained data" : undefined}
                            className={selected ? styles.badgeInfo : styles.pill}
                            style={
                              selected
                                ? { cursor: "pointer", opacity: unavailable ? 0.5 : 1 }
                                : {
                                    cursor: "pointer",
                                    background: "transparent",
                                    border: "1px dashed var(--border)",
                                    color: "var(--t2)",
                                    opacity: unavailable ? 0.5 : 1,
                                  }
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

              <div style={{ marginTop: 14 }}>
                <p className={styles.sub} style={{ marginBottom: 6 }}>
                  Define your own ratio metric (e.g. Revenue ÷ Purchases) from any two metrics above — it&apos;s saved
                  on this device and shows up as a pill in every view, under &quot;Custom&quot;.
                </p>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <select
                    className={styles.select}
                    value={customMetricNumerator}
                    onChange={(e) => setCustomMetricNumerator(e.target.value)}
                  >
                    <option value="">Numerator…</option>
                    {METRIC_CATALOG.map((m) => (
                      <option key={m.key} value={m.key}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                  <span className={styles.muted}>÷</span>
                  <select
                    className={styles.select}
                    value={customMetricDenominator}
                    onChange={(e) => setCustomMetricDenominator(e.target.value)}
                  >
                    <option value="">Denominator…</option>
                    {METRIC_CATALOG.map((m) => (
                      <option key={m.key} value={m.key}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    className={styles.select}
                    placeholder="Label, e.g. AOV"
                    value={customMetricLabel}
                    onChange={(e) => setCustomMetricLabel(e.target.value)}
                    style={{ width: 160 }}
                  />
                  <button
                    type="button"
                    className={styles.btnSecondary}
                    disabled={!customMetricLabel.trim() || !customMetricNumerator || !customMetricDenominator}
                    onClick={createCustomMetric}
                  >
                    Save Custom Metric
                  </button>
                </div>
                {customMetrics.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
                    {customMetrics.map((cm) => (
                      <span key={cm.id} className={styles.pill} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        {cm.label}
                        <button
                          type="button"
                          onClick={() => deleteCustomMetric(cm.id)}
                          title={`Delete ${cm.label}`}
                          style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "inherit", display: "flex" }}
                        >
                          <CloseIcon size={10} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div>
              <h2 className={styles.h2}>Compare to previous period</h2>
              <p className={styles.sub} style={{ marginBottom: 10 }}>
                By default, shows each row&apos;s change against the immediately preceding period of equal length —
                a 7-day range compares week-over-week. Pick any other starting date below instead; the comparison
                period is always the same length as the one you selected above, only its start date is your choice.
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
              {activeView.compareToPrevious && !compareDisabled && (
                <div style={{ marginTop: 10 }}>
                  <div className={styles.tabGroup} style={{ marginBottom: 10 }}>
                    <button
                      className={!activeView.compareCustomSince ? `${styles.tab} ${styles.tabActive}` : styles.tab}
                      onClick={() => updateActive({ compareCustomSince: "" })}
                    >
                      Immediately preceding (default)
                    </button>
                    <button
                      className={activeView.compareCustomSince ? `${styles.tab} ${styles.tabActive}` : styles.tab}
                      onClick={() =>
                        updateActive((v) => ({
                          compareCustomSince: v.compareCustomSince || (range && rangeDays ? addDaysUTC(range.since, -rangeDays) : ""),
                        }))
                      }
                    >
                      Custom start date
                    </button>
                  </div>
                  {activeView.compareCustomSince && (
                    <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                      <input
                        type="date"
                        className={styles.select}
                        value={activeView.compareCustomSince}
                        max={isoDate(todayUTC())}
                        onChange={(e) => updateActive({ compareCustomSince: e.target.value })}
                      />
                      {rangeDays && (
                        <span className={styles.muted}>
                          → {addDaysUTC(activeView.compareCustomSince, rangeDays - 1)} ({rangeDays} day
                          {rangeDays === 1 ? "" : "s"}, matching the selected period)
                        </span>
                      )}
                    </div>
                  )}
                  {customPrevious && !customPreviousValid && (
                    <p className={styles.sub} style={{ color: "#ff7070", marginTop: 8 }}>
                      Comparison period can&apos;t extend into the future.
                    </p>
                  )}
                </div>
              )}
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
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <button type="button" className={styles.btnSecondary} onClick={handleExportCsv}>
                    Export CSV
                  </button>
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
              </div>

              {result.meta.accountErrors?.length > 0 && (
                <div className={styles.error}>
                  {/* An account here may have zero rows (its only/every request failed) or still have partial
                      data (one of several chunked date-range requests failed, the rest succeeded) — this note
                      doesn't distinguish the two, just flags that something didn't come back clean. */}
                  Some data may be missing or incomplete —{" "}
                  {result.meta.accountErrors
                    .map((e) => `${adAccounts.find((a) => a.id === e.accountId)?.name || e.accountId} (${e.message})`)
                    .join(", ")}
                  .
                </div>
              )}

              <p className={styles.sub}>
                {result.meta.since} → {result.meta.until}
                {result.meta.compareToPrevious && ` · vs. ${result.meta.previousSince} → ${result.meta.previousUntil}`}
                {" · "}
                {result.meta.rowCount} row{result.meta.rowCount === 1 ? "" : "s"}
                {result.meta.excludedByNameCount > 0 &&
                  ` · ${result.meta.excludedByNameCount} excluded by name filter`}
              </p>
              {result.meta.excludedMetrics?.length > 0 && (
                <p className={styles.sub}>
                  {result.meta.excludedMetrics.map((k) => effectiveCatalog.find((m) => m.key === k)?.label || k).join(", ")} not
                  shown — a name filter required combining finer-grained data, and those can&apos;t be correctly
                  combined across entities.
                </p>
              )}

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
                        {effectiveCatalog.find((m) => m.key === key)?.label || key}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {activeView.viewMode === "table" ? (
                <ExploreResultsTable
                  rows={result.rows}
                  meta={result.meta}
                  adAccounts={adAccounts}
                  currencyByAccountId={currencyByAccountId}
                  effectiveCatalog={effectiveCatalog}
                />
              ) : activeView.chartMetricKey ? (
                <ExploreChart
                  rows={chartRows}
                  meta={result.meta}
                  chartMetricKey={activeView.chartMetricKey}
                  currency={chartCurrency}
                  effectiveCatalog={effectiveCatalog}
                />
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

// The leading, non-metric columns a result can have — shared between the
// on-screen table (which wants per-column render/sortValue/maxWidth) and the
// CSV export (which just wants `{key, label}` to read `row[key]` through). A
// level's own name (e.g. an ad) and a breakdown's value (e.g. "25-34, male")
// are two different things about a row, not one — kept as separate columns
// whenever both are present, rather than combined into a single string where
// an ad's own name became indistinguishable from the breakdown value sitting
// next to it.
function leadingColumnDefs(meta) {
  const defs = [];
  if (meta.accountIds.length > 1) defs.push({ key: "accountId", label: "Account" });
  if (meta.timeIncrement) defs.push({ key: "date", label: "Date" });
  if (meta.level !== "account") {
    defs.push({ key: "entityLabel", label: LEVEL_OPTIONS.find((l) => l.value === meta.level)?.label || "Name" });
  }
  if (meta.breakdownGroup !== "none") {
    defs.push({ key: "breakdownLabel", label: BREAKDOWN_GROUPS.find((g) => g.value === meta.breakdownGroup)?.label || "Breakdown" });
  }
  if (defs.length === 0) defs.push({ key: "label", label: "Total" });
  return defs;
}

function ExploreResultsTable({ rows, meta, adAccounts, currencyByAccountId, effectiveCatalog }) {
  const allKeys = [...meta.metricKeys, ...meta.customFields];

  const accountName = (row) => adAccounts.find((a) => a.id === row.accountId)?.name || row.accountId;
  const LEADING_MAX_WIDTH = { accountId: 200, date: 120, entityLabel: 240, breakdownLabel: 200, label: 160 };
  const leadingColumns = leadingColumnDefs(meta).map((def) =>
    def.key === "accountId"
      ? { ...def, maxWidth: LEADING_MAX_WIDTH.accountId, render: accountName, sortValue: accountName }
      : { ...def, maxWidth: LEADING_MAX_WIDTH[def.key] }
  );

  const columns = [
    ...leadingColumns,
    ...allKeys.map((key) => {
      const metric = effectiveCatalog.find((m) => m.key === key);
      const format = metric?.format || "number";
      const label = metric?.label || key;
      const comparable = meta.compareToPrevious && format !== "text";
      return {
        key,
        label,
        align: "right",
        sortValue: (row) => (typeof row[key] === "number" ? row[key] : -Infinity),
        render: (row) => {
          const value = formatMetricValue(row[key], format, currencyByAccountId.get(row.accountId));
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

// Plain-text mirror of ExploreResultsTable's column logic (sharing
// leadingColumnDefs for the leading columns) — a CSV cell is a formatted
// string, not a React node, so this can't reuse that component's `render`
// functions directly (they return <DeltaBadge>, not text). Rows passed in
// are expected to already be filtered/sorted exactly as the user sees them —
// this doesn't re-derive either.
function buildCsvTable(rows, meta, adAccounts, currencyByAccountId, effectiveCatalog) {
  const leading = leadingColumnDefs(meta);
  const metricKeysAndFields = [...meta.metricKeys, ...meta.customFields];

  const header = [...leading.map((c) => c.label)];
  for (const key of metricKeysAndFields) {
    const metric = effectiveCatalog.find((m) => m.key === key);
    header.push(metric?.label || key);
    if (meta.compareToPrevious) header.push(`${metric?.label || key} Δ%`);
  }

  const lines = [header];
  for (const row of rows) {
    const line = leading.map((c) =>
      c.key === "accountId" ? adAccounts.find((a) => a.id === row.accountId)?.name || row.accountId : row[c.key] ?? ""
    );
    for (const key of metricKeysAndFields) {
      const metric = effectiveCatalog.find((m) => m.key === key);
      const format = metric?.format || "number";
      line.push(formatMetricValue(row[key], format, currencyByAccountId.get(row.accountId)));
      if (meta.compareToPrevious) {
        const delta = row._deltaPct?.[key];
        line.push(typeof delta === "number" ? `${delta.toFixed(1)}%` : "");
      }
    }
    lines.push(line);
  }
  return lines;
}

function escapeCsvCell(value) {
  const s = String(value ?? "");
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsvString(lines) {
  return lines.map((line) => line.map(escapeCsvCell).join(",")).join("\r\n");
}

// A plain client-side file download, triggered only by the user's own
// "Export CSV" click — the file is generated entirely from data already in
// the page, not fetched from anywhere.
function downloadCsv(filename, csvString) {
  const blob = new Blob([csvString], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function getServerSideProps(context) {
  const session = await getServerSession(context.req, context.res, authOptions);

  if (!session) {
    return { redirect: { destination: "/", permanent: false } };
  }

  return { props: {} };
}
