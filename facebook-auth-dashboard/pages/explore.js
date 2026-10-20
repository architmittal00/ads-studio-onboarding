import Head from "next/head";
import dynamic from "next/dynamic";
import { getServerSession } from "next-auth/next";
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { authOptions } from "./api/auth/[...nextauth]";
import Layout from "@/components/Layout";
import Loader from "@/components/Loader";
import CacheStatus from "@/components/CacheStatus";
import SortableTable from "@/components/SortableTable";
import AccountSelect from "@/components/AccountSelect";
import RowActions from "@/components/RowActions";
import Thumb from "@/components/Thumb";
import CreativeLightbox from "@/components/CreativeLightbox";
import EntityDetailDrawer from "@/components/EntityDetailDrawer";
import CopyIdButton from "@/components/CopyIdButton";
import MetricPicker from "@/components/MetricPicker";
import { CloseIcon, SettingsIcon, ChevronIcon, ChartIcon, RocketIcon } from "@/components/icons";
import { useAccounts } from "@/components/AccountProvider";
import { getCachedEntry, setCachedEntry, clearCachedEntry } from "@/lib/clientCache";
import {
  getExploreViews,
  setExploreViews,
  getCustomMetrics,
  setCustomMetrics,
  getExploreQueryPanelCollapsed,
  setExploreQueryPanelCollapsed,
} from "@/lib/clientStorage";
import {
  LEVEL_OPTIONS,
  BREAKDOWN_GROUPS,
  METRIC_CATALOG,
  formatMetricValue,
  buildEffectiveCatalog,
  humanizeStatus,
} from "@/lib/insightsMetrics";
import { groupColor, newGroupId, pickNextGroupColor, moveViewNextToGroup, GROUP_COLORS } from "@/lib/tabGroups";
import { isoDate, addDaysUTC, todayUTC, computeRange, inclusiveDayCount } from "@/lib/dateRanges";
import DateRangeMenu from "@/components/DateRangeMenu";
import styles from "@/styles/Home.module.css";

// Recharts measures its container via ResizeObserver, so it can't be
// server-rendered — loaded only on this route, only on the client.
const ExploreChart = dynamic(() => import("@/components/ExploreChart"), { ssr: false });

const MAX_RANGE_DAYS = 365;
const EXPLORE_CACHE_PREFIX = "explore:";
const EXPLORE_CACHE_MAX_ENTRIES = 50;
// Per-account-set cache of discovered Custom Conversions (see
// /api/fb/custom-conversions and the fetch effect below) — keyed by a
// view's own sorted accountIds, same convention as EXPLORE_CACHE_PREFIX,
// separate from it since this caches account metadata, not a query result.
const CUSTOM_EVENTS_CACHE_PREFIX = "explore-custom-conversions:";
const CUSTOM_EVENTS_CACHE_MAX_ENTRIES = 20;
const MAX_VIEWS = 15;
// A fast query (the common case) should look exactly like it always has —
// this only kicks in once a query has been running long enough that a plain
// spinner starts reading as "is this stuck?", at which point swapping in the
// backend's own real progress ("Fetched 2 of 5…") keeps it legible without
// changing anything about how a normal, fast query feels.
const CONTEXTUAL_LOADER_DELAY_MS = 5000;

const TIME_GROUPING_OPTIONS = [
  { value: "", label: "No grouping (totals)" },
  { value: "1", label: "Daily" },
  { value: "7", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
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

// "Filter rows by name" (include or exclude) is intentionally independent
// of the selected Level — filtering by Campaign name while viewing
// Account-level totals is exactly the point (exclude/keep-only that
// campaign's numbers in the total, not just hide a row), so every field is
// always offered regardless of `view.level`. The
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

// "Only show these IDs" — the inclusion counterpart to "Exclude rows by
// name" above, for jumping straight to specific entities spotted elsewhere
// (e.g. a different date range, or a different filter combination) instead
// of re-finding them by name. Same independent-of-Level, same-rank/rollup
// shape as NAME_FILTER_FIELDS — see pages/api/fb/explore-insights.js's
// mirrored ID_FILTER_FIELD_LEVEL for the matching backend side.
const ID_FILTER_FIELDS = [
  { field: "campaignId", label: "Campaign ID", level: "campaign", rank: 1 },
  { field: "adsetId", label: "Ad Set ID", level: "adset", rank: 2 },
  { field: "adId", label: "Ad ID", level: "ad", rank: 3 },
];
const ALL_FILTER_FIELD_DEFS = [...NAME_FILTER_FIELDS, ...ID_FILTER_FIELDS];

// Splits on commas, whitespace, or newlines, dedupes, drops blanks — mirrors
// pages/api/fb/explore-insights.js's own parseIdList exactly (kept as a
// separate copy here since this one only needs to produce a quick client-side
// count, not parse an actual request body).
function parseIdList(text) {
  return [...new Set(String(text || "").split(/[,\s]+/).map((s) => s.trim()).filter(Boolean))];
}

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
    const def = ALL_FILTER_FIELD_DEFS.find((d) => d.field === f.field);
    return def && def.rank > LEVEL_RANK[level];
  });
}

// Post-query pivot-style filters — see createBlankView's resultFilters
// comment for why these are a client-side concern, not a backend one.
const METRIC_FILTER_OPERATORS = [
  { value: "gte", label: "≥" },
  { value: "lte", label: "≤" },
  { value: "gt", label: ">" },
  { value: "lt", label: "<" },
  { value: "eq", label: "=" },
  { value: "neq", label: "≠" },
];

function compareMetricValue(rowValue, operator, threshold) {
  if (typeof rowValue !== "number" || isNaN(rowValue) || typeof threshold !== "number" || isNaN(threshold)) return false;
  switch (operator) {
    case "gte":
      return rowValue >= threshold;
    case "lte":
      return rowValue <= threshold;
    case "gt":
      return rowValue > threshold;
    case "lt":
      return rowValue < threshold;
    case "eq":
      return rowValue === threshold;
    case "neq":
      return rowValue !== threshold;
    default:
      return true;
  }
}

// `availableMetricKeys` guards against a condition left over from before the
// user removed that metric from the view (Metrics picker) — without this, a
// stale condition's `row[key]` would be `undefined` on every row, which
// compareMetricValue correctly treats as "doesn't match", silently hiding
// every single row instead of just no-op'ing the dangling condition. A
// condition whose value was cleared mid-edit (e.g. the number input is
// momentarily blank) is guarded the same way, for the same reason — it
// shouldn't blank the whole table just because one threshold isn't a valid
// number yet. A condition's `basis` — "value" (the default, and the only
// option outside compare-to-previous mode) or "change" — picks whether the
// threshold compares against the metric's own value or its `_deltaPct`
// (percentage change vs. the previous period, only present when the view
// has compare-to-previous on); `row._deltaPct?.[c.metricKey]` is `undefined`
// on a row with no comparable previous value, which compareMetricValue
// already treats as "doesn't match," the same honest non-match as a missing
// metric value.
function applyResultFilters(rows, resultFilters, availableMetricKeys) {
  if (!rows) return rows;
  let out = rows;
  const conditions = (resultFilters?.metricConditions || []).filter(
    (c) => availableMetricKeys.includes(c.metricKey) && typeof c.value === "number" && !isNaN(c.value)
  );
  if (conditions.length > 0) {
    out = out.filter((row) =>
      conditions.every((c) =>
        compareMetricValue(c.basis === "change" ? row._deltaPct?.[c.metricKey] : row[c.metricKey], c.operator, c.value)
      )
    );
  }
  // `statusValues` is `null` for "no filter" (every status counts) vs. an
  // array for "only these statuses" — including an EMPTY array, which means
  // every status checkbox was explicitly unchecked and nothing should match.
  // `.length > 0` here used to treat that as indistinguishable from `null`,
  // so unchecking every box silently brought every row back instead of
  // showing none.
  if (resultFilters?.statusValues) {
    out = out.filter((row) => resultFilters.statusValues.includes(row.status));
  }
  return out;
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
    compareToPrevious: false,
    // How a comparison column's delta is displayed — "change" (the default,
    // a % swing) or "absolute" (the raw difference, in the metric's own
    // unit). Purely a display choice: the underlying `_previous`/`_deltaPct`
    // data is always both present server-side regardless of this setting.
    compareDisplay: "change",
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
    // "Only show these IDs" — the inclusion counterpart to nameFilters above,
    // same treatment (part of the query spec, takes effect next time the
    // query runs, independent of Level). `field` always has a value so the
    // dropdown has something selected even before any ID is pasted; an empty
    // `value` means the filter isn't active (see buildQuerySpecFromView).
    idFilter: { field: "campaignId", value: "" },
    // Post-query pivot-style filtering — unlike nameFilters above, these
    // never travel to the backend (not part of buildQuerySpecFromView/the
    // cache key) and apply instantly, client-side, to whatever's already in
    // `result`: a metric-threshold condition only ever hides/shows rows that
    // are already fully computed (no re-aggregation concern the way
    // nameFilters has), and `statusValues` is `null` for "no filter" (every
    // status shown) or an explicit array of statuses to keep.
    resultFilters: { metricConditions: [], statusValues: null },
    result: null,
    resultFetchedAt: null,
    loading: false,
    error: null,
    viewMode: "table",
    chartMetricKey: null,
    // Optional chart customization — both default to "automatic" behavior
    // (chartSecondaryMetricKey unset: single Y axis; chartXAxisKey unset:
    // ExploreChart's own existing date/entity-label default) so an existing
    // view never changes how its chart looks until someone opts in.
    chartSecondaryMetricKey: null,
    chartXAxisKey: "",
    // The results table's own sort/search/column-order/frozen-column state —
    // persisted per tab the same way as every other field here, so reopening
    // this tab later (even after closing the browser) shows the table
    // exactly as it was left, not swept back to defaults. `tableColOrder`
    // null means "never customized" (SortableTable falls back to the
    // current columns' own order). Row selection and the Total-row toggle
    // stay session-only (see ExploreResultsTable's own state) — neither
    // reads as a "filter" someone would expect to survive a reload the way
    // a sort order or a typed-in search term does.
    tableSortKey: null,
    tableSortDir: "desc",
    tableSearch: "",
    tableColOrder: null,
    tableFirstColFrozen: true,
    // Which tab group (if any) this tab belongs to — see `groups` state in
    // the Explore component and GROUP_COLORS below. Null means ungrouped.
    groupId: null,
  };
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
  // Unlike customMetrics (global, from localStorage, usable identically in
  // every view), a view's discovered Custom Conversions are tied to *that
  // view's own* accountIds, and this function runs for every open tab (e.g.
  // rehydrating each tab's cached result on mount), not just the active one.
  // Reading the cache directly here — instead of threading a customEvents
  // param through every call site — works for the active view (the fetch
  // effect below just populated it) and for any other view that was ever
  // activated before in this browser; a tab whose accounts were never
  // activated simply resolves its custom-conversion keys to nothing until
  // visited (renders "—", never wrong data).
  const knownCustomEvents =
    getCachedEntry(CUSTOM_EVENTS_CACHE_PREFIX + JSON.stringify([...view.accountIds].sort()))?.data?.customEvents || [];
  return {
    // Sorted so picking the same accounts in a different order (the
    // multi-select doesn't guarantee pick order survives) still produces the
    // same cache key / request body.
    accountIds: [...view.accountIds].sort(),
    level: view.level,
    // Always false here, even at Ad level — unlike the drill-down child
    // fetch (see startFetch below), which still asks for creative data
    // inline since its id lists are small. A top-level Ad-level query's own
    // thumbnails are fetched separately afterwards, in the background (see
    // loadThumbnailsForView()), so the table can render the moment Insights
    // data itself is back instead of also waiting on Facebook's
    // one-call-per-50-ads creative lookup — the biggest single contributor
    // to a large Ad-level query feeling slow.
    includeCreative: false,
    breakdownGroup: view.breakdownGroup,
    metricKeys: view.metricKeys,
    customMetrics: (customMetrics || [])
      .filter((cm) => view.metricKeys.includes(cm.id))
      .map((cm) => ({ id: cm.id, numeratorKey: cm.numeratorKey, denominatorKey: cm.denominatorKey })),
    customEvents: knownCustomEvents
      .filter((ce) => view.metricKeys.includes(ce.id))
      .map((ce) => ({ id: ce.id, accountId: ce.accountId, actionType: ce.actionType })),
    // Only filters with real text to match on travel in the request — an
    // in-progress, not-yet-"+ Exclude"d entry never reaches `nameFilters` in
    // the first place (see addNameFilter below), but this stays defensive
    // against any other path that might someday add one with a blank value.
    nameFilters: (view.nameFilters || [])
      .filter((f) => f.value.trim())
      .map((f) => ({ field: f.field, value: f.value.trim(), mode: f.mode === "include" ? "include" : "exclude" })),
    // Omitted (not `null` — JSON.stringify keeps a `null` key but drops an
    // `undefined` one) when nothing's pasted, so a view that's never touched
    // this feature produces the exact same cache key / request body as
    // before it existed, same reasoning as previousSince/previousUntil below.
    idFilter: view.idFilter?.value?.trim() ? { field: view.idFilter.field, value: view.idFilter.value.trim() } : undefined,
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

// Streams newline-delimited JSON (same shape/reader pattern as
// pages/api/fb/launch-campaign.js + components/LaunchReview.js's own
// consumption of it) instead of one plain JSON response — a "progress" event
// per account/chunk fetched as it completes, then one "done" event carrying
// the exact same `{rows, meta}` (or `{error}`) shape this function used to
// return directly. `onProgress` is optional so every other caller (there
// isn't one today, but nothing requires it) can ignore progress entirely.
async function fetchExploreInsights(body, onProgress) {
  const res = await fetch("/api/fb/explore-insights", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  // A validation failure (bad date range, too many accounts, …) returns a
  // plain JSON error before any streaming starts — same as today.
  if (!res.ok || !res.body) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json.error || `Request failed (${res.status})`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalResult = null;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line);
      if (event.type === "progress") onProgress?.(event.message);
      else if (event.type === "done") finalResult = event;
    }
  }
  if (!finalResult) throw new Error("Request ended unexpectedly");
  if (finalResult.error) throw new Error(finalResult.error);
  return finalResult;
}

// Background creative lookup for a top-level Ad-level query's rows — see
// loadThumbnailsForView() below for how this gets fired and merged in.
async function fetchAdThumbnails(adIds) {
  const res = await fetch("/api/fb/ad-thumbnails", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ adIds }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json.thumbnails || {};
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

// One-line recap shown in place of the query form while the panel is
// collapsed — just enough to tell which query produced what's on screen
// without having to expand the panel to check. The date range itself isn't
// repeated here — it's always already visible right next to this, in the
// DateRangeMenu control (see renderDateRangeBar).
function summarizeQuery(view, adAccounts) {
  const accountNames = view.accountIds.map((id) => adAccounts.find((a) => a.id === id)?.name).filter(Boolean);
  const accountLabel =
    accountNames.length === 0
      ? "No account selected"
      : accountNames.length === 1
      ? accountNames[0]
      : `${accountNames.length} accounts`;
  const levelLabel = LEVEL_OPTIONS.find((l) => l.value === view.level)?.label;
  const metricCount = view.metricKeys.length;
  return `${accountLabel} · ${levelLabel} level · ${metricCount} metric${metricCount === 1 ? "" : "s"}`;
}

// Small "?" badge that swaps a section's always-visible explanatory paragraph
// for a native-tooltip hover — keeps the (narrow) query panel scannable while
// still putting the full explanation one hover away.
function HelpHint({ text }) {
  // A custom hover bubble, not the native `title` attribute — browsers only
  // show a `title` tooltip after a fixed, un-stylable delay (roughly a
  // second), which reads as sluggish for something meant to be a quick,
  // on-demand explanation.
  return (
    <span className={styles.helpHint} tabIndex={0} role="note" aria-label={text}>
      ?<span className={styles.helpHintTooltip}>{text}</span>
    </span>
  );
}

function SectionHeading({ children, hint }) {
  // position: relative here (not on .helpHint itself) is what the tooltip
  // positions against — see .helpHintTooltip's comment for why: anchoring to
  // this full-width row instead of the small "?" icon keeps the tooltip's
  // left edge at a consistent, always-in-bounds spot regardless of how far
  // right the icon ends up sitting after a long heading.
  return (
    <h2 className={styles.h2} style={{ display: "flex", alignItems: "center", gap: 6, position: "relative" }}>
      {children}
      {hint && <HelpHint text={hint} />}
    </h2>
  );
}

// Shown in the result area before a view has ever been run — otherwise that
// whole side of the screen is just blank, which is a confusing first
// impression for a page whose entire point is the query panel next to it.
function ExploreEmptyState({ canRunQuery, onRun, loading }) {
  return (
    <section className={styles.card}>
      <div className={styles.exploreEmptyState}>
        <div className={styles.exploreEmptyIcon}>
          <ChartIcon size={26} />
        </div>
        <div>
          <h2 className={styles.h2} style={{ marginBottom: 6 }}>
            Ready for your next view
          </h2>
          <p className={styles.sub}>
            Set up your query in the panel on the right, then run it to see the table or chart here.
          </p>
        </div>
        <div className={styles.exploreEmptySteps}>
          {["Pick an account", "Choose a level, date range & breakdown", "Select the metrics you care about", 'Click "Update This View"'].map(
            (step, i) => (
              <div key={step} className={styles.exploreEmptyStep}>
                <span className={styles.exploreEmptyStepNum}>{i + 1}</span>
                {step}
              </div>
            )
          )}
        </div>
        <button type="button" className={styles.btnPrimary} disabled={!canRunQuery || loading} onClick={onRun}>
          {loading ? "Updating…" : "Update This View"}
        </button>
      </div>
    </section>
  );
}

// Search-as-you-type single-select over a flat {key, label} list — the
// Custom ratio metric form's numerator/denominator pickers used to be plain
// native <select>s, the only spot in this page that didn't use the same
// combo-box look (components/AccountSelect.js's single-select mode) as every
// other picker in the app, which matters here specifically: METRIC_CATALOG
// has ~40 entries across 8 groups, long enough that scrolling a native
// dropdown to find one is exactly the friction AccountSelect was built to
// avoid for a long account list. Not AccountSelect itself reused directly —
// its prop names and module doc comment are written in terms of ad accounts,
// and this app's own convention (see components/DuplicateEntityModal.js's
// PickerList/PickerRow) is a small dedicated picker per distinct domain
// rather than a generically-named component doing double duty.
function MetricSelect({ options, value, onChange, placeholder }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const blurTimer = useRef(null);

  function handleFocus() {
    clearTimeout(blurTimer.current);
    setQuery("");
    setOpen(true);
  }

  // Same delayed-close idiom as AccountSelect/InterestPicker — a plain onBlur
  // fires before an option's onMouseDown would register.
  function handleBlur() {
    blurTimer.current = setTimeout(() => setOpen(false), 150);
  }

  const selected = options.find((o) => o.key === value);
  const filtered = query.trim() ? options.filter((o) => o.label.toLowerCase().includes(query.trim().toLowerCase())) : options;
  const displayValue = open ? query : selected?.label || "";

  function pick(option) {
    onChange(option.key);
    setQuery("");
    setOpen(false);
  }

  return (
    <div className={styles.comboWrapper} style={{ minWidth: 180 }}>
      <input
        type="text"
        className={styles.select}
        style={{ width: "100%" }}
        placeholder={placeholder}
        value={displayValue}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={handleFocus}
        onBlur={handleBlur}
      />
      {open && (
        <div className={styles.comboDropdown}>
          {filtered.length === 0 ? (
            <div className={styles.comboOption}>No matches.</div>
          ) : (
            filtered.map((o) => (
              <div
                key={o.key}
                className={styles.comboOption}
                onMouseDown={() => pick(o)}
                style={o.key === value ? { background: "rgba(var(--purple-rgb), 0.12)", fontWeight: 700 } : undefined}
              >
                {o.label}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export default function Explore() {
  const { adAccounts, accountsError, selectedAccountId } = useAccounts();

  const [views, setViews] = useState(() => [createBlankView("")]);
  const [activeViewId, setActiveViewId] = useState(() => views[0].id);
  const activeView = views.find((v) => v.id === activeViewId) || views[0];

  // Tab groups — like Chrome's own: a named, colored cluster of adjacent
  // tabs. `{id, name, color, collapsed}`; membership lives on each view's own
  // `groupId`, not here (so closing every tab in a group just leaves an
  // empty group entry, cleaned up by pruneEmptyGroups below rather than
  // tracked bidirectionally). Persisted alongside `views` — see the
  // persistence effect below.
  const [groups, setGroups] = useState([]);

  // Which tab (if any) is currently showing its rename text input in place
  // of its label — at most one at a time, cleared on commit/cancel/blur.
  const [renamingViewId, setRenamingViewId] = useState(null);
  const [renameDraft, setRenameDraft] = useState("");

  // The tab being right-clicked (for "Add to group" / "Remove from group")
  // or the group chip being clicked (for rename/color/ungroup/close) — at
  // most one open menu at a time, closed on an outside click or Escape.
  const [tabMenu, setTabMenu] = useState(null); // { type: "tab" | "group", id, x, y }
  // The group popover's own rename field — seeded with that group's current
  // name whenever the popover opens (see the chip's onClick below).
  const [groupRenameDraft, setGroupRenameDraft] = useState("");

  useEffect(() => {
    if (!tabMenu) return;
    function closeMenu() {
      setTabMenu(null);
    }
    function closeOnEscape(e) {
      if (e.key === "Escape") closeMenu();
    }
    window.addEventListener("click", closeMenu);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [tabMenu]);

  // Collapsed by default (per-device, like the app sidebar) so the result
  // table/chart — not the query form that produced it — is the first thing
  // the user sees; expanding shows the form side-by-side with the result
  // rather than covering it. See `queryPanelExpanded` below for the one
  // exception (a view with nothing fetched yet forces this open).
  const [queryPanelCollapsed, setQueryPanelCollapsedState] = useState(true);
  useEffect(() => {
    const saved = getExploreQueryPanelCollapsed();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time read of a per-device localStorage preference on mount, not derivable from props/state
    if (saved != null) setQueryPanelCollapsedState(saved);
  }, []);
  function toggleQueryPanel() {
    setQueryPanelCollapsedState((prev) => {
      const next = !prev;
      setExploreQueryPanelCollapsed(next);
      return next;
    });
  }

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

  // Account-discovered Custom Conversions (Events Manager-formalized CAPI/
  // pixel custom events — see /api/fb/custom-conversions) for the ACTIVE
  // view's own account selection. Unlike customMetrics above, this isn't a
  // user preference — it's metadata about the account, re-fetched (or read
  // from cache) whenever the active view's accountIds change, following the
  // same async-fetch-in-effect + localStorage-cache pattern
  // components/AccountProvider.js's load() already uses.
  const [customEvents, setCustomEvents] = useState([]);
  const [customEventsLoading, setCustomEventsLoading] = useState(false);
  const activeAccountIdsKey = JSON.stringify([...activeView.accountIds].sort());
  useEffect(() => {
    const ids = JSON.parse(activeAccountIdsKey);
    if (ids.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clearing stale events from a previously-active view's accounts, not derivable from props/state
      setCustomEvents([]);
      return;
    }
    const cacheKey = CUSTOM_EVENTS_CACHE_PREFIX + JSON.stringify(ids);
    const cached = getCachedEntry(cacheKey);
    if (cached) {
      setCustomEvents(cached.data.customEvents || []);
      return;
    }
    let cancelled = false;
    setCustomEventsLoading(true);
    fetch(`/api/fb/custom-conversions?accountIds=${ids.join(",")}`)
      .then((res) => res.json())
      .then((json) => {
        if (cancelled) return;
        if (json.error) {
          setCustomEvents([]);
          return;
        }
        setCustomEvents(json.customEvents || []);
        setCachedEntry(cacheKey, json, { prefix: CUSTOM_EVENTS_CACHE_PREFIX, maxEntriesForPrefix: CUSTOM_EVENTS_CACHE_MAX_ENTRIES });
      })
      .catch(() => {
        if (!cancelled) setCustomEvents([]);
      })
      .finally(() => {
        if (!cancelled) setCustomEventsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeAccountIdsKey]);

  // Same-named custom conversions on different accounts need to stay
  // distinguishable once more than one account is selected — reuses the
  // exact "<Account Name> — <label>" pattern already used for multi-account
  // chart labels below (see the chartRows memo).
  const labeledCustomEvents = useMemo(() => {
    if (activeView.accountIds.length <= 1) return customEvents;
    return customEvents.map((ce) => ({
      ...ce,
      name: `${adAccounts.find((a) => a.id === ce.accountId)?.name || ce.accountId} — ${ce.name}`,
    }));
  }, [customEvents, activeView.accountIds, adAccounts]);

  const effectiveCatalog = useMemo(
    () => buildEffectiveCatalog(customMetrics, labeledCustomEvents),
    [customMetrics, labeledCustomEvents]
  );
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

  // "Filter rows by name" creation form — always offers all three fields
  // regardless of the active view's level (see NAME_FILTER_FIELDS above).
  const [newFilterField, setNewFilterField] = useState("campaignName");
  const [newFilterValue, setNewFilterValue] = useState("");
  const [newFilterMode, setNewFilterMode] = useState("exclude");

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
  const queryPanelRef = useRef(null);
  const tabsRowRef = useRef(null);

  // The view-tabs row above is sticky at `top: 0`; when the query panel is
  // collapsed, the "Edit Query" summary row right below it needs to be
  // sticky too (it was scrolling away with the result table, forcing a
  // scroll back up just to tweak the query) — pinned directly under the
  // tabs row rather than at `top: 0` itself, which would stack the two on
  // top of each other. The tabs row's height isn't a fixed constant (a
  // couple of long view names can wrap it to two lines), so it's measured
  // live instead of guessed.
  const [tabsRowHeight, setTabsRowHeight] = useState(0);
  useEffect(() => {
    const el = tabsRowRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      setTabsRowHeight(entries[0].contentRect.height);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  function updateView(id, patch) {
    setViews((prev) => prev.map((v) => (v.id === id ? { ...v, ...(typeof patch === "function" ? patch(v) : patch) } : v)));
  }

  function updateActive(patch) {
    updateView(activeViewId, patch);
  }

  // Fires the background per-ad creative lookup for a top-level Ad-level
  // result whose rows don't carry real thumbnails yet (see
  // buildQuerySpecFromView's `includeCreative: false` and the server's own
  // `meta.thumbnailsFetched`), then merges the result back into this exact
  // view/result once it resolves — Thumb renders its loading spinner for
  // every row in between. Guarded by `v.result === json` so a
  // since-superseded result (the user re-ran the query, or switched tabs,
  // before this resolved) never clobbers whatever's now on screen with stale
  // thumbnails. Re-caches the thumbnail-enriched result so reopening this
  // same view from cache doesn't have to re-fetch them.
  function loadThumbnailsForView(viewId, json, cacheKey) {
    if (json.meta.level !== "ad" || json.meta.thumbnailsFetched) return;
    const adIds = [...new Set(json.rows.map((r) => r.entityId).filter(Boolean))];
    if (adIds.length === 0) return;

    const applyThumbnails = (thumbnails) => {
      const withThumbnails = (list) =>
        list?.map((r) =>
          r.entityId ? { ...r, thumbnailUrl: thumbnails[r.entityId]?.thumbnailUrl ?? null, isVideo: !!thumbnails[r.entityId]?.isVideo } : r
        ) ?? list;
      const updatedJson = {
        ...json,
        rows: withThumbnails(json.rows),
        meta: { ...json.meta, pivotRows: withThumbnails(json.meta.pivotRows), thumbnailsFetched: true },
      };
      updateView(viewId, (v) => (v.result === json ? { result: updatedJson } : {}));
      setCachedEntry(cacheKey, updatedJson, { prefix: EXPLORE_CACHE_PREFIX, maxEntriesForPrefix: EXPLORE_CACHE_MAX_ENTRIES });
    };

    // Soft-fail — same reasoning as every other creative lookup in this app:
    // a failed fetch just means every row keeps its blank "no creative"
    // thumbnail instead of spinning forever, not a failed query.
    fetchAdThumbnails(adIds).then(applyThumbnails).catch(() => applyThumbnails({}));
  }

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
      // be backfilled, not just wherever it's read. A `nameFilters` entry
      // saved before "include" mode existed has no `mode` of its own either
      // — it was always exclude-only back then, so that's the default here.
      const accountIds = v.accountIds ?? (v.accountId ? [v.accountId] : []);
      const migrated = {
        ...v,
        accountIds,
        nameFilters: (v.nameFilters || []).map((f) => ({ ...f, mode: f.mode === "include" ? "include" : "exclude" })),
        idFilter: v.idFilter || { field: "campaignId", value: "" },
        compareCustomSince: v.compareCustomSince || "",
        compareDisplay: v.compareDisplay === "absolute" ? "absolute" : "change",
        resultFilters: v.resultFilters || { metricConditions: [], statusValues: null },
        tableSortKey: v.tableSortKey ?? null,
        tableSortDir: v.tableSortDir || "desc",
        tableSearch: v.tableSearch || "",
        tableColOrder: v.tableColOrder || null,
        tableFirstColFrozen: v.tableFirstColFrozen !== false,
        groupId: v.groupId ?? null,
      };
      delete migrated.accountId;
      const cacheKey =
        accountIds.length > 0 && v.metricKeys?.length > 0
          ? EXPLORE_CACHE_PREFIX + JSON.stringify(buildQuerySpecFromView(migrated, customMetricsAtMount))
          : null;
      const cached = cacheKey ? getCachedEntry(cacheKey) : null;
      // Rare edge case: the tab was closed (or the browser reloaded) while
      // this exact result's background thumbnail fetch (see
      // loadThumbnailsForView()) was still in flight, so what got cached was
      // the pre-thumbnails snapshot — picked back up here. Safe to call
      // before `setViews(hydrated)` below actually lands: the fetch itself
      // is a real network round trip, which by itself outlasts the
      // synchronous state update this effect makes right after.
      if (cached?.data && !cached.data.meta.thumbnailsFetched && cached.data.meta.level === "ad") {
        loadThumbnailsForView(migrated.id, cached.data, cacheKey);
      }
      return {
        ...migrated,
        result: cached?.data ?? null,
        resultFetchedAt: cached?.fetchedAt ?? null,
        loading: false,
        error: null,
      };
    });
    // Only a group some restored view still actually points at survives —
    // otherwise every tab ever grouped, then closed, across every session
    // would pile up here forever.
    const liveGroupIds = new Set(hydrated.map((v) => v.groupId).filter(Boolean));
    const restoredGroups = (persisted.groups || []).filter((g) => liveGroupIds.has(g.id));
    // One-time hydration from localStorage on mount, not derived state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setViews(hydrated);
    setActiveViewId(hydrated.some((v) => v.id === persisted.activeViewId) ? persisted.activeViewId : hydrated[0].id);
    setGroups(restoredGroups);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- genuinely a one-time mount restore; loadThumbnailsForView has no meaningful "staleness" here, it's only ever called above with the exact cached.data it closes over
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

  // A group with no member tab left (its last tab closed, ungrouped, or
  // evicted by withCapApplied) is dropped here — derived on every render
  // instead of pruned reactively in an effect, so nothing ever displays or
  // persists an invisible, empty group entry.
  const liveGroups = useMemo(() => groups.filter((g) => views.some((v) => v.groupId === g.id)), [groups, views]);

  // Persists the open tabs' query specs (never their fetched results, which
  // are ephemeral and re-derived from the cache on restore) and the tab
  // groups whenever either changes — a plain sync-to-external-system effect,
  // not a state update.
  useEffect(() => {
    setExploreViews({
      activeViewId,
      views: views.map(({ result, resultFetchedAt, loading, error, progressMessage, ...spec }) => spec),
      groups: liveGroups,
    });
  }, [views, activeViewId, liveGroups]);

  // Applied after a row action (pause/activate/change budget, see
  // components/RowActions.js) succeeds on Facebook's side — patches every
  // row in the CURRENT view's already-fetched result that points at the
  // same entity (a breakdown can repeat one entity across several rows, all
  // of which should reflect the change), so the table shows the new
  // status/budget immediately without needing to re-run the query. Also
  // drops this view's cache entry for its current query spec, so a later
  // cache-hit (e.g. switching tabs and back) can't resurrect the
  // pre-action data — this view's own "Hard Refresh" already exists for
  // anyone who wants a fully fresh fetch instead of trusting the patch.
  function applyEntityActionPatch(entityId, patch) {
    clearCachedEntry(EXPLORE_CACHE_PREFIX + JSON.stringify(buildQuerySpecFromView(activeView, customMetrics)));
    updateActive((v) => {
      if (!v.result) return {};
      return {
        result: { ...v.result, rows: v.result.rows.map((r) => (r.entityId === entityId ? { ...r, ...patch } : r)) },
      };
    });
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
        loadThumbnailsForView(view.id, cached.data, cacheKey);
        return;
      }
    }

    updateView(view.id, { loading: true, error: null, progressMessage: null });
    // `startedAt` is set lazily on the first progress event rather than via
    // a bare `Date.now()` here — this function is defined in the component
    // body, and the `Date.now()` calls below it need to live inside a
    // callback (same as `resultFetchedAt: Date.now()` a few lines down) to
    // satisfy the "no impure call directly in a component-scoped function"
    // lint rule, even though this one only ever runs from an event handler.
    let startedAt = null;
    fetchExploreInsights(spec, (message) => {
      // Gated on elapsed time, not just "a progress event arrived" — the
      // backend emits these as each account/chunk finishes regardless of how
      // fast the overall query is, so without this a sub-second query could
      // still flash a progress label for one render before the result
      // replaces it.
      if (startedAt == null) startedAt = Date.now();
      if (Date.now() - startedAt >= CONTEXTUAL_LOADER_DELAY_MS) updateView(view.id, { progressMessage: message });
    })
      .then((json) => {
        updateView(view.id, {
          result: json,
          resultFetchedAt: Date.now(),
          error: null,
          chartMetricKey: firstChartableKey(json.meta.metricKeys, effectiveCatalog, json.meta.accountIds.length),
        });
        setCachedEntry(cacheKey, json, { prefix: EXPLORE_CACHE_PREFIX, maxEntriesForPrefix: EXPLORE_CACHE_MAX_ENTRIES });
        loadThumbnailsForView(view.id, json, cacheKey);
      })
      .catch((err) => updateView(view.id, { error: err.message }))
      .finally(() => updateView(view.id, { loading: false, progressMessage: null }));
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

  // "Open new" on a set of selected Campaign/Ad Set rows — a new tab at the
  // next level down (Ad Set for a Campaign selection, Ad for an Ad Set
  // selection), scoped to exactly those selected entities via the same
  // "Only show these IDs" mechanism the query panel already exposes, with
  // every other query parameter (date range, metrics, breakdown, name
  // filters, compare-to-previous, …) carried over unchanged from the active
  // view. Overwrites whatever idFilter the active view already had — that's
  // the whole point of this one, not a filter someone else set earlier.
  function openChildViewFromSelection(parentLevel, entityIds) {
    const childLevel = CHILD_LEVEL[parentLevel];
    if (!childLevel || entityIds.length === 0) return;
    const newView = {
      ...activeView,
      id: newViewId(),
      customTitle: null,
      level: childLevel,
      idFilter: { field: CHILD_ID_FILTER_FIELD[childLevel], value: entityIds.join(",") },
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

  // Tab groups mirror Chrome's own model: a group is just a name + color
  // (see lib/tabGroups.js), and membership is a `groupId` on each view —
  // grouping a tab always moves it next to its new group's other members so
  // a group's tabs stay contiguous on screen, the same guarantee Chrome
  // enforces (the rendering walk below assumes exactly one contiguous run
  // per group id).
  function createGroupFromView(viewId) {
    const id = newGroupId();
    const color = pickNextGroupColor(liveGroups);
    setGroups((prev) => [...prev, { id, name: "New group", color, collapsed: false }]);
    setViews((prev) => moveViewNextToGroup(prev, viewId, id).map((v) => (v.id === viewId ? { ...v, groupId: id } : v)));
    setTabMenu(null);
  }

  function addViewToGroup(viewId, groupId) {
    setViews((prev) => moveViewNextToGroup(prev, viewId, groupId).map((v) => (v.id === viewId ? { ...v, groupId } : v)));
    setTabMenu(null);
  }

  function removeViewFromGroup(viewId) {
    setViews((prev) => prev.map((v) => (v.id === viewId ? { ...v, groupId: null } : v)));
    setTabMenu(null);
  }

  function commitGroupRename(groupId, name) {
    setGroups((prev) => prev.map((g) => (g.id === groupId ? { ...g, name: name.trim() || g.name } : g)));
  }

  function recolorGroup(groupId, color) {
    setGroups((prev) => prev.map((g) => (g.id === groupId ? { ...g, color } : g)));
  }

  function toggleGroupCollapsed(groupId) {
    setGroups((prev) => prev.map((g) => (g.id === groupId ? { ...g, collapsed: !g.collapsed } : g)));
  }

  function ungroup(groupId) {
    setViews((prev) => prev.map((v) => (v.groupId === groupId ? { ...v, groupId: null } : v)));
    setTabMenu(null);
  }

  // Closes every tab in a group at once (Chrome's own "Close group") —
  // refuses if that would close every open tab, same guard as closeView.
  function closeGroup(groupId) {
    const memberIds = new Set(views.filter((v) => v.groupId === groupId).map((v) => v.id));
    const next = views.filter((v) => !memberIds.has(v.id));
    if (next.length === 0) return;
    setViews(next);
    if (memberIds.has(activeViewId)) setActiveViewId(next[0].id);
    setTabMenu(null);
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

  // Whether running this exact view, as currently configured, would make the
  // backend fetch at a finer level than `activeView.level` and roll the
  // result back up — shown as a heads-up before running the query, and used
  // to explain why Reach-derived metrics won't be in the result.
  const activeNameFilters = useMemo(() => (activeView.nameFilters || []).filter((f) => f.value.trim()), [activeView.nameFilters]);
  const activeIdFilters = useMemo(
    () => (activeView.idFilter?.value?.trim() ? [{ field: activeView.idFilter.field, value: activeView.idFilter.value }] : []),
    [activeView.idFilter]
  );
  const activeIdFilterCount = useMemo(() => parseIdList(activeView.idFilter?.value).length, [activeView.idFilter]);
  const willRollup = wouldNeedRollup(activeView.level, [...activeNameFilters, ...activeIdFilters]);

  function addNameFilter() {
    const value = newFilterValue.trim();
    if (!value) return;
    updateActive((v) => ({
      nameFilters: [...(v.nameFilters || []), { id: newViewId(), field: newFilterField, value, mode: newFilterMode }],
    }));
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

  // The collapsed preference only ever applies once there's a result to show
  // instead — a brand-new (or still-loading-for-the-first-time) view has
  // nothing else on screen, so the form it needs to run a query stays open
  // regardless of the stored preference.
  const queryPanelExpanded = !result || !queryPanelCollapsed;

  // `.exploreQueryPanel`'s CSS caps it at `calc(100vh - 40px)` assuming its
  // own top edge sits at the `top: 20px` it's pinned to once sticky engages
  // — true only after scrolling the page down past the title/tabs above it.
  // Before that, the panel renders at its normal (taller) in-flow offset, so
  // that same height budget lets its bottom run past the viewport, hiding
  // the "Update This View" footer until you scroll. Recomputing the cap from
  // the panel's *current* on-screen top — whether stuck or not — keeps its
  // bottom edge pinned just above the viewport bottom at every scroll
  // position instead, so the footer never needs scrolling the page to reach.
  const [queryPanelMaxHeight, setQueryPanelMaxHeight] = useState(null);
  useLayoutEffect(() => {
    if (!queryPanelExpanded) return;
    const PANEL_BOTTOM_MARGIN = 20;
    const PANEL_MIN_HEIGHT = 240;
    let frame = null;
    function recompute() {
      frame = null;
      const el = queryPanelRef.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top;
      setQueryPanelMaxHeight(Math.max(PANEL_MIN_HEIGHT, window.innerHeight - top - PANEL_BOTTOM_MARGIN));
    }
    // Cancel-and-reschedule, not "skip while one's already pending" — the
    // latter leaves `frame` permanently non-null (so every later scroll/
    // resize is silently ignored forever) if that one pending frame is ever
    // dropped or indefinitely delayed, e.g. a tab backgrounded mid-scroll.
    // Once stuck, the panel's height just freezes at whatever it last
    // computed — too tall for the current viewport/scroll position (running
    // past the footer again) or, just as easily, stuck not tall enough,
    // leaving unused space below a short form. This way a new event always
    // gets a fresh frame, so it can't wedge itself permanently.
    function onScrollOrResize() {
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(recompute);
    }
    recompute();
    // capture: true — this app's global CSS makes <body>, not the document,
    // the actual scrolling element (see styles/globals.css), and a native
    // "scroll" event doesn't bubble, so a plain window listener would never
    // fire. A capturing listener on window still sees it on the way down.
    window.addEventListener("scroll", onScrollOrResize, { passive: true, capture: true });
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      window.removeEventListener("scroll", onScrollOrResize, { capture: true });
      window.removeEventListener("resize", onScrollOrResize);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [queryPanelExpanded]);

  // Post-query pivot filters applied instantly, client-side, to whatever's
  // already in `result` — never a re-fetch. Everything downstream (table,
  // chart, CSV export, the row-count line) reads this instead of
  // `result.rows` directly, so filtering stays consistent everywhere the
  // result set is consumed.
  const filteredRows = useMemo(
    () => (result ? applyResultFilters(result.rows, activeView.resultFilters, result.meta.metricKeys) : []),
    [result, activeView.resultFilters]
  );

  // Every distinct status actually present in the *unfiltered* result, so
  // unchecking one doesn't make its own checkbox disappear.
  const availableStatuses = useMemo(() => {
    if (!result?.meta.statusAvailable) return [];
    return [...new Set(result.rows.map((r) => r.status).filter(Boolean))].sort();
  }, [result]);

  // Metric-threshold conditions are edited in a local draft, completely
  // separate from `activeView.resultFilters.metricConditions` (the committed
  // version `filteredRows` actually reads), so typing a value — or changing
  // its metric/operator — doesn't re-filter the table on every keystroke.
  // Nothing here takes effect until "Apply Filters" is clicked (see
  // applyMetricFilters below). Re-synced only when the active tab itself
  // changes, so switching to another view shows *that* view's own committed
  // filters as the starting draft rather than carrying over in-progress,
  // never-applied edits from the previous tab.
  const [draftConditions, setDraftConditions] = useState(() => activeView.resultFilters.metricConditions);
  useEffect(() => {
    // Resets the draft to match the newly-active tab's own committed
    // filters — not a derived-state anti-pattern; this is the one moment
    // the draft is deliberately allowed to diverge from the previous
    // render's value (switching tabs), not a value React could compute
    // during render itself.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraftConditions(activeView.resultFilters.metricConditions);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately keyed only on the tab switching, not on every resultFilters change, which would wipe out in-progress edits made since the last Apply
  }, [activeViewId]);

  const hasPendingMetricChanges = JSON.stringify(draftConditions) !== JSON.stringify(activeView.resultFilters.metricConditions);

  function addDraftCondition() {
    const numericKeys = (result?.meta.metricKeys || []).filter(
      (k) => effectiveCatalog.find((m) => m.key === k)?.format !== "text"
    );
    if (numericKeys.length === 0) return;
    setDraftConditions((prev) => [...prev, { id: newViewId(), metricKey: numericKeys[0], basis: "value", operator: "gte", value: 0 }]);
  }

  function updateDraftCondition(id, patch) {
    setDraftConditions((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }

  // Unlike every other draft edit (metric/operator/value), removing a
  // condition entirely takes effect immediately — same reasoning as the
  // Status checkboxes below: there's no keystroke-by-keystroke jank to
  // smooth over with an explicit Apply step, and leaving a just-removed
  // condition still filtering the table until a separate Apply click looks
  // like the "×" button silently did nothing.
  function removeDraftCondition(id) {
    const next = draftConditions.filter((c) => c.id !== id);
    setDraftConditions(next);
    updateActive((v) => ({ resultFilters: { ...v.resultFilters, metricConditions: next } }));
  }

  function applyMetricFilters() {
    updateActive((v) => ({ resultFilters: { ...v.resultFilters, metricConditions: draftConditions } }));
  }

  // `statusValues: null` means "no filter" (every status counts as checked)
  // — toggling one off for the first time has to materialize the full
  // current list minus that one, and toggling the last excluded one back on
  // collapses back to `null` so the stored shape stays canonical rather than
  // accumulating an explicit "all of them" array over time.
  function toggleStatus(status) {
    updateActive((v) => {
      const current = v.resultFilters.statusValues ?? availableStatuses;
      const next = current.includes(status) ? current.filter((s) => s !== status) : [...current, status];
      const allChecked = availableStatuses.length > 0 && availableStatuses.every((s) => next.includes(s));
      return { resultFilters: { ...v.resultFilters, statusValues: allChecked ? null : next } };
    });
  }

  // Prefixes each row's `label` with its account's name whenever more than
  // one account is selected, so ExploreChart's pivot-by-label logic
  // naturally separates accounts into distinct lines/bars/series — purely a
  // render-time view of the data, never mutating `result.rows` itself (the
  // same row objects may be sitting in lib/clientCache.js's stored entry).
  // Excluded-by-name rows are already absent from `result.rows` itself (the
  // backend applies — and, where necessary, re-aggregates around — every
  // active name filter before ever returning a result); `filteredRows`
  // layers the post-query pivot filters (metric thresholds, status) on top
  // of that, client-side.
  const chartRows = useMemo(() => {
    if (!result) return [];
    if (result.meta.accountIds.length <= 1) return filteredRows;
    return filteredRows.map((r) => ({
      ...r,
      label: `${adAccounts.find((a) => a.id === r.accountId)?.name || r.accountId} — ${r.label}`,
    }));
  }, [result, filteredRows, adAccounts]);

  function handleExportCsv() {
    if (!result) return;
    const csv = toCsvString(buildCsvTable(filteredRows, result.meta, adAccounts, currencyByAccountId, effectiveCatalog));
    const viewIndex = views.findIndex((v) => v.id === activeView.id);
    const slug = viewTitle(activeView, adAccounts, viewIndex === -1 ? 0 : viewIndex)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    downloadCsv(`explore-${slug || "report"}-${result.meta.since}-to-${result.meta.until}.csv`, csv);
  }

  // Shown in both layouts below (side-by-side with the query panel when
  // expanded, full-width under the collapsed-panel toolbar otherwise) — kept
  // as one value rather than duplicated JSX so there's exactly one copy of
  // this fairly large block to keep in sync.
  const resultArea = (
    <>
      {activeView.error && <div className={styles.error}>Error: {activeView.error}</div>}
      {activeView.loading && !result && <Loader label={activeView.progressMessage || "Running your query…"} />}
      {!activeView.error && !activeView.loading && !result && (
        <ExploreEmptyState canRunQuery={canRunQuery} loading={activeView.loading} onRun={() => runQueryForView(activeView, false)} />
      )}

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
              <Loader label={activeView.progressMessage || describeQuery(activeView)} />
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
            {filteredRows.length === result.meta.rowCount
              ? `${result.meta.rowCount} row${result.meta.rowCount === 1 ? "" : "s"}`
              : `${filteredRows.length} of ${result.meta.rowCount} rows (filtered)`}
            {result.meta.filteredByNameCount > 0 &&
              ` · ${result.meta.filteredByNameCount} filtered out by name filter`}
          </p>
          {result.meta.excludedMetrics?.length > 0 && (
            <p className={styles.sub}>
              {result.meta.excludedMetrics.map((k) => effectiveCatalog.find((m) => m.key === k)?.label || k).join(", ")} not
              shown — a name filter required combining finer-grained data, and those can&apos;t be correctly
              combined across entities.
            </p>
          )}

          {/* Post-query pivot filters — applied to `result` already sitting in state, no re-fetch.
              Metric conditions are a local draft until "Apply Filters" is clicked, so typing a
              value doesn't re-filter the table on every keystroke; Status checkboxes (below)
              stay instant since a checkbox click has no typing-jank to smooth over. */}
          <div className={styles.card} style={{ padding: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span className={styles.muted} style={{ fontWeight: 600 }}>
                Filter results
              </span>
              <button type="button" className={styles.btnSecondary} onClick={addDraftCondition}>
                + Metric filter
              </button>
              {(draftConditions.length > 0 || hasPendingMetricChanges) && (
                <button
                  type="button"
                  className={styles.btnPrimary}
                  disabled={!hasPendingMetricChanges}
                  onClick={applyMetricFilters}
                >
                  Apply Filters
                </button>
              )}
            </div>

            {draftConditions.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
                {draftConditions.map((c) => (
                  <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <select
                      className={styles.select}
                      value={c.metricKey}
                      onChange={(e) => updateDraftCondition(c.id, { metricKey: e.target.value })}
                    >
                      {result.meta.metricKeys
                        .filter((k) => effectiveCatalog.find((m) => m.key === k)?.format !== "text")
                        .map((k) => (
                          <option key={k} value={k}>
                            {effectiveCatalog.find((m) => m.key === k)?.label || k}
                          </option>
                        ))}
                    </select>
                    {/* "% Change" only makes sense (and only has data) once
                        the view is actually comparing to a previous period
                        — hidden rather than shown-but-always-empty otherwise. */}
                    {result.meta.compareToPrevious && (
                      <select
                        className={styles.select}
                        value={c.basis || "value"}
                        onChange={(e) => updateDraftCondition(c.id, { basis: e.target.value })}
                      >
                        <option value="value">Value</option>
                        <option value="change">% Change</option>
                      </select>
                    )}
                    <select
                      className={styles.select}
                      value={c.operator}
                      onChange={(e) => updateDraftCondition(c.id, { operator: e.target.value })}
                    >
                      {METRIC_FILTER_OPERATORS.map((op) => (
                        <option key={op.value} value={op.value}>
                          {op.label}
                        </option>
                      ))}
                    </select>
                    <input
                      type="number"
                      className={styles.select}
                      style={{ width: 110 }}
                      value={c.value}
                      onChange={(e) => updateDraftCondition(c.id, { value: e.target.value === "" ? "" : Number(e.target.value) })}
                      onKeyDown={(e) => e.key === "Enter" && applyMetricFilters()}
                    />
                    {c.basis === "change" && result.meta.compareToPrevious && <span className={styles.muted}>%</span>}
                    <button
                      type="button"
                      className={styles.btnSecondary}
                      onClick={() => removeDraftCondition(c.id)}
                      aria-label="Remove filter"
                    >
                      <CloseIcon size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {result.meta.statusAvailable && availableStatuses.length > 0 && (
              <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", marginTop: 12 }}>
                <span className={styles.muted}>Status</span>
                {availableStatuses.map((s) => (
                  <label key={s} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 13 }}>
                    <input
                      type="checkbox"
                      checked={!activeView.resultFilters.statusValues || activeView.resultFilters.statusValues.includes(s)}
                      onChange={() => toggleStatus(s)}
                    />
                    {humanizeStatus(s)}
                  </label>
                ))}
              </div>
            )}
          </div>

          {activeView.viewMode === "chart" && chartableMetricKeys.length > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span className={styles.muted}>Y axis</span>
                <select
                  className={styles.select}
                  value={activeView.chartMetricKey || ""}
                  onChange={(e) =>
                    updateActive((v) => ({
                      chartMetricKey: e.target.value,
                      // A secondary metric equal to the new primary one would
                      // plot the exact same line/bar twice — clearing it
                      // avoids that silently-redundant state.
                      chartSecondaryMetricKey: v.chartSecondaryMetricKey === e.target.value ? null : v.chartSecondaryMetricKey,
                    }))
                  }
                >
                  {chartableMetricKeys.map((key) => (
                    <option key={key} value={key}>
                      {effectiveCatalog.find((m) => m.key === key)?.label || key}
                    </option>
                  ))}
                </select>
              </div>
              {/* A second Y-axis metric only makes sense where there's a
                  single series already in play for the primary one — once a
                  breakdown/multi-account result is pivoted into one line per
                  entity (ExploreChart's hasTime && multiEntity shape), "the"
                  series is already spoken for by that pivot, and the
                  previous-vs-current comparison bars aren't really "a
                  second metric" in the same sense either. ExploreChart
                  itself is the one source of truth for which shape a result
                  renders as — ignoring this prop entirely in those two
                  cases — so this control stays simple (metric count only)
                  rather than duplicating that shape logic here too. */}
              {chartableMetricKeys.length > 1 && (
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span className={styles.muted}>+ 2nd Y axis</span>
                  <select
                    className={styles.select}
                    value={activeView.chartSecondaryMetricKey || ""}
                    onChange={(e) => updateActive({ chartSecondaryMetricKey: e.target.value || null })}
                  >
                    <option value="">None</option>
                    {chartableMetricKeys
                      .filter((key) => key !== activeView.chartMetricKey)
                      .map((key) => (
                        <option key={key} value={key}>
                          {effectiveCatalog.find((m) => m.key === key)?.label || key}
                        </option>
                      ))}
                  </select>
                </div>
              )}
              {/* X axis choice only applies to a non-time-grouped chart — a
                  trend chart's X axis is inherently the date, nothing to
                  pick. */}
              {!result.meta.timeIncrement && (
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span className={styles.muted}>X axis</span>
                  <select
                    className={styles.select}
                    value={activeView.chartXAxisKey || ""}
                    onChange={(e) => updateActive({ chartXAxisKey: e.target.value })}
                  >
                    <option value="">Auto</option>
                    {leadingColumnDefs(result.meta)
                      .filter((d) => d.key !== "date")
                      .map((d) => (
                        <option key={d.key} value={d.key}>
                          {d.label}
                        </option>
                      ))}
                  </select>
                </div>
              )}
            </div>
          )}

          {activeView.viewMode === "table" ? (
            <ExploreResultsTable
              // Remounts on tab switch so SortableTable's own internal sort/
              // search/column-order/freeze state (seeded below from this
              // tab's last-saved values) genuinely belongs to this one tab,
              // instead of leaking whatever the previously-active tab left
              // behind — same instance today meant switching tabs kept the
              // old tab's search text and frozen column showing on the new
              // one's columns.
              key={activeViewId}
              rows={filteredRows}
              meta={result.meta}
              adAccounts={adAccounts}
              currencyByAccountId={currencyByAccountId}
              effectiveCatalog={effectiveCatalog}
              onActionApplied={applyEntityActionPatch}
              customMetrics={customMetrics}
              resultFilters={activeView.resultFilters}
              onOpenChildView={openChildViewFromSelection}
              compareDisplay={activeView.compareDisplay}
              tableSortKey={activeView.tableSortKey}
              tableSortDir={activeView.tableSortDir}
              tableSearch={activeView.tableSearch}
              tableColOrder={activeView.tableColOrder}
              tableFirstColFrozen={activeView.tableFirstColFrozen}
              onTableViewChange={updateActive}
            />
          ) : activeView.chartMetricKey ? (
            <ExploreChart
              rows={chartRows}
              meta={result.meta}
              chartMetricKey={activeView.chartMetricKey}
              secondaryMetricKey={activeView.chartSecondaryMetricKey}
              xAxisKey={activeView.chartXAxisKey}
              currency={chartCurrency}
              effectiveCatalog={effectiveCatalog}
            />
          ) : (
            <p className={styles.sub}>No chartable metric selected — quality rankings are table-only.</p>
          )}
        </section>
      )}
    </>
  );

  // Renders one tab button — shared between ungrouped tabs and a group's own
  // member tabs below, so both look and behave identically. `idx` is this
  // tab's position in the full `views` array (what viewTitle's "View N"
  // fallback numbers off), `groupColorKey` (if any) tints it to match its
  // group.
  function renderTabButton(v, idx, groupColorKey) {
    const isActive = v.id === activeViewId;
    const isRenaming = renamingViewId === v.id;
    const tint = groupColorKey ? groupColor(groupColorKey) : null;
    return (
      <div
        key={v.id}
        onClick={() => setActiveViewId(v.id)}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setTabMenu({ type: "tab", id: v.id, x: e.clientX, y: e.clientY });
        }}
        title={
          isRenaming
            ? undefined
            : `${viewTitle(v, adAccounts, idx)} — double-click to rename, right-click for group options`
        }
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
          background: isActive ? "var(--bg)" : tint ? tint.bg : "transparent",
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
              startRenaming(v, idx);
            }}
            style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
          >
            {viewTitle(v, adAccounts, idx)}
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
  }

  // A group's colored label chip, like Chrome's own tab-group label — click
  // opens the rename/color/collapse/ungroup/close popover (see `tabMenu`).
  function renderGroupChip(group, memberCount) {
    const tint = groupColor(group.color);
    return (
      <button
        type="button"
        key={`chip-${group.id}`}
        onClick={(e) => {
          e.stopPropagation();
          setGroupRenameDraft(group.name);
          setTabMenu((prev) =>
            prev?.type === "group" && prev.id === group.id ? null : { type: "group", id: group.id, x: e.clientX, y: e.clientY }
          );
        }}
        title={`${group.name} — click to rename, recolor, collapse, or ungroup`}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "8px 10px 8px 12px",
          cursor: "pointer",
          fontSize: 12.5,
          fontWeight: 700,
          color: "var(--t1)",
          background: tint.bg,
          border: `1px solid ${tint.border}`,
          borderBottom: "none",
          borderRadius: "10px 0 0 0",
          whiteSpace: "nowrap",
        }}
      >
        <span style={{ width: 9, height: 9, borderRadius: "50%", background: tint.border, flexShrink: 0 }} />
        {group.name}
        {group.collapsed && <span style={{ color: "var(--t3)", fontWeight: 600 }}>({memberCount})</span>}
      </button>
    );
  }

  // Walks `views` in order, clustering each group's tabs (always contiguous
  // — see moveViewNextToGroup) behind its chip, so grouped and ungrouped tabs
  // can freely interleave along the strip exactly like Chrome's own tab bar.
  // A collapsed group hides every one of its member tabs — including the
  // active one — same as Chrome itself: the result below still shows
  // whichever view is active regardless of whether its tab button is
  // visible, so collapsing the group you're currently working in is exactly
  // the case this is for (reclaiming the strip's space while still seeing
  // that tab's data), not a reason to leave it peeking out.
  function renderTabStrip() {
    const elements = [];
    let i = 0;
    while (i < views.length) {
      const v = views[i];
      if (!v.groupId) {
        elements.push(renderTabButton(v, i, null));
        i++;
        continue;
      }
      const group = groups.find((g) => g.id === v.groupId);
      let j = i;
      while (j < views.length && views[j].groupId === v.groupId) j++;
      const members = views.slice(i, j);
      const startIdx = i;
      elements.push(
        <div key={`group-${v.groupId}`} style={{ display: "flex", alignItems: "flex-end" }}>
          {group ? renderGroupChip(group, members.length) : null}
          {!group?.collapsed && members.map((m) => renderTabButton(m, startIdx + members.indexOf(m), group?.color))}
        </div>
      );
      i = j;
    }
    return elements;
  }

  // The right-click "add to / remove from group" menu on a tab, or the
  // click-to-manage popover on a group's own chip — whichever `tabMenu`
  // currently points at. Rendered fixed at the triggering click's own
  // coordinates; closed by the window click/Escape listener set up above.
  function renderTabMenu() {
    if (!tabMenu) return null;
    const menuStyle = {
      position: "fixed",
      top: tabMenu.y + 4,
      left: tabMenu.x,
      zIndex: 50,
      background: "var(--bg)",
      border: "1px solid var(--border)",
      borderRadius: 10,
      boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
      padding: 8,
      minWidth: 200,
      fontSize: 12.5,
    };
    const menuItemStyle = {
      display: "flex",
      alignItems: "center",
      gap: 8,
      width: "100%",
      textAlign: "left",
      background: "none",
      border: "none",
      padding: "6px 8px",
      borderRadius: 6,
      cursor: "pointer",
      color: "var(--t1)",
    };

    if (tabMenu.type === "tab") {
      const view = views.find((v) => v.id === tabMenu.id);
      if (!view) return null;
      return (
        <div style={menuStyle} onClick={(e) => e.stopPropagation()}>
          {view.groupId && (
            <button type="button" style={menuItemStyle} onClick={() => removeViewFromGroup(view.id)}>
              Remove from group
            </button>
          )}
          <button type="button" style={menuItemStyle} onClick={() => createGroupFromView(view.id)}>
            Add tab to new group
          </button>
          {liveGroups
            .filter((g) => g.id !== view.groupId)
            .map((g) => (
              <button key={g.id} type="button" style={menuItemStyle} onClick={() => addViewToGroup(view.id, g.id)}>
                <span
                  style={{ width: 9, height: 9, borderRadius: "50%", background: groupColor(g.color).border, flexShrink: 0 }}
                />
                Add to &quot;{g.name}&quot;
              </button>
            ))}
        </div>
      );
    }

    const group = groups.find((g) => g.id === tabMenu.id);
    if (!group) return null;
    const memberCount = views.filter((v) => v.groupId === group.id).length;
    return (
      <div style={menuStyle} onClick={(e) => e.stopPropagation()}>
        <input
          type="text"
          autoFocus
          className={styles.select}
          value={groupRenameDraft}
          onChange={(e) => setGroupRenameDraft(e.target.value)}
          onBlur={() => commitGroupRename(group.id, groupRenameDraft)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitGroupRename(group.id, groupRenameDraft);
            if (e.key === "Escape") setTabMenu(null);
          }}
          style={{ width: "100%", marginBottom: 8 }}
        />
        <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
          {GROUP_COLORS.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => recolorGroup(group.id, c.key)}
              title={c.key}
              style={{
                width: 20,
                height: 20,
                borderRadius: "50%",
                background: c.dot,
                border: group.color === c.key ? "2px solid var(--t1)" : "2px solid transparent",
                cursor: "pointer",
                padding: 0,
              }}
            />
          ))}
        </div>
        <button type="button" style={menuItemStyle} onClick={() => toggleGroupCollapsed(group.id)}>
          {group.collapsed ? "Expand group" : "Collapse group"}
        </button>
        <button type="button" style={menuItemStyle} onClick={() => ungroup(group.id)}>
          Ungroup
        </button>
        <button type="button" style={{ ...menuItemStyle, color: "var(--red)" }} onClick={() => closeGroup(group.id)}>
          Close group ({memberCount} tab{memberCount === 1 ? "" : "s"})
        </button>
      </div>
    );
  }

  // The always-visible date-range + compare control (see DateRangeMenu's own
  // comment for why it lives outside the Query & Filters panel) plus its
  // validation messages — shared by both the expanded and collapsed layouts
  // below so a performance marketer scanning several tabs can change either
  // one without the panel being open at all.
  function renderDateRangeBar() {
    return (
      <>
        <DateRangeMenu
          rangePreset={activeView.rangePreset}
          customSince={activeView.customSince}
          customUntil={activeView.customUntil}
          maxRangeDays={MAX_RANGE_DAYS}
          compareToPrevious={activeView.compareToPrevious}
          compareCustomSince={activeView.compareCustomSince}
          compareDisplay={activeView.compareDisplay}
          compareDisabled={compareDisabled}
          onApply={(patch) => {
            const nextView = { ...activeView, ...patch };
            updateActive(patch);
            // Changing the date range/compare settings is the single most
            // frequent action a performance marketer takes while scanning —
            // it should behave like Meta's own picker and refresh the table
            // immediately on "Update", not silently restage the query behind
            // a separate "Run Query" click elsewhere in the panel.
            if (isViewRunnable(nextView, effectiveCatalog)) runQueryForView(nextView, false);
          }}
        />
        {range && !rangeValid && (
          <span className={styles.sub} style={{ color: "var(--red)" }}>
            Date range cannot exceed {MAX_RANGE_DAYS} days (currently {rangeDays}).
          </span>
        )}
        {customPrevious && !customPreviousValid && (
          <span className={styles.sub} style={{ color: "var(--red)" }}>
            Comparison period can&apos;t extend into the future.
          </span>
        )}
      </>
    );
  }

  return (
    <Layout>
      <Head>
        <title>Custom Views · Facebook Auth Dashboard</title>
      </Head>
      <div className={styles.page}>
        <main className={styles.main} style={{ maxWidth: 1400, margin: "0 auto" }}>
          <h1 className={styles.h1}>Custom Views</h1>
          <p className={styles.sub} style={{ marginTop: -8 }}>
            Build any view of Facebook Ads data — pick an account, a date range (up to 365 days), a level, a
            breakdown, and whatever metrics you want, then view it as a table or chart. Keep several views open at
            once, like browser tabs — each with its own account and query.
          </p>

          {accountsError && <div className={styles.error}>Error loading ad accounts: {accountsError}</div>}

          <div
            ref={tabsRowRef}
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
            {renderTabStrip()}
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
          {renderTabMenu()}

          {queryPanelExpanded ? (
            <div className={styles.exploreLayout}>
              <div className={styles.exploreContent}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    flexWrap: "wrap",
                    marginBottom: 14,
                    position: "sticky",
                    top: tabsRowHeight,
                    zIndex: 4,
                    background: "var(--bg)",
                    paddingTop: 8,
                    paddingBottom: 8,
                  }}
                >
                  {renderDateRangeBar()}
                </div>
                {resultArea}
              </div>

              <aside
                ref={queryPanelRef}
                className={styles.exploreQueryPanel}
                style={queryPanelMaxHeight ? { maxHeight: queryPanelMaxHeight } : undefined}
              >
                <div className={`${styles.card} ${styles.exploreQueryCard}`}>
                  <div className={styles.exploreQueryHeader}>
                    <span style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, fontSize: 13 }}>
                      <SettingsIcon size={15} />
                      Query &amp; Filters
                    </span>
                    {/* No collapse control until there's a result to fall back to showing instead —
                        collapsing here would leave the page with nothing on it at all. */}
                    {!!result && (
                      <button
                        type="button"
                        className={styles.appSidebarIconBtn}
                        onClick={toggleQueryPanel}
                        title="Collapse — focus on the result"
                      >
                        <ChevronIcon direction="right" size={15} />
                      </button>
                    )}
                  </div>

                  <div className={styles.exploreQueryBody}>
                  <div>
                    <SectionHeading
                      hint={`Pick one or more accounts — results from all of them come back merged into this one view, tagged with which account each row came from (up to ${MAX_ACCOUNTS_PER_VIEW} at a time).`}
                    >
                      Account
                    </SectionHeading>
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
                    <SectionHeading hint="One breakdown at a time — Meta restricts which dimensions can combine, so these are pre-combined, known-good groups rather than a free pick-any-combination list.">
                      Breakdown
                    </SectionHeading>
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
                    <SectionHeading hint="Include or exclude any campaign, ad set, or ad whose name contains the text below — works at any Level above, not just the matching one: e.g. exclude a campaign by name while still viewing Account-level totals, and that campaign's numbers come out of the total, not just off the screen. Add as many as you like, mixing include and exclude; takes effect next time you run the query.">
                      Filter rows by name
                    </SectionHeading>
                    <div className={styles.tabGroup} style={{ marginBottom: 8 }}>
                      <button
                        type="button"
                        className={newFilterMode === "exclude" ? `${styles.tab} ${styles.tabActive}` : styles.tab}
                        onClick={() => setNewFilterMode("exclude")}
                      >
                        Exclude
                      </button>
                      <button
                        type="button"
                        className={newFilterMode === "include" ? `${styles.tab} ${styles.tabActive}` : styles.tab}
                        onClick={() => setNewFilterMode("include")}
                      >
                        Include only
                      </button>
                    </div>
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
                        {newFilterMode === "include" ? "+ Include" : "+ Exclude"}
                      </button>
                    </div>
                    {(activeView.nameFilters || []).length > 0 && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
                        {activeView.nameFilters.map((f) => (
                          <span
                            key={f.id}
                            className={f.mode === "include" ? styles.badgeGood : styles.badgeDanger}
                            style={{ display: "flex", alignItems: "center", gap: 6 }}
                          >
                            {f.mode === "include" ? "Include" : "Exclude"} — {NAME_FILTER_FIELDS.find((o) => o.field === f.field)?.label || f.field}:
                            &quot;{f.value}&quot;
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
                  </div>

                  <div>
                    <SectionHeading hint={'Paste one or more Campaign/Ad Set/Ad IDs (comma, space, or newline separated) to scope this view to exactly those entities — works at any Level above, not just the matching one, same as "Filter rows by name". Handy for jumping straight to specific campaigns or ads you spotted elsewhere (e.g. in a different date range) — see the copy icon next to each row\'s name in the results table once you have one.'}>
                      Only show these IDs
                    </SectionHeading>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-start" }}>
                      <select
                        className={styles.select}
                        value={activeView.idFilter.field}
                        onChange={(e) => updateActive((v) => ({ idFilter: { ...v.idFilter, field: e.target.value } }))}
                      >
                        {ID_FILTER_FIELDS.map((f) => (
                          <option key={f.field} value={f.field}>
                            {f.label}
                          </option>
                        ))}
                      </select>
                      <textarea
                        className={styles.select}
                        style={{ flex: 1, minWidth: 220, minHeight: 60, resize: "vertical", fontFamily: "inherit" }}
                        placeholder="e.g. 120218997000010, 120218997000020"
                        value={activeView.idFilter.value}
                        onChange={(e) => updateActive((v) => ({ idFilter: { ...v.idFilter, value: e.target.value } }))}
                      />
                      {activeView.idFilter.value.trim() && (
                        <button
                          type="button"
                          className={styles.btnSecondary}
                          onClick={() => updateActive((v) => ({ idFilter: { ...v.idFilter, value: "" } }))}
                        >
                          Clear
                        </button>
                      )}
                    </div>
                    {activeIdFilterCount > 0 && (
                      <p className={styles.sub} style={{ marginTop: 8 }}>
                        {activeIdFilterCount} ID{activeIdFilterCount === 1 ? "" : "s"} — takes effect next time you
                        run the query.
                      </p>
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
                    {customEventsLoading && (
                      <p className={styles.sub} style={{ marginTop: -4, marginBottom: 8 }}>
                        Checking for custom conversions…
                      </p>
                    )}
                    <MetricPicker
                      catalog={effectiveCatalog}
                      selectedKeys={activeView.metricKeys}
                      onToggle={toggleMetric}
                      isUnavailable={(m) => {
                        // Budget only ever comes back populated at
                        // Campaign/Ad Set level (see its own comment in
                        // lib/insightsMetrics.js) — flagged the same "still
                        // toggleable, visually dimmed" way as a
                        // rollup-unavailable metric below, rather than
                        // blocked outright, since switching Level with it
                        // already selected shouldn't silently drop it.
                        const budgetUnavailable = m.key === "budget" && activeView.level !== "campaign" && activeView.level !== "adset";
                        // Still toggleable (so an already-selected one can be
                        // turned off), but visually flagged — it'll be
                        // silently absent from the result anyway once a
                        // filter forces a rollup.
                        return (willRollup && REACH_DEPENDENT_METRIC_KEYS.has(m.key)) || budgetUnavailable;
                      }}
                      unavailableTitle={(m) =>
                        m.key === "budget" && activeView.level !== "campaign" && activeView.level !== "adset"
                          ? "Only available at Campaign or Ad Set level"
                          : "Not available while a name filter requires combining finer-grained data"
                      }
                    />
                    <div style={{ marginTop: 14 }}>
                      <p
                        className={styles.muted}
                        style={{ marginBottom: 6, display: "flex", alignItems: "center", gap: 6, position: "relative" }}
                      >
                        Custom ratio metric
                        <HelpHint text={'Define your own ratio metric (e.g. Revenue ÷ Purchases) from any two metrics above — it\'s saved on this device and shows up as a pill in every view, under "Custom".'} />
                      </p>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                        <MetricSelect options={METRIC_CATALOG} value={customMetricNumerator} onChange={setCustomMetricNumerator} placeholder="Numerator…" />
                        <span className={styles.muted}>÷</span>
                        <MetricSelect options={METRIC_CATALOG} value={customMetricDenominator} onChange={setCustomMetricDenominator} placeholder="Denominator…" />
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

                  </div>

                  <div className={styles.exploreQueryFooter}>
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
                </div>
              </aside>
            </div>
          ) : (
            <div className={styles.exploreContent}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 10,
                  flexWrap: "wrap",
                  marginBottom: 14,
                  position: "sticky",
                  top: tabsRowHeight,
                  zIndex: 4,
                  background: "var(--bg)",
                  paddingTop: 8,
                  paddingBottom: 8,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  {renderDateRangeBar()}
                  <p className={styles.sub} style={{ margin: 0 }}>
                    {summarizeQuery(activeView, adAccounts)}
                  </p>
                </div>
                <button
                  type="button"
                  className={styles.btnSecondary}
                  onClick={toggleQueryPanel}
                  style={{ display: "flex", alignItems: "center", gap: 6 }}
                >
                  <SettingsIcon size={13} />
                  Edit Query
                  <ChevronIcon direction="left" size={12} />
                </button>
              </div>
              {resultArea}
            </div>
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
// `mode: "change"` (default) shows the %-swing already computed server-side
// (`_deltaPct`); `mode: "absolute"` shows the raw difference instead, in the
// metric's own unit/format (currency, a plain count, …) — for someone who'd
// rather read "+₹4,200" than "+12.3%", or whom a %-change badge misleads
// when the previous value was tiny (a huge % swing off a near-zero base).
function DeltaBadge({ mode, deltaPct, absoluteDiff, format, currency }) {
  if (mode === "absolute") {
    if (typeof absoluteDiff !== "number") return null;
    const color = absoluteDiff > 0 ? "var(--green)" : absoluteDiff < 0 ? "var(--red)" : "var(--t2)";
    const sign = absoluteDiff > 0 ? "+" : absoluteDiff < 0 ? "−" : "";
    return (
      <div style={{ fontSize: 11, color, marginTop: 2 }}>
        {sign}
        {formatMetricValue(Math.abs(absoluteDiff), format, currency)}
      </div>
    );
  }
  if (typeof deltaPct !== "number") return null;
  const color = deltaPct > 0 ? "var(--green)" : deltaPct < 0 ? "var(--red)" : "var(--t2)";
  const arrow = deltaPct > 0 ? "▲" : deltaPct < 0 ? "▼" : "";
  return (
    <div style={{ fontSize: 11, color, marginTop: 2 }}>
      {arrow} {Math.abs(deltaPct).toFixed(1)}%
    </div>
  );
}

// Default column widths per metric format — a currency value formatted with
// an Intl symbol+grouping ("₹1,23,456.78") needs more room than a percent
// ("12.34%") or a plain rounded count, and a "text" metric (quality
// rankings like "Below Average") needs the most. Anything without a format
// in this map (shouldn't happen — every catalog/custom-metric entry sets
// one) falls back to the "number" width. Per-row values still wrap/ellipsize
// via SortableTable's own clamp if a particular value runs long regardless.
const METRIC_COLUMN_WIDTH = { currency: 115, percent: 90, decimal: 90, number: 100, text: 150 };

// Campaign → Ad Set → Ad drill-down (mirrors components/EntityDrillDown.js's
// own naming exactly, so the two features agree on what a "child level" or
// id-filter field is called — see pages/api/fb/explore-insights.js's
// ID_FILTER_FIELD_LEVEL for the backend side both of them rely on). Only a
// campaign or ad set row ever offers a drill-down; an ad is already the
// bottom of the hierarchy.
const CHILD_LEVEL = { campaign: "adset", adset: "ad" };
const CHILD_ID_FILTER_FIELD = { adset: "campaignId", ad: "adsetId" };
const CHILD_LEVEL_PLURAL = { adset: "ad sets", ad: "ads" };

// A pivoted date row's own label (see `timePivotEnabled`) — each bucket's
// `date` field is always the Meta API's `date_start` for that bucket
// (pages/api/fb/explore-insights.js), so "monthly" grouping needs its own
// month-only rendering rather than showing e.g. "Sep 1, 2026" for a bucket
// that actually spans the whole month.
function formatPivotDateLabel(iso, timeIncrement) {
  const d = new Date(`${iso}T00:00:00Z`);
  if (timeIncrement === "monthly") return d.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
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
  // Pivot mode (see `timePivotEnabled`) nests date rows under each entity
  // instead of listing them as their own column — a separate "Date" column
  // would be blank on every pivoted-parent row and redundant on every date
  // row (which already shows its date in place of the entity name).
  const pivotMode = !!meta.timeIncrement && meta.breakdownGroup === "none" && meta.level !== "account";
  if (meta.accountIds.length > 1) defs.push({ key: "accountId", label: "Account" });
  if (meta.timeIncrement && !pivotMode) defs.push({ key: "date", label: "Date" });
  if (meta.level !== "account") {
    defs.push({ key: "entityLabel", label: LEVEL_OPTIONS.find((l) => l.value === meta.level)?.label || "Name" });
  }
  if (meta.breakdownGroup !== "none") {
    defs.push({ key: "breakdownLabel", label: BREAKDOWN_GROUPS.find((g) => g.value === meta.breakdownGroup)?.label || "Breakdown" });
  }
  if (defs.length === 0) defs.push({ key: "label", label: "Total" });
  return defs;
}

function ExploreResultsTable({
  rows,
  meta,
  adAccounts,
  currencyByAccountId,
  effectiveCatalog,
  onActionApplied,
  customMetrics,
  resultFilters,
  onOpenChildView,
  compareDisplay,
  tableSortKey,
  tableSortDir,
  tableSearch,
  tableColOrder,
  tableFirstColFrozen,
  onTableViewChange,
}) {
  const allKeys = [...meta.metricKeys, ...meta.customFields];

  // Lets someone spot a few problem rows here, grab their IDs, and paste
  // them into "Only show these IDs" on a different view/date range instead
  // of re-finding each one by name. Local to this one render of the table —
  // resets whenever the query re-runs, same as SortableTable's own sort/
  // search state; there's no reason a selection should survive a new result.
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  // Defaults on — most views benefit from seeing the Total at a glance —
  // but some people want the table to just be the rows, so it's a toggle,
  // not forced. Local to this one render of the table, same as every other
  // per-result UI preference here (sort/search/freeze/selection) — it
  // resets with a fresh query, it isn't meant to be a saved setting.
  const [showTotalsRow, setShowTotalsRow] = useState(true);

  // A brief, purely perceptual loading flash whenever a filter is applied —
  // the actual filtering (see applyResultFilters/filteredRows in the parent)
  // is instant, synchronous, client-side, which read as "did that even do
  // anything?" with literally nothing changing on screen for an eye-blink
  // and then just... different rows. Skips the very first render — mounting
  // with a result already in hand isn't "a filter just got applied."
  const [filterPulse, setFilterPulse] = useState(false);
  const hasMountedRef = useRef(false);
  useEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      return;
    }
    setFilterPulse(true);
    const timer = setTimeout(() => setFilterPulse(false), 200);
    return () => clearTimeout(timer);
  }, [resultFilters]);

  function toggleSelected(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelectedIds(allSelected ? new Set() : new Set(selectableIds));
  }

  function copyText(text) {
    navigator.clipboard?.writeText(text).catch(() => {});
  }

  // Campaign → Ad Set → Ad drill-down. Only offered on a plain, one-row-per-
  // entity result (no breakdown, no time grouping — either would mean
  // several rows already share one entityId, so "expand this row" would be
  // ambiguous about which row's children to show and would try to re-fetch
  // the same children once per row). `expansions` is keyed by entityId
  // regardless of depth (every Meta id is globally unique across levels), so
  // a campaign row and a nested ad set row both found inside it live in the
  // same flat map: `{ open, status: 'loading'|'loaded'|'error', childLevel,
  // rows, error, parentRow }`. A fetch only ever happens the first time a
  // row is expanded — toggling afterwards just flips `open`, never refetches
  // (see toggleExpand), and a collapsed-but-already-fetched entry keeps its
  // `rows` cached so re-expanding is instant.
  const drillDownEnabled = !!CHILD_LEVEL[meta.level] && meta.breakdownGroup === "none" && !meta.timeIncrement;
  const [expansions, setExpansions] = useState({});
  const [lightboxItem, setLightboxItem] = useState(null);
  const [detailEntity, setDetailEntity] = useState(null);

  // Pivot mode: Level + "Group by time" together, e.g. Campaign level with
  // Daily grouping. The backend already returns one row per (entity, date)
  // pair in that combination — exactly what a trend chart needs (a line per
  // campaign) — but shown flat, a 20-campaign × 30-day result is 600
  // same-looking rows with no sense of "which day belongs to which
  // campaign" beyond re-reading the name column on every row. Pivoted here
  // instead: one row per entity, aggregated across every date it has (same
  // numbers an aggregate "no time grouping" query would return), expandable
  // to reveal that entity's own date rows — same mental model as the
  // Campaign → Ad Set drill-down above, just grouping by date instead of by
  // a finer level, and requiring no extra fetch at all (the date rows are
  // already sitting right there in `rows`, just needing to be grouped).
  // Scoped the same way `drillDownEnabled` is (no breakdown active) plus
  // "there's an actual entity to group by" (not Level: Account, where every
  // row already IS one date with nothing above it to pivot into).
  const timePivotEnabled = !!meta.timeIncrement && meta.breakdownGroup === "none" && meta.level !== "account";
  const [pivotOpenIds, setPivotOpenIds] = useState(() => new Set());
  function togglePivotOpen(entityId) {
    setPivotOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(entityId)) next.delete(entityId);
      else next.add(entityId);
      return next;
    });
  }

  // Mirrors SortableTable's own (otherwise fully internal) sort/search state
  // for the top-level rows, via its onSortChange/onSearchChange — so the
  // same sort column/direction, search term, and result filters (status
  // checkboxes, metric-threshold conditions — applied one level up in
  // pages/explore.js, passed down as `resultFilters`) the visible top-level
  // rows are under also apply to a drilled-into row's children, instead of
  // those always showing in raw API order with every status/filter ignored.
  const [childSort, setChildSort] = useState({ key: null, dir: "desc" });
  const [childSearch, setChildSearch] = useState("");
  // Mirrors which column the parent table currently has frozen — a
  // drilled-into row never creates its own "Campaign"/"Ad Set" column (it
  // reuses the same leading name column, just indented), so without this a
  // frozen Campaign column stayed pinned for top-level rows but not for the
  // child rows underneath it. `null` when nothing's frozen.
  const [childFrozenKey, setChildFrozenKey] = useState(null);
  // Mirrors the parent table's own dragged column order — same reasoning as
  // childFrozenKey above, and the same bug shape: a drilled-into row is
  // rendered by this file directly (via renderRowExtra), not by
  // SortableTable's own <tbody> loop, so without this a column drag only
  // ever reordered the top-level rows, leaving every child row's cells
  // sitting in the original column positions underneath them. Seeded from
  // `tableColOrder` (the persisted order) so a freshly-expanded row matches
  // immediately, before any drag happens in this session.
  const [childColOrder, setChildColOrder] = useState(tableColOrder);

  function applyChildRowOrdering(childRows) {
    let out = applyResultFilters(childRows, resultFilters, meta.metricKeys);
    const term = childSearch.trim().toLowerCase();
    if (term) {
      const keys = leadingColumns.map((c) => c.key);
      out = out.filter((row) => keys.some((key) => String(row[key] ?? "").toLowerCase().includes(term)));
    }
    const col = columns.find((c) => c.key === childSort.key);
    if (!col) return out;
    const getValue = col.sortValue || ((row) => row[col.key]);
    const copy = [...out];
    copy.sort((a, b) => {
      const av = getValue(a);
      const bv = getValue(b);
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "string") return childSort.dir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      return childSort.dir === "asc" ? av - bv : bv - av;
    });
    return copy;
  }

  // The exact same custom-metric/custom-event definitions (not just their
  // ids) the currently-displayed result itself was computed from — derived
  // from `meta` (what's actually on screen), never from the query panel's
  // own live form state, so an unsaved edit there can't desync a child
  // fetch's metric set from the columns already rendered for it.
  const childMetricDefs = useMemo(
    () =>
      (customMetrics || [])
        .filter((cm) => meta.metricKeys.includes(cm.id))
        .map((cm) => ({ id: cm.id, numeratorKey: cm.numeratorKey, denominatorKey: cm.denominatorKey })),
    [customMetrics, meta.metricKeys]
  );
  const childCustomEvents = useMemo(() => {
    const known = getCachedEntry(CUSTOM_EVENTS_CACHE_PREFIX + JSON.stringify([...meta.accountIds].sort()))?.data?.customEvents || [];
    return known
      .filter((ce) => meta.metricKeys.includes(ce.id))
      .map((ce) => ({ id: ce.id, accountId: ce.accountId, actionType: ce.actionType }));
  }, [meta.metricKeys, meta.accountIds]);

  // `pivotParentRows` (one aggregated row per entity) comes straight from
  // the backend's own `meta.pivotRows` — computed server-side via the same
  // `aggregateRowMetrics` the Total row uses, which needs Facebook's raw
  // per-row fields (e.g. CTR's `aggregate()` sums raw `inline_link_clicks`,
  // not anything named `ctr`/`clicks`) that simply never reach the client;
  // only already-derived display values do, so this can't be recomputed
  // here the way it first looks like it should. `pivotChildrenByEntity` is
  // the one piece that's genuinely just client-side grouping — each
  // entity's own date rows, already sitting in the already-fetched,
  // already-(resultFilters-)filtered `rows`, grouped for the expand block
  // below (and re-filtered/re-sorted there via the existing
  // `applyChildRowOrdering`, same as the ad-set drill-down's children).
  const pivotChildrenByEntity = useMemo(() => {
    if (!timePivotEnabled) return null;
    const byEntity = new Map();
    for (const row of rows) {
      if (!row.entityId) continue;
      if (!byEntity.has(row.entityId)) byEntity.set(row.entityId, []);
      byEntity.get(row.entityId).push(row);
    }
    return byEntity;
  }, [timePivotEnabled, rows]);
  const pivotParentRows = timePivotEnabled ? meta.pivotRows || [] : null;

  // What the top-level table actually renders and what "N selected"/"Select
  // all" operate over — the pivoted, one-row-per-entity rows in pivot mode
  // (so selecting "Campaign X" means exactly that, not each of its date
  // rows separately), the plain fetched rows otherwise.
  const topLevelRows = timePivotEnabled ? pivotParentRows : rows;
  const selectableRows = topLevelRows.filter((r) => r.entityId);
  // Deduplicated — a breakdown (e.g. Age & Gender) can repeat the same
  // entity across several rows, and selection is keyed by entity id, not
  // row, so "select all"/its checked state needs the unique id count, not
  // the row count.
  const selectableIds = [...new Set(selectableRows.map((r) => r.entityId))];
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selectedIds.has(id));
  const someSelected = !allSelected && selectableIds.some((id) => selectedIds.has(id));

  function startFetch(row, childLevel) {
    const id = row.entityId;
    setExpansions((prev) => ({ ...prev, [id]: { open: true, status: "loading", childLevel, rows: [], error: null, parentRow: row } }));
    fetchExploreInsights({
      accountIds: [row.accountId],
      level: childLevel,
      breakdownGroup: "none",
      metricKeys: meta.metricKeys,
      customMetrics: childMetricDefs,
      customEvents: childCustomEvents,
      idFilter: { field: CHILD_ID_FILTER_FIELD[childLevel], value: id },
      // Only an ad has a creative to show a thumbnail for.
      includeCreative: childLevel === "ad",
      since: meta.since,
      until: meta.until,
      // The exact window the parent report compared against (not
      // recomputed) when it itself requested a comparison, so a child row's
      // own delta is against the same two periods its parent's is — passing
      // along `meta.compareToPrevious` with no window would make the backend
      // default to "immediately preceding period," which is usually but not
      // always the same thing (a custom comparison start date wouldn't be).
      compareToPrevious: meta.compareToPrevious,
      previousSince: meta.compareToPrevious ? meta.previousSince : undefined,
      previousUntil: meta.compareToPrevious ? meta.previousUntil : undefined,
    })
      .then((json) => {
        setExpansions((prev) => (prev[id] ? { ...prev, [id]: { ...prev[id], status: "loaded", rows: json.rows || [] } } : prev));
      })
      .catch((err) => {
        setExpansions((prev) => (prev[id] ? { ...prev, [id]: { ...prev[id], status: "error", error: err.message } } : prev));
      });
  }

  function toggleExpand(row, level) {
    const id = row.entityId;
    const childLevel = CHILD_LEVEL[level];
    if (!id || !childLevel) return;
    const existing = expansions[id];
    if (existing) {
      setExpansions((prev) => ({ ...prev, [id]: { ...prev[id], open: !prev[id].open } }));
      return;
    }
    startFetch(row, childLevel);
  }

  // RowActions' own success callback (see components/RowActions.js) always
  // targets whichever `onActionApplied` it was given — the top-level table's
  // own `onActionApplied` prop only ever patches `rows` (the just-fetched
  // top-level result), which a drilled-into ad set/ad row was never part of.
  // This is that same patch applied to `expansions` instead: every fetched
  // child list is scanned for the matching entityId (there's exactly one
  // across the whole tree, campaign/ad set/ad ids never collide), so a
  // pause/activate/budget change on a drilled-into row shows up immediately
  // without needing to collapse and re-expand it.
  function applyChildActionPatch(entityId, patch) {
    setExpansions((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const key of Object.keys(next)) {
        const entry = next[key];
        if (entry.status !== "loaded") continue;
        const idx = entry.rows.findIndex((r) => r.entityId === entityId);
        if (idx === -1) continue;
        const rows = [...entry.rows];
        rows[idx] = { ...rows[idx], ...patch };
        next[key] = { ...entry, rows };
        changed = true;
      }
      return changed ? next : prev;
    });
  }

  const accountName = (row) => adAccounts.find((a) => a.id === row.accountId)?.name || row.accountId;
  const LEADING_MAX_WIDTH = { accountId: 200, date: 120, entityLabel: 240, breakdownLabel: 200, label: 160 };
  const leadingColumns = leadingColumnDefs(meta).map((def) => {
    if (def.key === "accountId") {
      return { ...def, maxWidth: LEADING_MAX_WIDTH.accountId, render: accountName, sortValue: accountName };
    }
    if (def.key === "entityLabel" || def.key === "label") {
      return {
        ...def,
        maxWidth: LEADING_MAX_WIDTH[def.key],
        render: (row) =>
          row.entityId ? (
            <span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
              {(drillDownEnabled || timePivotEnabled) && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (timePivotEnabled) togglePivotOpen(row.entityId);
                    else toggleExpand(row, meta.level);
                  }}
                  aria-label={
                    (timePivotEnabled ? pivotOpenIds.has(row.entityId) : expansions[row.entityId]?.open)
                      ? "Collapse"
                      : timePivotEnabled
                        ? "Show the date-by-date breakdown"
                        : `Show ${CHILD_LEVEL_PLURAL[CHILD_LEVEL[meta.level]]}`
                  }
                  title={
                    timePivotEnabled
                      ? "Show this row's own date-by-date breakdown"
                      : `Show ${CHILD_LEVEL_PLURAL[CHILD_LEVEL[meta.level]]} in this ${meta.level === "campaign" ? "campaign" : "ad set"}`
                  }
                  style={{ background: "none", border: "none", padding: 2, cursor: "pointer", color: "var(--t3)", display: "flex", flexShrink: 0 }}
                >
                  <ChevronIcon
                    direction={(timePivotEnabled ? pivotOpenIds.has(row.entityId) : expansions[row.entityId]?.open) ? "down" : "right"}
                    size={11}
                  />
                </button>
              )}
              {meta.level === "ad" && (
                <Thumb
                  src={row.thumbnailUrl}
                  isVideo={row.isVideo}
                  // `thumbnailUrl` is `undefined` (not `null`) until the
                  // background fetch in loadThumbnailsForView() resolves —
                  // `null` means it resolved and this ad genuinely has none.
                  loading={row.thumbnailUrl === undefined}
                  size={22}
                  onClick={() =>
                    setLightboxItem({ id: row.entityId, name: row[def.key] || row.entityId, thumbnailUrl: row.thumbnailUrl, isVideo: row.isVideo })
                  }
                />
              )}
              <span
                onClick={
                  timePivotEnabled
                    ? () => togglePivotOpen(row.entityId)
                    : drillDownEnabled
                      ? () => toggleExpand(row, meta.level)
                      : undefined
                }
                style={{ overflow: "hidden", textOverflow: "ellipsis", cursor: drillDownEnabled || timePivotEnabled ? "pointer" : undefined }}
              >
                {row[def.key]}
              </span>
              <CopyIdButton id={row.entityId} onCopy={copyText} />
            </span>
          ) : (
            row[def.key]
          ),
      };
    }
    return { ...def, maxWidth: LEADING_MAX_WIDTH[def.key] };
  });

  const columns = [
    ...(selectableRows.length > 0
      ? [
          {
            key: "__select",
            label: <SelectAllCheckbox checked={allSelected} indeterminate={someSelected} onChange={toggleSelectAll} />,
            maxWidth: 28,
            // A narrow checkbox column has nothing worth pinning in place —
            // freezing should default to the actual name column next to it.
            freezeExempt: true,
            render: (row) =>
              row.entityId ? (
                <input
                  type="checkbox"
                  checked={selectedIds.has(row.entityId)}
                  onChange={() => toggleSelected(row.entityId)}
                  aria-label="Select row"
                />
              ) : null,
          },
        ]
      : []),
    ...leadingColumns,
    ...(meta.statusAvailable ? [{ key: "status", label: "Status", maxWidth: 110, render: (row) => humanizeStatus(row.status) }] : []),
    ...allKeys.map((key) => {
      const metric = effectiveCatalog.find((m) => m.key === key);
      const format = metric?.format || "number";
      const label = metric?.label || key;
      const comparable = meta.compareToPrevious && format !== "text";
      return {
        key,
        label,
        align: "right",
        maxWidth: METRIC_COLUMN_WIDTH[format] || METRIC_COLUMN_WIDTH.number,
        sortValue: (row) => (typeof row[key] === "number" ? row[key] : -Infinity),
        render: (row) => {
          const currency = currencyByAccountId.get(row.accountId);
          const value = formatMetricValue(row[key], format, currency);
          if (!comparable) return value;
          const previous = row._previous?.[key];
          const absoluteDiff = typeof row[key] === "number" && typeof previous === "number" ? row[key] - previous : null;
          return (
            <div>
              <div>{value}</div>
              <DeltaBadge mode={compareDisplay} deltaPct={row._deltaPct?.[key]} absoluteDiff={absoluteDiff} format={format} currency={currency} />
            </div>
          );
        },
      };
    }),
    ...(selectableRows.length > 0
      ? [
          {
            key: "__actions",
            label: "Actions",
            maxWidth: 170,
            freezeExempt: true,
            // No entity (the pinned Total row, see totalsRow below) means
            // nothing to Pause/Activate/Change Budget.
            render: (row) =>
              row.entityId ? (
                <RowActions
                  row={row}
                  level={meta.level}
                  currency={currencyByAccountId.get(row.accountId)}
                  onActionApplied={onActionApplied}
                  onViewDetails={setDetailEntity}
                />
              ) : null,
          },
        ]
      : []),
  ];

  // Reorders `columns` by `childColOrder` for child-row rendering below —
  // the exact same reconciliation components/SortableTable.js does
  // internally for its own `orderedColumns` (a key no longer in `columns`,
  // e.g. last query's breakdown column, is just dropped; a key that's new,
  // e.g. a breakdown column that just got turned on, is placed at its
  // natural position in `columns` rather than always at the end).
  const childOrderedColumns = (() => {
    if (!childColOrder) return columns;
    const known = columns.filter((c) => childColOrder.includes(c.key)).sort((a, b) => childColOrder.indexOf(a.key) - childColOrder.indexOf(b.key));
    let i = 0;
    return columns.map((c) => (childColOrder.includes(c.key) ? known[i++] : c));
  })();

  // One drilled-into row (an ad set found inside a campaign, or an ad found
  // inside an ad set) — reuses every one of `columns`' own render functions
  // for the metric/status cells (so a child row shows exactly the same
  // formatting, currency, and metric set as its parent). Bulk-select isn't
  // offered on a child row (that feature is scoped to the top-level result
  // set), but Pause/Activate/Change Budget are — same RowActions component
  // the top-level rows use, just pointed at this row's own level and at
  // applyChildActionPatch (not the top-level onActionApplied) so a
  // successful action updates the drilled-into row in place. The leading
  // name column gets its own special-casing too: indentation, its own
  // expand toggle if it has a further child level, and an ad's thumbnail.
  function renderDataRow(row, level, depth) {
    const childLevel = CHILD_LEVEL[level];
    const isOpen = !!expansions[row.entityId]?.open;
    // Mirrors SortableTable's own frozen-cell styling exactly (see
    // components/SortableTable.js) — a drilled-into row's cells are plain
    // <td>s rendered outside SortableTable's own body loop (via
    // renderRowExtra), so the pinned column has to be reapplied here by key
    // rather than inherited.
    function frozenStyle(col) {
      return col.key === childFrozenKey
        ? { position: "sticky", left: 0, zIndex: 1, background: "var(--bg)", boxShadow: "1px 0 0 var(--border2)" }
        : null;
    }
    return (
      <tr key={row.entityId}>
        {childOrderedColumns.map((col) => {
          if (col.key === "__select") return <td key={col.key} style={frozenStyle(col)} />;
          if (col.key === "__actions") {
            return (
              <td key={col.key} style={frozenStyle(col)}>
                <RowActions
                  row={row}
                  level={level}
                  currency={currencyByAccountId.get(row.accountId)}
                  onActionApplied={applyChildActionPatch}
                  onViewDetails={setDetailEntity}
                />
              </td>
            );
          }
          if (col.key === "entityLabel" || col.key === "label") {
            return (
              <td key={col.key} style={frozenStyle(col)}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, paddingLeft: depth * 20, minWidth: 0 }}>
                  {childLevel ? (
                    <button
                      type="button"
                      onClick={() => toggleExpand(row, level)}
                      aria-label={isOpen ? "Collapse" : `Show ${CHILD_LEVEL_PLURAL[childLevel]}`}
                      style={{ background: "none", border: "none", padding: 2, cursor: "pointer", color: "var(--t3)", display: "flex", flexShrink: 0 }}
                    >
                      <ChevronIcon direction={isOpen ? "down" : "right"} size={11} />
                    </button>
                  ) : (
                    <span style={{ width: 15, flexShrink: 0 }} />
                  )}
                  {level === "ad" && (
                    <Thumb
                      src={row.thumbnailUrl}
                      isVideo={row.isVideo}
                      size={22}
                      onClick={
                        row.entityId
                          ? () =>
                              setLightboxItem({
                                id: row.entityId,
                                name: row.entityLabel || row.entityId,
                                thumbnailUrl: row.thumbnailUrl,
                                isVideo: row.isVideo,
                              })
                          : undefined
                      }
                    />
                  )}
                  <span
                    title={row.entityLabel}
                    onClick={childLevel ? () => toggleExpand(row, level) : undefined}
                    style={{
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      minWidth: 0,
                      color: level === "ad" ? "var(--t2)" : "var(--t1)",
                      cursor: childLevel ? "pointer" : undefined,
                    }}
                  >
                    {row.entityLabel}
                  </span>
                  {row.entityId && <CopyIdButton id={row.entityId} onCopy={copyText} />}
                </div>
              </td>
            );
          }
          return (
            <td key={col.key} style={{ textAlign: col.align || "left", ...frozenStyle(col) }}>
              {col.render ? col.render(row) : row[col.key]}
            </td>
          );
        })}
      </tr>
    );
  }

  // Everything currently fetched/visible under one expanded parent — a
  // single status row (loading/error/empty) or the child rows themselves,
  // each followed immediately by ITS OWN expansion block (recursing one more
  // level for an ad set's ads), all flattened into one array so they can sit
  // directly inside SortableTable's `<tbody>` via `renderRowExtra`.
  function renderChildBlock(parentId, depth) {
    const exp = expansions[parentId];
    if (!exp) return null;
    const label = CHILD_LEVEL_PLURAL[exp.childLevel] || "children";
    if (exp.status === "loading") {
      return (
        <tr key={`${parentId}-loading`}>
          <td colSpan={columns.length}>
            <Loader inline label={`Loading ${label}…`} />
          </td>
        </tr>
      );
    }
    if (exp.status === "error") {
      return (
        <tr key={`${parentId}-error`}>
          <td colSpan={columns.length}>
            <span className={styles.error} style={{ marginRight: 10 }}>
              {exp.error}
            </span>
            <button type="button" className={styles.btnSecondary} onClick={() => startFetch(exp.parentRow, exp.childLevel)}>
              Retry
            </button>
          </td>
        </tr>
      );
    }
    // Fetched (loaded) but collapsed — stays cached in `exp.rows` so
    // re-expanding doesn't refetch; just nothing to render while hidden.
    if (!exp.open) return null;
    if (exp.rows.length === 0) {
      return (
        <tr key={`${parentId}-empty`}>
          <td colSpan={columns.length}>
            <span className={styles.muted} style={{ paddingLeft: depth * 20 }}>
              No {label}.
            </span>
          </td>
        </tr>
      );
    }
    const orderedRows = applyChildRowOrdering(exp.rows);
    if (orderedRows.length === 0) {
      return (
        <tr key={`${parentId}-no-matches`}>
          <td colSpan={columns.length}>
            <span className={styles.muted} style={{ paddingLeft: depth * 20 }}>
              No {label} match the current filters.
            </span>
          </td>
        </tr>
      );
    }
    return orderedRows.map((childRow) => (
      <Fragment key={childRow.entityId}>
        {renderDataRow(childRow, exp.childLevel, depth)}
        {renderChildBlock(childRow.entityId, depth + 1)}
      </Fragment>
    ));
  }

  // One date row nested under a pivoted entity (see `timePivotEnabled`) —
  // deliberately NOT `renderDataRow` reused as-is: a date row is the same
  // entity as its parent, not a finer one, so it has no further level to
  // expand into and Pause/Activate/Change Budget (already offered on the
  // parent row) would be a confusing "pause just this one day" repeated on
  // every row otherwise. Reuses `columns`' own per-metric `render`/format
  // (so a date row's numbers look exactly like any other row's) and the same
  // frozen-column treatment as `renderDataRow`.
  function renderPivotDateRow(dateRow, depth) {
    function frozenStyle(col) {
      return col.key === childFrozenKey
        ? { position: "sticky", left: 0, zIndex: 1, background: "var(--bg)", boxShadow: "1px 0 0 var(--border2)" }
        : null;
    }
    return (
      <tr key={dateRow.date}>
        {childOrderedColumns.map((col) => {
          if (col.key === "__select" || col.key === "__actions") return <td key={col.key} style={frozenStyle(col)} />;
          if (col.key === "entityLabel" || col.key === "label") {
            return (
              <td key={col.key} style={frozenStyle(col)}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, paddingLeft: depth * 20, minWidth: 0 }}>
                  <span style={{ width: 15, flexShrink: 0 }} />
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0, color: "var(--t2)" }}>
                    {formatPivotDateLabel(dateRow.date, meta.timeIncrement)}
                  </span>
                </div>
              </td>
            );
          }
          return (
            <td key={col.key} style={{ textAlign: col.align || "left", ...frozenStyle(col) }}>
              {col.render ? col.render(dateRow) : dateRow[col.key]}
            </td>
          );
        })}
      </tr>
    );
  }

  function renderRowExtra(row) {
    if (timePivotEnabled) {
      if (!row.entityId || !pivotOpenIds.has(row.entityId)) return null;
      const dateRows = pivotChildrenByEntity.get(row.entityId) || [];
      const ordered = applyChildRowOrdering(dateRows);
      if (ordered.length === 0) {
        return (
          <tr key={`${row.entityId}-pivot-empty`}>
            <td colSpan={columns.length}>
              <span className={styles.muted} style={{ paddingLeft: 20 }}>
                No dates match the current filters.
              </span>
            </td>
          </tr>
        );
      }
      return ordered.map((dateRow) => renderPivotDateRow(dateRow, 1));
    }
    if (!drillDownEnabled || !row.entityId) return null;
    return renderChildBlock(row.entityId, 1);
  }

  return (
    <div>
      {(selectedIds.size > 0 || meta.totalsRow) && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            {selectedIds.size > 0 && (
              <>
                <span className={styles.muted}>{selectedIds.size} selected</span>
                {/* Leads the group (not trailing after Copy/Clear) and gets
                    its own emphasized treatment — this is the action most
                    people reach for after selecting a batch of rows, and it
                    used to blend into the row as just another secondary-
                    looking button. */}
                {CHILD_LEVEL[meta.level] && (
                  <button
                    type="button"
                    className={`${styles.btnPrimary} ${styles.openNewCta}`}
                    onClick={() => onOpenChildView(meta.level, [...selectedIds])}
                    title={`Open a new tab showing the ${CHILD_LEVEL_PLURAL[CHILD_LEVEL[meta.level]]} inside the selected ${
                      selectedIds.size === 1 ? meta.level : `${meta.level}s`
                    }, with the same date range, metrics, and other query settings as this view`}
                  >
                    <RocketIcon size={14} />
                    Open New
                  </button>
                )}
                <button type="button" className={styles.btnSecondary} onClick={() => copyText([...selectedIds].join(", "))}>
                  Copy {selectedIds.size} ID{selectedIds.size === 1 ? "" : "s"}
                </button>
                <button type="button" className={styles.btnSecondary} onClick={() => setSelectedIds(new Set())}>
                  Clear selection
                </button>
              </>
            )}
          </div>
          {meta.totalsRow && (
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "var(--t2)", cursor: "pointer" }}>
              <input type="checkbox" checked={showTotalsRow} onChange={(e) => setShowTotalsRow(e.target.checked)} />
              Show Total row
            </label>
          )}
        </div>
      )}
      <div style={{ overflowX: "auto", position: "relative" }}>
        {filterPulse && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: "rgba(var(--bg-rgb), 0.5)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 30,
              borderRadius: 10,
            }}
          >
            <span className={styles.spinner} />
          </div>
        )}
        <SortableTable
          rows={topLevelRows}
          columns={columns}
          defaultSortKey={tableSortKey || meta.metricKeys[0] || "label"}
          defaultSortDir={tableSortDir || "desc"}
          initialSearch={tableSearch}
          initialColOrder={tableColOrder}
          initialFirstColFrozen={tableFirstColFrozen}
          maxHeight={480}
          searchable
          searchKeys={leadingColumns.map((c) => c.key)}
          searchPlaceholder="Search rows…"
          resizableColumns
          renderRowExtra={drillDownEnabled || timePivotEnabled ? renderRowExtra : undefined}
          onSortChange={(key, dir) => {
            setChildSort({ key, dir });
            onTableViewChange?.({ tableSortKey: key, tableSortDir: dir });
          }}
          onSearchChange={(s) => {
            setChildSearch(s);
            onTableViewChange?.({ tableSearch: s });
          }}
          onFreezeChange={setChildFrozenKey}
          onColOrderChange={(order) => {
            setChildColOrder(order);
            onTableViewChange?.({ tableColOrder: order });
          }}
          onFirstColFrozenChange={(frozen) => onTableViewChange?.({ tableFirstColFrozen: frozen })}
          pinnedRow={showTotalsRow ? meta.totalsRow || undefined : undefined}
          highlightRow={(row) => !!row.entityId && selectedIds.has(row.entityId)}
        />
      </div>
      <CreativeLightbox item={lightboxItem} onClose={() => setLightboxItem(null)} />
      <EntityDetailDrawer entity={detailEntity} onClose={() => setDetailEntity(null)} />
    </div>
  );
}

// Small inline "copy this one ID" control used in the results table's
// leading name column — flashes a checkmark for a moment so clicking it
// gives some feedback beyond the silent clipboard write.
// Lives in the "__select" column's own header (a <th> that otherwise toggles
// sort on click, see SortableTable) — stopPropagation keeps a click on the
// checkbox from also re-sorting the table underneath it.
function SelectAllCheckbox({ checked, indeterminate, onChange }) {
  return (
    <input
      type="checkbox"
      ref={(el) => {
        if (el) el.indeterminate = indeterminate;
      }}
      checked={checked}
      onChange={onChange}
      onClick={(e) => e.stopPropagation()}
      aria-label="Select all rows"
    />
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
  if (meta.statusAvailable) header.push("Status");
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
    if (meta.statusAvailable) line.push(humanizeStatus(row.status));
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
