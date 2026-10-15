import { useEffect, useRef, useState } from "react";
import Loader from "./Loader";
import Thumb from "./Thumb";
import CreativeLightbox from "./CreativeLightbox";
import RowActions from "./RowActions";
import EntityDetailDrawer from "./EntityDetailDrawer";
import { ChevronIcon } from "./icons";
import WindowComparisonTable from "./WindowComparisonTable";
import { formatMetricValue, humanizeStatus } from "@/lib/insightsMetrics";
import { getCachedEntry, setCachedEntry } from "@/lib/clientCache";
import { parseJsonResponse } from "@/lib/fetchJson";
import styles from "@/styles/Home.module.css";

const DRILLDOWN_CACHE_PREFIX = "recent-changes-drilldown-investigate:";
// Keep in sync with lib/clientCache.js's KNOWN_CACHE_FAMILIES entry for this
// same prefix — that registry is what a one-time sweep on app load enforces,
// this is what keeps it bounded between sweeps within one long session.
const DRILLDOWN_CACHE_MAX_ENTRIES = 40;

const PAGE_SIZE = 10;

// One level down from "campaign" is "adset"; one level down from "adset" is
// "ad" — "ad" has no further children, so a row at that level never offers
// another drill-down step. Mirrors pages/api/fb/explore-insights.js's own
// ID_FILTER_FIELD_LEVEL naming (lowercase, no "Id" suffix) for the `level`
// values themselves; the id-filter *field* names it expects are the
// camelCase ones in CHILD_ID_FILTER_FIELD below.
const CHILD_LEVEL = { campaign: "adset", adset: "ad" };
const CHILD_ID_FILTER_FIELD = { adset: "campaignId", ad: "adsetId" };
const CHILD_LEVEL_PLURAL = { adset: "Ad Sets", ad: "Ads" };

const SORT_OPTIONS = [
  { key: "spend_desc", label: "Highest Spend" },
  { key: "roas_desc", label: "Highest Performer (ROAS)" },
  { key: "roas_asc", label: "Lowest Performer (ROAS)" },
];

// ACTIVE reads as the one unambiguously "good" state; everything else
// (Paused, Archived, Pending Review, Disapproved, ...) is lumped together as
// a muted/neutral badge rather than trying to assign good/bad to Facebook's
// full review-pipeline vocabulary.
function statusBadgeClass(status) {
  return status === "ACTIVE" ? styles.badgeGood : styles.badgeInfo;
}

function sortRows(rows, sortKey) {
  const sorted = [...rows];
  switch (sortKey) {
    case "roas_desc":
      sorted.sort((a, b) => (b.roas ?? -Infinity) - (a.roas ?? -Infinity));
      break;
    case "roas_asc":
      sorted.sort((a, b) => (a.roas ?? Infinity) - (b.roas ?? Infinity));
      break;
    case "spend_desc":
    default:
      sorted.sort((a, b) => (b.spend ?? -Infinity) - (a.spend ?? -Infinity));
      break;
  }
  return sorted;
}

function isoDateUTC(date) {
  return date.toISOString().slice(0, 10);
}

function addDaysUTC(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return isoDateUTC(d);
}

// Mirrors pages/api/fb/recent-changes/investigate.js's own buildWindows()
// sinceChange calculation exactly (always through *today*, degrading to the
// change's own day only when the change happened today itself) — so
// "highest spend"/"highest performer" here means the same thing as the
// "Since Change" column in every comparison table on this page, and always
// has a valid window to rank by (never "too recent," unlike before PR #187
// made sinceChange itself always-available the same way).
function sinceChangeRange(eventTime) {
  const changeDay = isoDateUTC(new Date(eventTime));
  const today = isoDateUTC(new Date());
  const since = addDaysUTC(changeDay, 1);
  return { since: since <= today ? since : changeDay, until: today };
}

// /api/fb/explore-insights always streams newline-delimited JSON once
// validation passes (one or more `{type:"progress",...}` lines, then one
// final `{type:"done", rows, meta}` or `{type:"done", error}` line) — never a
// single plain JSON body, see that handler's own writeHead comment. A plain
// `res.json()` here used to throw a raw "Unexpected non-whitespace character
// after JSON" parse error (tripping over the first `\n`) the moment this hit
// a real response with more than one line, which only ever showed up against
// a real account rather than this drill-down's own earlier, smaller mocked
// tests. Mirrors pages/explore.js's own fetchExploreInsights reader exactly;
// progress events are simply ignored here since this fetch is always small
// enough not to need a progress indicator of its own.
async function readExploreInsightsStream(res) {
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
      if (event.type === "done") finalResult = event;
    }
  }
  if (!finalResult) throw new Error("Request ended unexpectedly");
  if (finalResult.error) throw new Error(finalResult.error);
  return finalResult;
}

async function fetchChildren({ accountId, level, idField, parentId, eventTime }) {
  const { since, until } = sinceChangeRange(eventTime);
  const res = await fetch("/api/fb/explore-insights", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      accountIds: [accountId],
      level,
      breakdownGroup: "none",
      metricKeys: ["spend", "roas"],
      idFilter: { field: idField, value: parentId },
      // Ads have a creative to show a thumbnail for; campaigns/ad sets don't
      // — see pages/api/fb/explore-insights.js's own includeCreative gate.
      includeCreative: level === "ad",
      since,
      until,
    }),
  });
  const json = await readExploreInsightsStream(res);
  return { rows: json.rows || [] };
}

// Fetches the same before/after window comparison components/EntityChangesDrawer.js
// shows for the top-level changed entity, but for one child row (an ad set or
// ad found inside it) — anchored to that same original change's `eventTime`,
// and over the SAME metric selection the Investigate drawer's own picker
// currently has (so a metric added/removed up there shows up down here too,
// and vice versa). Cached client-side the same way, keyed by entity +
// eventTime + the exact metric selection (sorted, so selection order
// doesn't matter).
async function fetchRowWindows({ entityId, level, eventTime, metricKeys, customMetrics, customEvents }) {
  const sortedKeys = [...metricKeys].sort();
  const cacheKey = `${DRILLDOWN_CACHE_PREFIX}${entityId}:${eventTime}:${sortedKeys.join(",")}`;
  const cached = getCachedEntry(cacheKey);
  if (cached) return cached.data.windows;
  const params = new URLSearchParams({ objectId: entityId, level, eventTime, metricKeys: sortedKeys.join(",") });
  const selectedCustomMetrics = customMetrics
    .filter((cm) => sortedKeys.includes(cm.id))
    .map((cm) => ({ id: cm.id, numeratorKey: cm.numeratorKey, denominatorKey: cm.denominatorKey }));
  if (selectedCustomMetrics.length > 0) params.set("customMetrics", JSON.stringify(selectedCustomMetrics));
  const selectedCustomEvents = customEvents
    .filter((ce) => sortedKeys.includes(ce.id))
    .map((ce) => ({ id: ce.id, accountId: ce.accountId, actionType: ce.actionType }));
  if (selectedCustomEvents.length > 0) params.set("customEvents", JSON.stringify(selectedCustomEvents));
  const res = await fetch(`/api/fb/recent-changes/investigate?${params.toString()}`);
  const json = await parseJsonResponse(res);
  if (json.error) throw new Error(json.error);
  setCachedEntry(cacheKey, json, { prefix: DRILLDOWN_CACHE_PREFIX, maxEntriesForPrefix: DRILLDOWN_CACHE_MAX_ENTRIES });
  return json.windows;
}

// A breadcrumb trail of "children of X" cards — the caller mounts this with
// a key scoped to the current change/day so switching to a different one
// remounts it fresh rather than carrying over a previous change's drilled-in
// state, and passes its own current metric selection (`metricKeys`/`catalog`/
// `customMetrics`/`customEvents`) straight through so both levels of this
// drawer always show the exact same metrics. `stack[i]` is one fetched
// level: `{ level, parentId, parentLabel, rows, loading, error, sort,
// visibleCount, collapsedIds, rowWindows }`; only the last entry's cards are
// shown, with earlier entries available as clickable breadcrumb labels.
// Every visible row's RCA comparison is open by default (`collapsedIds`
// tracks the rare row someone explicitly collapsed, an opt-OUT set rather
// than opt-in) so a reviewer sees every ad's own before/after at a glance
// instead of having to expand each one by hand. `rowWindows` caches each
// row's own fetched comparison data (`{ [entityId]: { loading, error,
// windows } }`) so collapsing and re-expanding a row doesn't always refetch.
export default function EntityDrillDown({
  accountId,
  currency,
  parentLevel,
  parentObjectId,
  parentLabel,
  eventTime,
  metricKeys,
  catalog,
  customMetrics,
  customEvents,
  launchedAdIds = [],
}) {
  const [stack, setStack] = useState([]);
  const [lightboxItem, setLightboxItem] = useState(null);
  // Read-only "View Details" drawer, same component/convention as Explore's
  // own RowActions + EntityDetailDrawer pairing.
  const [detailEntity, setDetailEntity] = useState(null);
  // Narrows the "ad" level down to just the ads launched as part of the day
  // being investigated, when there were any — off by default (every ad
  // shown) so turning it on is a deliberate choice, not a surprise filter.
  const [onlyLaunched, setOnlyLaunched] = useState(false);
  const launchedAdIdSet = new Set(launchedAdIds);

  // Kicks off (and caches) the before/after fetch for whichever rows just
  // became visible/expanded and don't have it yet — called after the
  // initial load, every "Load 10 more", every sort change, a metric
  // selection change (see the effect below), and whenever a
  // previously-collapsed row is re-expanded. Always targets the current
  // (last) stack entry, same convention as the rest of this component.
  function loadRowWindows(level, rows) {
    const pending = rows.filter((r) => r.entityId);
    if (pending.length === 0) return;
    setStack((prev) =>
      prev.map((e, i) =>
        i === prev.length - 1
          ? {
              ...e,
              rowWindows: {
                ...e.rowWindows,
                ...Object.fromEntries(
                  pending.filter((r) => !e.rowWindows[r.entityId]).map((r) => [r.entityId, { loading: true, error: null, windows: null }])
                ),
              },
            }
          : e
      )
    );
    for (const row of pending) {
      fetchRowWindows({ entityId: row.entityId, level, eventTime, metricKeys, customMetrics, customEvents })
        .then((windows) => {
          setStack((prev) =>
            prev.map((e, i) =>
              i === prev.length - 1 ? { ...e, rowWindows: { ...e.rowWindows, [row.entityId]: { loading: false, error: null, windows } } } : e
            )
          );
        })
        .catch((err) => {
          setStack((prev) =>
            prev.map((e, i) =>
              i === prev.length - 1
                ? { ...e, rowWindows: { ...e.rowWindows, [row.entityId]: { loading: false, error: err.message, windows: null } } }
                : e
            )
          );
        });
    }
  }

  // The Investigate drawer's own metric picker can change at any time while
  // a drill-down is already open (no remount — `key={change.id}` only
  // resets this component when the *change* itself changes) — when it does,
  // every row's already-fetched comparison was computed for the old metric
  // set and needs to be thrown away and re-fetched for the currently
  // visible, non-collapsed rows under the new one.
  const metricKeysSignature = [...metricKeys].sort().join(",");
  const prevMetricKeysSignatureRef = useRef(metricKeysSignature);
  useEffect(() => {
    if (prevMetricKeysSignatureRef.current === metricKeysSignature) return;
    prevMetricKeysSignatureRef.current = metricKeysSignature;
    if (stack.length === 0) return;
    const idx = stack.length - 1;
    const entry = stack[idx];
    // Clearing the now-stale (wrong metric set) cached comparisons and
    // kicking off a fresh fetch for them are both genuine reactions to an
    // external input (the drawer's own metric picker) changing — not state
    // derivable from props/state on render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStack((prev) => prev.map((e, i) => (i === idx ? { ...e, rowWindows: {} } : e)));
    const sorted = sortRows(entry.rows || [], entry.sort);
    const visible = sorted.slice(0, entry.visibleCount);
    loadRowWindows(
      entry.level,
      visible.filter((r) => r.entityId && !entry.collapsedIds.has(r.entityId))
    );
    // Only the metric selection itself should re-trigger this — `stack`
    // changing (sorting, paging, expanding) is handled by its own call
    // sites below, not this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metricKeysSignature]);

  function pushLevel(level, forParentId, forParentLabel) {
    setStack((prev) => [
      ...prev,
      {
        level,
        parentId: forParentId,
        parentLabel: forParentLabel,
        rows: null,
        loading: true,
        error: null,
        sort: "spend_desc",
        visibleCount: PAGE_SIZE,
        collapsedIds: new Set(),
        rowWindows: {},
      },
    ]);
    fetchChildren({ accountId, level, idField: CHILD_ID_FILTER_FIELD[level], parentId: forParentId, eventTime })
      .then(({ rows }) => {
        setStack((prev) => prev.map((entry, i) => (i === prev.length - 1 ? { ...entry, rows, loading: false } : entry)));
        loadRowWindows(level, sortRows(rows, "spend_desc").slice(0, PAGE_SIZE));
      })
      .catch((err) => {
        setStack((prev) => prev.map((entry, i) => (i === prev.length - 1 ? { ...entry, error: err.message, loading: false } : entry)));
      });
  }

  function updateCurrent(patch) {
    setStack((prev) => prev.map((entry, i) => (i === prev.length - 1 ? { ...entry, ...patch } : entry)));
  }

  // Merges a RowActions result (Pause/Activate/Change Budget) into this
  // row's own cached data in place — same pattern as pages/explore.js's own
  // applyChildActionPatch, scanning every stack entry (not just the current
  // one) since a row acted on could in principle belong to an earlier,
  // now-collapsed breadcrumb level.
  function applyRowActionPatch(entityId, patch) {
    setStack((prev) =>
      prev.map((entry) => ({
        ...entry,
        rows: entry.rows ? entry.rows.map((r) => (r.entityId === entityId ? { ...r, ...patch } : r)) : entry.rows,
      }))
    );
  }

  function toggleRow(entry, row) {
    const entityId = row.entityId;
    if (!entityId) return;
    const wasCollapsed = entry.collapsedIds.has(entityId);
    const nextCollapsed = new Set(entry.collapsedIds);
    if (wasCollapsed) nextCollapsed.delete(entityId);
    else nextCollapsed.add(entityId);
    updateCurrent({ collapsedIds: nextCollapsed });
    if (wasCollapsed && !entry.rowWindows[entityId]) loadRowWindows(entry.level, [row]);
  }

  if (stack.length === 0) {
    const childLevel = CHILD_LEVEL[parentLevel];
    if (!childLevel) return null;
    return (
      <div style={{ marginTop: 24 }}>
        <button
          type="button"
          className={styles.btnSecondary}
          onClick={() => pushLevel(childLevel, parentObjectId, parentLabel)}
        >
          View {CHILD_LEVEL_PLURAL[childLevel]} in this {parentLevel === "campaign" ? "Campaign" : "Ad Set"}
        </button>
      </div>
    );
  }

  const current = stack[stack.length - 1];
  const childLevel = CHILD_LEVEL[current.level];
  const showLaunchedToggle = current.level === "ad" && launchedAdIdSet.size > 0;

  function applyFilter(rows, onlyLaunchedFlag) {
    if (!showLaunchedToggle || !onlyLaunchedFlag) return rows;
    return rows.filter((r) => r.entityId && launchedAdIdSet.has(r.entityId));
  }

  const sortedRows = current.rows ? applyFilter(sortRows(current.rows, current.sort), onlyLaunched) : [];
  const visibleRows = sortedRows.slice(0, current.visibleCount);

  function handleSortChange(sortKey) {
    updateCurrent({ sort: sortKey, visibleCount: PAGE_SIZE });
    loadRowWindows(current.level, applyFilter(sortRows(current.rows || [], sortKey), onlyLaunched).slice(0, PAGE_SIZE));
  }

  function handleToggleOnlyLaunched() {
    const next = !onlyLaunched;
    setOnlyLaunched(next);
    updateCurrent({ visibleCount: PAGE_SIZE });
    loadRowWindows(current.level, applyFilter(sortRows(current.rows || [], current.sort), next).slice(0, PAGE_SIZE));
  }

  function handleLoadMore() {
    const nextVisibleCount = current.visibleCount + PAGE_SIZE;
    updateCurrent({ visibleCount: nextVisibleCount });
    loadRowWindows(current.level, sortedRows.slice(0, nextVisibleCount));
  }

  return (
    <div style={{ marginTop: 24 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap", marginBottom: 10 }}>
        {stack.map((entry, i) => {
          const isLast = i === stack.length - 1;
          return (
            <span key={i} style={{ display: "flex", alignItems: "center", gap: 4 }}>
              {i > 0 && <ChevronIcon direction="right" size={10} />}
              {isLast ? (
                <strong style={{ fontSize: 12.5 }}>{entry.parentLabel}</strong>
              ) : (
                <button
                  type="button"
                  onClick={() => setStack(stack.slice(0, i + 1))}
                  style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "var(--purple)", fontSize: 12.5 }}
                >
                  {entry.parentLabel}
                </button>
              )}
            </span>
          );
        })}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
        <p className={styles.muted} style={{ margin: 0 }}>
          {CHILD_LEVEL_PLURAL[current.level]} · Since Change
        </p>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {showLaunchedToggle && (
            <div className={styles.tabGroup}>
              <button
                type="button"
                className={!onlyLaunched ? `${styles.tab} ${styles.tabActive}` : styles.tab}
                onClick={() => onlyLaunched && handleToggleOnlyLaunched()}
              >
                All Ads
              </button>
              <button
                type="button"
                className={onlyLaunched ? `${styles.tab} ${styles.tabActive}` : styles.tab}
                onClick={() => !onlyLaunched && handleToggleOnlyLaunched()}
              >
                Launched This Day ({launchedAdIdSet.size})
              </button>
            </div>
          )}
          <div className={styles.tabGroup}>
            {SORT_OPTIONS.map((opt) => (
              <button
                key={opt.key}
                type="button"
                className={current.sort === opt.key ? `${styles.tab} ${styles.tabActive}` : styles.tab}
                onClick={() => handleSortChange(opt.key)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {current.loading && <Loader label={`Loading ${CHILD_LEVEL_PLURAL[current.level].toLowerCase()}…`} />}
      {current.error && <div className={styles.error}>{current.error}</div>}
      {!current.loading && !current.error && sortedRows.length === 0 && (
        <p className={styles.sub}>
          {onlyLaunched
            ? "None of the ads launched this day had any delivery since the change."
            : `No ${CHILD_LEVEL_PLURAL[current.level].toLowerCase()} with delivery since the change.`}
        </p>
      )}

      {!current.loading && !current.error && sortedRows.length > 0 && (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {visibleRows.map((row) => {
              const entityId = row.entityId;
              const isExpanded = !!entityId && !current.collapsedIds.has(entityId);
              const rowWindowState = entityId ? current.rowWindows[entityId] : null;
              return (
                <div key={entityId || row.entityLabel} className={styles.card} style={{ padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    {current.level === "ad" && (
                      <Thumb
                        src={row.thumbnailUrl}
                        isVideo={row.isVideo}
                        size={36}
                        onClick={
                          entityId
                            ? () =>
                                setLightboxItem({
                                  id: entityId,
                                  name: row.entityLabel || entityId,
                                  thumbnailUrl: row.thumbnailUrl,
                                  isVideo: row.isVideo,
                                })
                            : undefined
                        }
                      />
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <p style={{ fontWeight: 600, fontSize: 13.5, margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {row.entityLabel || "—"}
                        </p>
                        {row.status && (
                          <span className={statusBadgeClass(row.status)} style={{ flexShrink: 0 }}>
                            {humanizeStatus(row.status)}
                          </span>
                        )}
                      </div>
                      <p className={styles.muted} style={{ margin: 0, fontSize: 12 }}>
                        Spend: <strong>{formatMetricValue(row.spend, "currency", currency)}</strong> · ROAS:{" "}
                        <strong>{formatMetricValue(row.roas, "decimal", currency)}</strong>
                      </p>
                    </div>
                    {entityId && (
                      <RowActions
                        row={row}
                        level={current.level}
                        currency={currency}
                        onActionApplied={applyRowActionPatch}
                        onViewDetails={setDetailEntity}
                      />
                    )}
                    {childLevel && entityId && (
                      <button
                        type="button"
                        className={styles.btnSecondary}
                        style={{ padding: "3px 8px", fontSize: 10.5, flexShrink: 0 }}
                        onClick={() => pushLevel(childLevel, entityId, row.entityLabel || entityId)}
                      >
                        View {CHILD_LEVEL_PLURAL[childLevel]}
                      </button>
                    )}
                    {entityId && (
                      <button
                        type="button"
                        onClick={() => toggleRow(current, row)}
                        aria-label={isExpanded ? "Collapse RCA breakdown" : "Expand RCA breakdown"}
                        title="Compare this entity's own before/after metrics around the change"
                        style={{ background: "none", border: "none", padding: 4, cursor: "pointer", color: "var(--t2)", display: "flex", flexShrink: 0 }}
                      >
                        <ChevronIcon direction={isExpanded ? "down" : "right"} size={12} />
                      </button>
                    )}
                  </div>
                  {isExpanded && metricKeys.length > 0 && (
                    <div>
                      {rowWindowState?.loading && <Loader label="Loading before/after comparison…" />}
                      {rowWindowState?.error && <div className={styles.error}>{rowWindowState.error}</div>}
                      {rowWindowState && !rowWindowState.loading && !rowWindowState.error && (
                        <WindowComparisonTable
                          windows={rowWindowState.windows}
                          metricKeys={metricKeys}
                          catalog={catalog}
                          loading={false}
                          currency={currency}
                        />
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {current.visibleCount < sortedRows.length ? (
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 16 }}>
              <button type="button" className={styles.btnSecondary} onClick={handleLoadMore}>
                Load 10 more
              </button>
              <span className={styles.muted}>
                {current.visibleCount} of {sortedRows.length} shown
              </span>
            </div>
          ) : (
            sortedRows.length > PAGE_SIZE && (
              <p className={styles.muted} style={{ marginTop: 16 }}>
                All {sortedRows.length} shown
              </p>
            )
          )}
        </>
      )}

      <CreativeLightbox item={lightboxItem} onClose={() => setLightboxItem(null)} />
      <EntityDetailDrawer entity={detailEntity} onClose={() => setDetailEntity(null)} />
    </div>
  );
}
