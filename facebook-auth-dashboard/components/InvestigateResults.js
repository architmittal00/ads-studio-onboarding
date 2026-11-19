import { useEffect, useMemo, useState } from "react";
import EntityDrillDown from "./EntityDrillDown";
import WindowComparisonTable, { DEFAULT_COMPARISON_METRIC_KEYS } from "./WindowComparisonTable";
import DailyBreakdownTable from "./DailyBreakdownTable";
import { buildEffectiveCatalog } from "@/lib/insightsMetrics";
import { getCachedEntry, setCachedEntry } from "@/lib/clientCache";
import { getCustomMetrics } from "@/lib/clientStorage";
import { fetchCustomEvents } from "@/lib/customEvents";
import { parseJsonResponse } from "@/lib/fetchJson";
import styles from "@/styles/Home.module.css";

// Same cache and endpoint family whichever Investigate screen asks (Recent Changes, Custom Views, Monitor): the numbers for
// a day are identical everywhere. The daily view caches under its own prefix.
const CACHE_PREFIX = "recent-changes-investigate:";
const DAILY_CACHE_PREFIX = "recent-changes-investigate-daily:";
const CACHE_MAX_ENTRIES = 40;

const VIEWS = [
  { key: "windows", label: "Before / After" },
  { key: "daily", label: "Day by day" },
];

// Any moment inside a calendar day resolves to the same day on the server; noon UTC avoids every midnight edge.
export const dayAnchorEventTime = (dateStr) => `${dateStr}T12:00:00.000Z`;

// Everything every Investigate screen shows below its own date control: the Before / After vs Day by day switch, the metric
// picker, the entity's table, and the drill-down into the ad sets / ads inside it. Mount it with a key scoped to the
// entity and day so a different one starts fresh.
// entity: { level, entityId, entityName, accountId }; date: YYYY-MM-DD
export default function InvestigateResults({ entity, date, currency, launchedAdIds, pausedAdIds }) {
  const [view, setView] = useState("windows");
  const [selectedKeys, setSelectedKeys] = useState(DEFAULT_COMPARISON_METRIC_KEYS);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const [customMetrics] = useState(() => getCustomMetrics());
  const [customEvents, setCustomEvents] = useState([]);
  useEffect(() => {
    if (!entity?.accountId) return;
    let cancelled = false;
    fetchCustomEvents([entity.accountId]).then((events) => {
      if (!cancelled) setCustomEvents(events);
    });
    return () => {
      cancelled = true;
    };
  }, [entity?.accountId]);
  const effectiveCatalog = useMemo(() => buildEffectiveCatalog(customMetrics, customEvents), [customMetrics, customEvents]);
  const eventTime = dayAnchorEventTime(date);

  useEffect(() => {
    if (selectedKeys.length === 0) return;
    const prefix = view === "daily" ? DAILY_CACHE_PREFIX : CACHE_PREFIX;
    const sortedKeys = [...selectedKeys].sort();
    const cacheKey = `${prefix}${entity.entityId}:${eventTime}:${sortedKeys.join(",")}`;
    const cached = getCachedEntry(cacheKey);
    if (cached) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- a cache hit is still a reaction to the view / metrics changing
      setData(cached.data);
      setError(null);
      return;
    }
    let cancelled = false;
    setData(null);
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ objectId: entity.entityId, level: entity.level, eventTime, metricKeys: sortedKeys.join(",") });
    if (view === "daily") params.set("mode", "daily");
    const pickedCustomMetrics = customMetrics.filter((cm) => sortedKeys.includes(cm.id)).map((cm) => ({ id: cm.id, numeratorKey: cm.numeratorKey, denominatorKey: cm.denominatorKey }));
    if (pickedCustomMetrics.length > 0) params.set("customMetrics", JSON.stringify(pickedCustomMetrics));
    const pickedCustomEvents = customEvents.filter((ce) => sortedKeys.includes(ce.id)).map((ce) => ({ id: ce.id, accountId: ce.accountId, actionType: ce.actionType }));
    if (pickedCustomEvents.length > 0) params.set("customEvents", JSON.stringify(pickedCustomEvents));
    fetch(`/api/fb/recent-changes/investigate?${params.toString()}`)
      .then(parseJsonResponse)
      .then((json) => {
        if (cancelled) return;
        if (json.error) {
          setError(json.error);
          return;
        }
        setData(json);
        setCachedEntry(cacheKey, json, { prefix, maxEntriesForPrefix: CACHE_MAX_ENTRIES });
      })
      .catch((err) => !cancelled && setError(err.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [entity.entityId, entity.level, eventTime, view, selectedKeys, customMetrics, customEvents]);

  const toggleMetric = (key) => setSelectedKeys((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));

  return (
    <>
      <div style={{ marginTop: 18, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <p className={styles.muted} style={{ margin: 0 }}>
          View
        </p>
        <div className={styles.tabGroup}>
          {VIEWS.map((v) => (
            <button key={v.key} type="button" className={view === v.key ? `${styles.tab} ${styles.tabActive}` : styles.tab} onClick={() => setView(v.key)}>
              {v.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ marginTop: 14 }}>
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
                style={{ cursor: "pointer", background: selected ? undefined : "transparent", border: selected ? undefined : "1px dashed var(--border)", color: selected ? undefined : "var(--t2)" }}
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
          {view === "daily" ? (
            <DailyBreakdownTable days={data?.days} changeDay={data?.changeDay ?? date} today={data?.today} metricKeys={selectedKeys} catalog={effectiveCatalog} loading={loading} currency={currency} />
          ) : (
            <WindowComparisonTable windows={data?.windows} metricKeys={selectedKeys} catalog={effectiveCatalog} loading={loading} currency={currency} />
          )}
        </div>
      )}

      <EntityDrillDown
        key={`${entity.entityId}:${date}`}
        accountId={entity.accountId}
        currency={currency}
        parentLevel={entity.level}
        parentObjectId={entity.entityId}
        parentLabel={entity.entityName || entity.entityId}
        eventTime={eventTime}
        metricKeys={selectedKeys}
        catalog={effectiveCatalog}
        customMetrics={customMetrics}
        customEvents={customEvents}
        view={view}
        launchedAdIds={launchedAdIds}
        pausedAdIds={pausedAdIds}
      />
    </>
  );
}
