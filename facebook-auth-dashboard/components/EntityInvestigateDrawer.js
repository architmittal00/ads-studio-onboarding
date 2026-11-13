import { useEffect, useMemo, useState } from "react";
import EntityDrillDown from "./EntityDrillDown";
import WindowComparisonTable, { DEFAULT_COMPARISON_METRIC_KEYS } from "./WindowComparisonTable";
import CopyIdButton from "./CopyIdButton";
import { CloseIcon } from "./icons";
import { buildEffectiveCatalog, humanizeStatus } from "@/lib/insightsMetrics";
import { getCachedEntry, setCachedEntry } from "@/lib/clientCache";
import { getCustomMetrics } from "@/lib/clientStorage";
import { fetchCustomEvents } from "@/lib/customEvents";
import { parseJsonResponse } from "@/lib/fetchJson";
import styles from "@/styles/Home.module.css";

// Same cache and endpoint as Recent Changes' Investigate view (components/EntityChangesDrawer.js): the numbers for a
// date are identical whichever screen asked.
const CACHE_PREFIX = "recent-changes-investigate:";
const CACHE_MAX_ENTRIES = 40;
const LEVEL_LABEL = { campaign: "Campaign", adset: "Ad Set" };

const pad = (n) => String(n).padStart(2, "0");
const localDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// Any moment inside a calendar day resolves to the same day on the server; noon UTC avoids every midnight edge.
const dayAnchorEventTime = (dateStr) => `${dateStr}T12:00:00.000Z`;

function formatDayLabel(dateStr) {
  return new Date(`${dateStr}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

// Custom Views' "Investigate": the Recent Changes investigation for any campaign or ad set, with the day picked by the
// user instead of being the day a change happened. Everything below the date — the metric picker, the before/after
// comparison windows, and the drill-down into the ads inside — is the same as there.
// entity: { level: "campaign" | "adset", entityId, entityName, accountId, status }
export default function EntityInvestigateDrawer({ entity, onClose, currency }) {
  const [date, setDate] = useState("");
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

  // A different row opened: start again from an empty date.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resets the drawer's own state when the entity prop changes
    setDate("");
    setData(null);
    setError(null);
  }, [entity?.level, entity?.entityId]);

  useEffect(() => {
    if (!entity) return;
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [entity, onClose]);

  useEffect(() => {
    if (!entity || !date || selectedKeys.length === 0) return;
    const eventTime = dayAnchorEventTime(date);
    const sortedKeys = [...selectedKeys].sort();
    const cacheKey = `${CACHE_PREFIX}${entity.entityId}:${eventTime}:${sortedKeys.join(",")}`;
    const cached = getCachedEntry(cacheKey);
    if (cached) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- a cache hit is still a reaction to the date / metrics changing
      setData(cached.data);
      setError(null);
      return;
    }
    let cancelled = false;
    setData(null);
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ objectId: entity.entityId, level: entity.level, eventTime, metricKeys: sortedKeys.join(",") });
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
        setCachedEntry(cacheKey, json, { prefix: CACHE_PREFIX, maxEntriesForPrefix: CACHE_MAX_ENTRIES });
      })
      .catch((err) => !cancelled && setError(err.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [entity, date, selectedKeys, customMetrics, customEvents]);

  if (!entity) return null;

  const toggleMetric = (key) => setSelectedKeys((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  const today = localDate(new Date());

  return (
    <div className={styles.drawerOverlay} onClick={onClose}>
      <div className={styles.drawerPanel} onClick={(e) => e.stopPropagation()} style={{ display: "flex", flexDirection: "column", padding: 0, overflowY: "hidden" }}>
        <div style={{ flexShrink: 0, padding: "28px 28px 0" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <p className={styles.muted} style={{ margin: 0 }}>
              Investigate · {LEVEL_LABEL[entity.level] || "Entity"}
            </p>
            <button type="button" onClick={onClose} aria-label="Close" className={styles.btnSecondary} style={{ padding: 6 }}>
              <CloseIcon size={14} />
            </button>
          </div>
          <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 8 }}>
            <h2 className={styles.h2} style={{ marginBottom: 4 }}>
              {entity.entityName || entity.entityId}
            </h2>
            <CopyIdButton id={entity.entityId} />
            {entity.status && <span className={entity.status === "ACTIVE" ? styles.badgeGood : styles.badgeInfo}>{humanizeStatus(entity.status)}</span>}
          </div>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "0 28px 28px" }}>
          <div className={styles.card} style={{ marginTop: 20, padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
            <label htmlFor="investigate-date" style={{ fontWeight: 700, fontSize: 13 }}>
              Date to investigate
            </label>
            <input id="investigate-date" className={styles.select} type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} style={{ width: 200 }} />
            <p className={styles.sub} style={{ margin: 0 }}>
              Pick the day something changed. The 1, 3 and 7 days before it are compared with what came after.
            </p>
          </div>

          {!date && (
            <p className={styles.sub} style={{ marginTop: 18 }}>
              Choose a date to see how performance moved around it.
            </p>
          )}

          {date && (
            <>
              <p className={styles.sub} style={{ marginTop: 18 }}>
                {formatDayLabel(date)}
              </p>
              <div style={{ marginTop: 6 }}>
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
                  <WindowComparisonTable windows={data?.windows} metricKeys={selectedKeys} catalog={effectiveCatalog} loading={loading} currency={currency} />
                </div>
              )}

              <EntityDrillDown
                key={`${entity.entityId}:${date}`}
                accountId={entity.accountId}
                currency={currency}
                parentLevel={entity.level}
                parentObjectId={entity.entityId}
                parentLabel={entity.entityName || entity.entityId}
                eventTime={dayAnchorEventTime(date)}
                metricKeys={selectedKeys}
                catalog={effectiveCatalog}
                customMetrics={customMetrics}
                customEvents={customEvents}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
