import { useState } from "react";
import Loader from "./Loader";
import Thumb from "./Thumb";
import CreativeLightbox from "./CreativeLightbox";
import { ChevronIcon } from "./icons";
import WindowComparisonTable, { DEFAULT_COMPARISON_METRIC_KEYS } from "./WindowComparisonTable";
import { formatMetricValue, buildEffectiveCatalog } from "@/lib/insightsMetrics";
import { getCachedEntry, setCachedEntry } from "@/lib/clientCache";
import styles from "@/styles/Home.module.css";

// Built-ins only (no account-specific custom metrics/custom conversions
// here) — keeps each row's RCA table a single, fast, uncustomizable fetch
// instead of a second metric picker nested inside an already-nested drawer.
const DRILLDOWN_CATALOG = buildEffectiveCatalog([], []);
const DRILLDOWN_CACHE_PREFIX = "recent-changes-drilldown-investigate:";

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

// A fixed, always-available "recent performance" window — deliberately not
// tied to the change being investigated (which can be anywhere from today
// to months ago, and whose own "Since Change" window can be as short as a
// single day), so this always shows a stable, comparable 30 days no matter
// which change led here.
function last30DaysRange() {
  const until = addDaysUTC(isoDateUTC(new Date()), -1);
  return { since: addDaysUTC(until, -29), until };
}

async function fetchChildren({ accountId, level, idField, parentId }) {
  const { since, until } = last30DaysRange();
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
  const json = await res.json();
  if (json.error) throw new Error(json.error);
  return json.rows || [];
}

// Fetches the same 6-window before/after comparison components/InvestigateDrawer.js
// shows for the top-level changed entity, but for one child row (an ad set or
// ad found inside it) — anchored to that same original change's `eventTime`,
// so "Since Change"/"N Days Before" line up with the change being
// investigated rather than each row picking its own reference point. Cached
// client-side the same way InvestigateDrawer's own fetch is, keyed by entity
// + eventTime (metric set here is fixed, so it doesn't need to be part of
// the key).
async function fetchRowWindows({ entityId, level, eventTime }) {
  const cacheKey = `${DRILLDOWN_CACHE_PREFIX}${entityId}:${eventTime}`;
  const cached = getCachedEntry(cacheKey);
  if (cached) return cached.data.windows;
  const params = new URLSearchParams({
    objectId: entityId,
    level,
    eventTime,
    metricKeys: DEFAULT_COMPARISON_METRIC_KEYS.join(","),
  });
  const res = await fetch(`/api/fb/recent-changes/investigate?${params.toString()}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error);
  setCachedEntry(cacheKey, json);
  return json.windows;
}

// A breadcrumb trail of "children of X" cards — components/InvestigateDrawer.js
// mounts this with `key={change.id}` so switching to a different change
// remounts it fresh rather than carrying over a previous change's drilled-in
// state. `stack[i]` is one fetched level: `{ level, parentId, parentLabel,
// rows, loading, error, sort, visibleCount, collapsedIds, rowWindows }`;
// only the last entry's cards are shown, with earlier entries available as
// clickable breadcrumb labels. Every visible row's RCA comparison is open by
// default (`collapsedIds` tracks the rare row someone explicitly collapsed,
// an opt-OUT set rather than opt-in) so a reviewer sees every ad's own
// before/after at a glance instead of having to expand each one by hand.
// `rowWindows` caches each row's own fetched comparison data
// (`{ [entityId]: { loading, error, windows } }`) so collapsing and
// re-expanding a row doesn't always refetch.
export default function EntityDrillDown({ accountId, currency, parentLevel, parentObjectId, parentLabel, eventTime }) {
  const [stack, setStack] = useState([]);
  const [lightboxItem, setLightboxItem] = useState(null);

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
    fetchChildren({ accountId, level, idField: CHILD_ID_FILTER_FIELD[level], parentId: forParentId })
      .then((rows) => {
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

  // Kicks off (and caches) the before/after fetch for whichever rows just
  // became visible/expanded and don't have it yet — called after the
  // initial load, every "Load 10 more", every sort change, and whenever a
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
      fetchRowWindows({ entityId: row.entityId, level, eventTime })
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
  const sortedRows = current.rows ? sortRows(current.rows, current.sort) : [];
  const visibleRows = sortedRows.slice(0, current.visibleCount);

  function handleSortChange(sortKey) {
    updateCurrent({ sort: sortKey, visibleCount: PAGE_SIZE });
    loadRowWindows(current.level, sortRows(current.rows || [], sortKey).slice(0, PAGE_SIZE));
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
          {CHILD_LEVEL_PLURAL[current.level]} · Last 30 Days
        </p>
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

      {current.loading && <Loader label={`Loading ${CHILD_LEVEL_PLURAL[current.level].toLowerCase()}…`} />}
      {current.error && <div className={styles.error}>{current.error}</div>}
      {!current.loading && !current.error && sortedRows.length === 0 && (
        <p className={styles.sub}>No {CHILD_LEVEL_PLURAL[current.level].toLowerCase()} with delivery in the last 30 days.</p>
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
                      <p style={{ fontWeight: 600, fontSize: 13.5, margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {row.entityLabel || "—"}
                      </p>
                      <p className={styles.muted} style={{ margin: 0, fontSize: 12 }}>
                        Spend: <strong>{formatMetricValue(row.spend, "currency", currency)}</strong> · ROAS:{" "}
                        <strong>{formatMetricValue(row.roas, "decimal", currency)}</strong>
                      </p>
                    </div>
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
                  {isExpanded && (
                    <div>
                      {rowWindowState?.loading && <Loader label="Loading before/after comparison…" />}
                      {rowWindowState?.error && <div className={styles.error}>{rowWindowState.error}</div>}
                      {rowWindowState && !rowWindowState.loading && !rowWindowState.error && (
                        <WindowComparisonTable
                          windows={rowWindowState.windows}
                          metricKeys={DEFAULT_COMPARISON_METRIC_KEYS}
                          catalog={DRILLDOWN_CATALOG}
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
    </div>
  );
}
