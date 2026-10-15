import { useEffect, useMemo, useState } from "react";
import EntityDrillDown from "./EntityDrillDown";
import WindowComparisonTable, { DEFAULT_COMPARISON_METRIC_KEYS } from "./WindowComparisonTable";
import { CloseIcon, ChevronIcon } from "./icons";
import { buildEffectiveCatalog } from "@/lib/insightsMetrics";
import { describeChangeDetail } from "@/lib/activityChangeDetail";
import { getCachedEntry, setCachedEntry } from "@/lib/clientCache";
import { getCustomMetrics } from "@/lib/clientStorage";
import { fetchCustomEvents } from "@/lib/customEvents";
import styles from "@/styles/Home.module.css";

// Same investigate-fetch cache as components/InvestigateDrawer.js — this
// drawer calls the exact same /api/fb/recent-changes/investigate endpoint,
// just anchored at a day (see dayAnchorEventTime below) instead of one
// change's own precise timestamp, so sharing the prefix/cache is correct,
// not just convenient.
const CACHE_PREFIX = "recent-changes-investigate:";
const CACHE_MAX_ENTRIES = 40;

const DEFAULT_METRIC_KEYS = DEFAULT_COMPARISON_METRIC_KEYS;

const LEVEL_LABEL = { campaign: "Campaign", adset: "Ad Set" };

// Color-codes each tracked action the same way pages/recent-changes.js's own
// CATEGORY_BADGE does (budget = warn, a pause/stop = danger, a launch =
// good) — gives the change list a scannable signal at a glance instead of
// every entry reading as plain bold text.
const ACTION_BADGE_CLASS = {
  ad_launched: "badgeGood",
  ad_paused: "badgeDanger",
  adset_paused: "badgeDanger",
  campaign_paused: "badgeDanger",
  adset_budget_change: "badgeWarn",
  campaign_budget_change: "badgeWarn",
};

// A list of changes is capped at this height and scrolls internally — keeps
// a day with many changes (e.g. 8 ads paused at once) from pushing
// everything else in the drawer far down the page.
const CHANGE_LIST_MAX_HEIGHT = 240;

function isoDateOf(iso) {
  return iso ? iso.slice(0, 10) : null;
}

// Any timestamp within a given calendar day resolves to the same
// "changeDay" in /api/fb/recent-changes/investigate.js's own buildWindows()
// (it truncates via isoDate()) — constructing a clean noon-UTC anchor here
// (rather than reusing one specific change's real timestamp) sidesteps any
// near-midnight edge case entirely.
function dayAnchorEventTime(dateStr) {
  return `${dateStr}T12:00:00.000Z`;
}

// Groups one entity's full change list (already fetched, see
// pages/new-recent-changes.js) into one line item per calendar day that had
// at least one change — several changes on the same day collapse into a
// single investigatable row, per the original ask ("3 ads launched + a
// budget change on one day shows as 1 line, a change 2 days earlier is a
// separate line"). Newest day first.
function groupByDay(changes) {
  const byDay = new Map();
  for (const change of changes) {
    const date = isoDateOf(change.eventTime);
    if (!date) continue;
    if (!byDay.has(date)) byDay.set(date, []);
    byDay.get(date).push(change);
  }
  return [...byDay.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([date, dayChanges]) => ({ date, changes: dayChanges }));
}

function relativeAndAbsolute(iso) {
  if (!iso) return { relative: "—", absolute: undefined };
  const date = new Date(iso);
  const mins = Math.round((Date.now() - date.getTime()) / 60000);
  let relative;
  if (mins < 1) relative = "just now";
  else if (mins < 60) relative = `${mins}m ago`;
  else if (mins < 1440) relative = `${Math.round(mins / 60)}h ago`;
  else relative = `${Math.round(mins / 1440)}d ago`;
  return { relative, absolute: date.toLocaleString() };
}

function formatDayLabel(dateStr) {
  return new Date(`${dateStr}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

// One change within a day group's own list — the actual object it happened
// to (sourceObjectName) is shown as the subject, not the bucket entity's own
// name, so "Ad 'Summer Sale' launched" reads correctly inside an Ad Set's
// day group whose own name is the ad set's, not the ad's. The action itself
// is a color-coded badge (see ACTION_BADGE_CLASS) rather than plain bold
// text, so a long list of mixed changes is scannable at a glance.
function ChangeLine({ change }) {
  const detail = describeChangeDetail(change.rawExtraData);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span className={styles[ACTION_BADGE_CLASS[change.action]] || styles.badgeInfo} style={{ fontSize: 10.5, flexShrink: 0 }}>
          {change.actionLabel}
        </span>
        <p style={{ margin: 0, fontSize: 12.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {change.sourceObjectName || change.sourceObjectId}
        </p>
      </div>
      {detail && (
        <p className={styles.sub} style={{ margin: 0, fontSize: 12 }}>
          {detail.from} → {detail.to}
        </p>
      )}
      <p className={styles.muted} style={{ margin: 0, fontSize: 11 }}>
        By {change.actorName} · {relativeAndAbsolute(change.eventTime).relative}
      </p>
    </div>
  );
}

// A day's (or a day group's) change list, with a small tab row filtering by
// action type when more than one kind of change happened — "indicating how
// many of these changes were added," per the ask — and a bounded, internally
// scrolling list underneath so e.g. 8 "Ad Paused" entries don't dominate the
// drawer. Each call site (the landing day-card list and the Investigate
// view's "Changes that day" list) gets its own independent filter, since
// each is its own component instance keyed by day.
function DayChangesList({ changes }) {
  const [filter, setFilter] = useState("all");

  const counts = useMemo(() => {
    const byAction = new Map();
    for (const change of changes) {
      if (!byAction.has(change.action)) byAction.set(change.action, { action: change.action, label: change.actionLabel, count: 0 });
      byAction.get(change.action).count++;
    }
    return [...byAction.values()].sort((a, b) => b.count - a.count);
  }, [changes]);

  const visible = filter === "all" ? changes : changes.filter((c) => c.action === filter);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {counts.length > 1 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          <button
            type="button"
            onClick={() => setFilter("all")}
            className={filter === "all" ? `${styles.tab} ${styles.tabActive}` : styles.tab}
            style={{ padding: "4px 10px", fontSize: 11 }}
          >
            All ({changes.length})
          </button>
          {counts.map((c) => (
            <button
              key={c.action}
              type="button"
              onClick={() => setFilter(c.action)}
              className={filter === c.action ? `${styles.tab} ${styles.tabActive}` : styles.tab}
              style={{ padding: "4px 10px", fontSize: 11 }}
            >
              {c.label} ({c.count})
            </button>
          ))}
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 10, maxHeight: CHANGE_LIST_MAX_HEIGHT, overflowY: "auto", paddingRight: 4 }}>
        {visible.map((change) => (
          <ChangeLine key={change.id} change={change} />
        ))}
      </div>
    </div>
  );
}

// Read-only "what happened to this entity, grouped by day" drawer for the
// "New Recent Changes" page — a simpler, narrower sibling of
// components/InvestigateDrawer.js (which stays untouched; the original
// Recent Changes page still uses it for one-change-at-a-time investigation).
// Two internal "pages," not two stacked drawers: the day list (default), and
// — once a day's "Investigate" is clicked — the same metric-picker +
// WindowComparisonTable + EntityDrillDown combination InvestigateDrawer
// shows, anchored at that whole day rather than one precise change time.
export default function EntityChangesDrawer({ entity, onClose, currency }) {
  const [investigatingDay, setInvestigatingDay] = useState(null);
  const [selectedKeys, setSelectedKeys] = useState(DEFAULT_METRIC_KEYS);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const [customMetrics] = useState(() => getCustomMetrics());
  const [customEvents, setCustomEvents] = useState([]);
  useEffect(() => {
    if (!entity?.accountId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clearing stale events from a previously-opened entity's account, not derivable from props/state
      setCustomEvents([]);
      return;
    }
    let cancelled = false;
    fetchCustomEvents([entity.accountId]).then((events) => {
      if (!cancelled) setCustomEvents(events);
    });
    return () => {
      cancelled = true;
    };
  }, [entity?.accountId]);
  const effectiveCatalog = useMemo(() => buildEffectiveCatalog(customMetrics, customEvents), [customMetrics, customEvents]);

  useEffect(() => {
    if (!entity) return;
    function handleKey(e) {
      if (e.key === "Escape") {
        if (investigatingDay) setInvestigatingDay(null);
        else onClose();
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [entity, investigatingDay, onClose]);

  // Resets to the day list whenever a different entity is opened — this
  // component isn't remounted between entities (no `key` at the call site),
  // so a previously-drilled-into day shouldn't carry over.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- genuine reset of drawer navigation state when the entity prop itself changes, not derivable from render
    setInvestigatingDay(null);
  }, [entity?.level, entity?.entityId]);

  useEffect(() => {
    // `entity` can go null (the drawer closing) in the same render where
    // `investigatingDay` is still the old truthy value from before the
    // sibling reset effect above clears it — that reset is itself only
    // scheduled, not yet applied, when this effect runs in the same commit,
    // so both conditions need checking here independently.
    if (!investigatingDay || !entity) return;
    const eventTime = dayAnchorEventTime(investigatingDay.date);
    const sortedKeys = [...selectedKeys].sort();
    const cacheKey = `${CACHE_PREFIX}${entity.entityId}:${eventTime}:${sortedKeys.join(",")}`;
    const cached = getCachedEntry(cacheKey);
    if (cached) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- a cache hit resolving synchronously is still a genuine reaction to investigatingDay/selectedKeys changing, not derivable from render
      setData(cached.data);
      setError(null);
      return;
    }
    setData(null);
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({
      objectId: entity.entityId,
      level: entity.level,
      eventTime,
      metricKeys: sortedKeys.join(","),
    });
    const selectedCustomMetrics = customMetrics
      .filter((cm) => sortedKeys.includes(cm.id))
      .map((cm) => ({ id: cm.id, numeratorKey: cm.numeratorKey, denominatorKey: cm.denominatorKey }));
    if (selectedCustomMetrics.length > 0) params.set("customMetrics", JSON.stringify(selectedCustomMetrics));
    const selectedCustomEvents = customEvents
      .filter((ce) => sortedKeys.includes(ce.id))
      .map((ce) => ({ id: ce.id, accountId: ce.accountId, actionType: ce.actionType }));
    if (selectedCustomEvents.length > 0) params.set("customEvents", JSON.stringify(selectedCustomEvents));
    fetch(`/api/fb/recent-changes/investigate?${params.toString()}`)
      .then((res) => res.json())
      .then((json) => {
        if (json.error) {
          setError(json.error);
          return;
        }
        setData(json);
        setCachedEntry(cacheKey, json, { prefix: CACHE_PREFIX, maxEntriesForPrefix: CACHE_MAX_ENTRIES });
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [investigatingDay, entity, selectedKeys, customMetrics, customEvents]);

  if (!entity) return null;

  function toggleMetric(key) {
    setSelectedKeys((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }

  const levelLabel = LEVEL_LABEL[entity.level] || "Entity";
  const dayGroups = groupByDay(entity.changes);

  return (
    <div className={styles.drawerOverlay} onClick={onClose}>
      <div className={styles.drawerPanel} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            {investigatingDay ? (
              <button
                type="button"
                onClick={() => setInvestigatingDay(null)}
                className={styles.btnSecondary}
                style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, marginBottom: 10 }}
              >
                <ChevronIcon direction="left" size={12} />
                Back to {entity.entityName || "this entity"}&apos;s changes
              </button>
            ) : (
              <p className={styles.muted} style={{ marginBottom: 2 }}>
                {levelLabel}
              </p>
            )}
            <h2 className={styles.h2} style={{ marginBottom: 4 }}>
              {entity.entityName || entity.entityId}
            </h2>
            {investigatingDay && <p className={styles.sub}>{formatDayLabel(investigatingDay.date)}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className={styles.btnSecondary} style={{ padding: 6 }}>
            <CloseIcon size={14} />
          </button>
        </div>

        {!investigatingDay && (
          <div style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 14 }}>
            {dayGroups.length === 0 && <p className={styles.sub}>No changes in the selected time window.</p>}
            {dayGroups.map((group) => (
              <div key={group.date} className={styles.card} style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                  <p style={{ margin: 0, fontWeight: 700, fontSize: 13 }}>{formatDayLabel(group.date)}</p>
                  <button type="button" className={styles.btnSecondary} onClick={() => setInvestigatingDay(group)}>
                    Investigate
                  </button>
                </div>
                <DayChangesList changes={group.changes} />
              </div>
            ))}
          </div>
        )}

        {investigatingDay && (
          <>
            <div style={{ marginTop: 20 }}>
              <p className={styles.muted} style={{ marginBottom: 6 }}>
                Changes that day
              </p>
              <DayChangesList changes={investigatingDay.changes} />
            </div>

            <div style={{ marginTop: 24 }}>
              <p className={styles.muted} style={{ marginBottom: 6 }}>
                Metrics
              </p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {effectiveCatalog.map((m) => {
                  const selected = selectedKeys.includes(m.key);
                  return (
                    <button
                      key={m.key}
                      type="button"
                      onClick={() => toggleMetric(m.key)}
                      className={selected ? styles.badgeInfo : styles.pill}
                      style={{
                        cursor: "pointer",
                        background: selected ? undefined : "transparent",
                        border: selected ? undefined : "1px dashed var(--border)",
                        color: selected ? undefined : "var(--t2)",
                      }}
                    >
                      {m.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {error && (
              <div className={styles.error} style={{ marginTop: 16 }}>
                {error}
              </div>
            )}

            {selectedKeys.length === 0 && (
              <p className={styles.sub} style={{ marginTop: 16 }}>
                Pick at least one metric above.
              </p>
            )}

            {!error && selectedKeys.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <WindowComparisonTable
                  windows={data?.windows}
                  metricKeys={selectedKeys}
                  catalog={effectiveCatalog}
                  loading={loading}
                  currency={currency}
                />
              </div>
            )}

            <EntityDrillDown
              key={`${entity.entityId}:${investigatingDay.date}`}
              accountId={entity.accountId}
              currency={currency}
              parentLevel={entity.level}
              parentObjectId={entity.entityId}
              parentLabel={entity.entityName || entity.entityId}
              eventTime={dayAnchorEventTime(investigatingDay.date)}
              metricKeys={selectedKeys}
              catalog={effectiveCatalog}
              customMetrics={customMetrics}
              customEvents={customEvents}
            />
          </>
        )}
      </div>
    </div>
  );
}
