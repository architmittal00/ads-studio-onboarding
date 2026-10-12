import { useEffect, useMemo, useState } from "react";
import Loader from "./Loader";
import EntityDrillDown from "./EntityDrillDown";
import { CloseIcon, ChevronIcon } from "./icons";
import {
  RATE_METRIC_KEYS,
  LOWER_IS_BETTER_METRIC_KEYS,
  isUnitMetric,
  buildEffectiveCatalog,
  formatMetricValue,
} from "@/lib/insightsMetrics";
import { describeChangeDetail } from "@/lib/activityChangeDetail";
import { getCachedEntry, setCachedEntry } from "@/lib/clientCache";
import { getCustomMetrics } from "@/lib/clientStorage";
import { fetchCustomEvents } from "@/lib/customEvents";
import styles from "@/styles/Home.module.css";

const CACHE_PREFIX = "recent-changes-investigate:";

const DEFAULT_METRIC_KEYS = ["spend", "purchases", "cost_per_purchase", "roas"];

// Most recent → least recent, left to right: the two "right now" snapshots
// first, then the change's own cumulative total (which can be short or very
// long depending on how long ago the change happened), then progressively
// further back in time relative to the change itself.
const WINDOW_ORDER = ["last3Days", "last7Days", "sinceChange", "oneDayBefore", "threeDaysBefore", "sevenDaysBefore"];
const WINDOW_LABEL = {
  last3Days: "Last 3 Days",
  last7Days: "Last 7 Days",
  sinceChange: "Since Change",
  oneDayBefore: "1 Day Before",
  threeDaysBefore: "3 Days Before",
  sevenDaysBefore: "7 Days Before",
};

// Additive metrics (a genuine total over the window — Spend, Purchases, …)
// need dividing by the window's own day-count before two different-length
// windows are actually comparable at a glance — a 7-day Spend total next to
// a 1-day one is 7x larger for no interesting reason. Rate/ratio metrics
// (percent/decimal format — ROAS, CTR — plus the currency-format ones in
// RATE_METRIC_KEYS, like Cost Per Purchase, which are already "cost ÷
// something" and would get silently diluted by a second division) are
// window-independent and shown as-is.
function normalizedValue(metric, rawValue, days) {
  if (rawValue == null) return null;
  const isAdditiveTotal = (metric.format === "number" || metric.format === "currency") && !RATE_METRIC_KEYS.has(metric.key);
  if (isAdditiveTotal && days > 1) return rawValue / days;
  return rawValue;
}

function levelParam(level) {
  return level === "Campaign" ? "campaign" : "adset";
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

const CATEGORY_ACCENT = {
  budget: "var(--amber)",
  status: "var(--blue)",
  created: "var(--green)",
  name: "var(--blue)",
  other: "var(--t2)",
};

export default function InvestigateDrawer({ change, onClose, currency }) {
  const [selectedKeys, setSelectedKeys] = useState(DEFAULT_METRIC_KEYS);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [rawOpen, setRawOpen] = useState(false);

  // User-defined ratio metrics (global, same lib/clientStorage.js list
  // Explore's own metric picker reads) and this change's own account's
  // discovered CAPI/pixel Custom Conversions (see lib/customEvents.js) —
  // merged into the metric picker and the comparison table the same way
  // pages/explore.js already does, so a metric set up there is selectable
  // here too, not just the built-in catalog.
  const [customMetrics] = useState(() => getCustomMetrics());
  const [customEvents, setCustomEvents] = useState([]);
  useEffect(() => {
    if (!change?.accountId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clearing stale events from a previously-investigated change's account, not derivable from props/state
      setCustomEvents([]);
      return;
    }
    let cancelled = false;
    fetchCustomEvents([change.accountId]).then((events) => {
      if (!cancelled) setCustomEvents(events);
    });
    return () => {
      cancelled = true;
    };
  }, [change?.accountId]);
  const effectiveCatalog = useMemo(() => buildEffectiveCatalog(customMetrics, customEvents), [customMetrics, customEvents]);

  useEffect(() => {
    if (!change) return;
    function handleKey(e) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [change, onClose]);

  useEffect(() => {
    if (!change) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resets the raw-JSON disclosure and any stale data/error from a previously-investigated change, not derivable from props/state
    setRawOpen(false);
    const sortedKeys = [...selectedKeys].sort();
    const cacheKey = `${CACHE_PREFIX}${change.objectId}:${change.eventTime}:${sortedKeys.join(",")}`;
    const cached = getCachedEntry(cacheKey);
    if (cached) {
      setData(cached.data);
      setError(null);
      return;
    }
    setData(null);
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({
      objectId: change.objectId,
      level: levelParam(change.level),
      eventTime: change.eventTime,
      metricKeys: sortedKeys.join(","),
    });
    // The backend has no localStorage/account access of its own — a selected
    // custom metric or custom event's full definition (not just its id)
    // has to travel with the request, same as Explore's own
    // buildQuerySpecFromView does for its POST body.
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
        setCachedEntry(cacheKey, json);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [change, selectedKeys, customMetrics, customEvents]);

  if (!change) return null;

  function toggleMetric(key) {
    setSelectedKeys((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }

  const { relative, absolute } = relativeAndAbsolute(change.eventTime);
  const changeDetail = describeChangeDetail(change.rawExtraData);
  const accent = CATEGORY_ACCENT[change.category] || CATEGORY_ACCENT.other;

  return (
    <div className={styles.drawerOverlay} onClick={onClose}>
      <div className={styles.drawerPanel} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div style={{ borderLeft: `3px solid ${accent}`, paddingLeft: 12 }}>
            <p className={styles.muted} style={{ marginBottom: 2 }}>
              {change.level} · {change.categoryLabel}
            </p>
            <h2 className={styles.h2} style={{ marginBottom: 4 }}>
              {change.objectName || change.objectId}
            </h2>
            <p className={styles.sub} style={{ marginBottom: 2 }}>
              {change.description}
            </p>
            <p className={styles.muted}>
              By {change.actorName} · <span title={absolute}>{relative}</span>
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className={styles.btnSecondary} style={{ padding: 6 }}>
            <CloseIcon size={14} />
          </button>
        </div>

        {changeDetail && (
          <p className={styles.sub} style={{ marginTop: 12 }}>
            Changed: <strong>{changeDetail.from}</strong> → <strong>{changeDetail.to}</strong>
          </p>
        )}

        {!changeDetail && change.rawExtraData && (
          <div style={{ marginTop: 12 }}>
            <button
              type="button"
              onClick={() => setRawOpen((o) => !o)}
              style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "none", border: "none", cursor: "pointer", color: "var(--t2)", fontSize: 12, padding: 0 }}
            >
              <ChevronIcon direction={rawOpen ? "up" : "down"} size={10} />
              {rawOpen ? "Hide" : "Show"} raw change detail
            </button>
            <p className={styles.muted} style={{ marginTop: 2 }}>
              Facebook didn&apos;t return a simple before/after value for this change type.
            </p>
            {rawOpen && (
              <pre
                style={{
                  marginTop: 8,
                  padding: 10,
                  background: "rgba(var(--surface-tint-rgb), 0.05)",
                  borderRadius: 8,
                  fontSize: 11,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-all",
                  color: "var(--t2)",
                }}
              >
                {JSON.stringify(change.rawExtraData, null, 2)}
              </pre>
            )}
          </div>
        )}

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
          <div style={{ overflowX: "auto", marginTop: 16 }}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Metric</th>
                  {WINDOW_ORDER.map((name) => {
                    const w = data?.windows[name];
                    return (
                      <th key={name} className={name === "sinceChange" ? styles.drawerSinceChangeCol : undefined}>
                        {WINDOW_LABEL[name]}
                        {w && !w.tooRecent && <span className={styles.muted}> ({w.days}d)</span>}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {selectedKeys.map((key) => {
                  const metric = effectiveCatalog.find((m) => m.key === key);
                  if (!metric) return null;
                  const unit = isUnitMetric(metric);
                  const lowerIsBetter = LOWER_IS_BETTER_METRIC_KEYS.has(metric.key);

                  // Pre-compute every window's displayed value once, so the
                  // best/worst comparison below (unit metrics only — see
                  // lib/insightsMetrics.js's isUnitMetric comment for why an
                  // additive total like Spend isn't a fair apples-to-apples
                  // comparison across different-length windows the way a
                  // rate like ROAS/CPR is) reads the exact same numbers the
                  // cells render, never a second, possibly-divergent one. A
                  // window that's too recent or overlaps the change (mixes
                  // pre- and post-change delivery — see buildWindows' own
                  // comment in the API route) is excluded from the
                  // comparison entirely, the same way it's excluded from the
                  // rendered value.
                  const cellValues = WINDOW_ORDER.map((name) => {
                    const w = data?.windows[name];
                    if (!w || w.tooRecent || w.overlapsChange) return null;
                    return normalizedValue(metric, w.metrics?.[key], w.days);
                  });
                  let bestValue = null;
                  let worstValue = null;
                  if (unit && !loading) {
                    const numeric = cellValues.filter((v) => typeof v === "number" && !isNaN(v));
                    if (numeric.length > 1) {
                      const max = Math.max(...numeric);
                      const min = Math.min(...numeric);
                      if (max !== min) {
                        bestValue = lowerIsBetter ? min : max;
                        worstValue = lowerIsBetter ? max : min;
                      }
                    }
                  }

                  return (
                    <tr key={key}>
                      <td>{metric.label}</td>
                      {WINDOW_ORDER.map((name, i) => {
                        const cellClass = name === "sinceChange" ? styles.drawerSinceChangeCol : undefined;
                        if (loading) {
                          return (
                            <td key={name} className={cellClass}>
                              <Loader inline />
                            </td>
                          );
                        }
                        const w = data?.windows[name];
                        if (!w) return <td key={name} className={cellClass}>—</td>;
                        if (w.tooRecent) {
                          return (
                            <td key={name} className={`${styles.muted} ${cellClass || ""}`}>
                              Not enough time yet
                            </td>
                          );
                        }
                        if (w.overlapsChange) {
                          return (
                            <td
                              key={name}
                              className={`${styles.muted} ${cellClass || ""}`}
                              title="This window spans both before and after the change, so it isn't a clean post-change read."
                            >
                              Includes pre-change days
                            </td>
                          );
                        }
                        const value = cellValues[i];
                        const tone = value === bestValue ? "var(--green)" : value === worstValue ? "var(--red)" : undefined;
                        return (
                          <td key={name} className={cellClass} style={tone ? { color: tone, fontWeight: 700 } : undefined}>
                            {formatMetricValue(value, metric.format, currency)}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <EntityDrillDown
          key={change.id}
          accountId={change.accountId}
          currency={currency}
          parentLevel={levelParam(change.level)}
          parentObjectId={change.objectId}
          parentLabel={change.objectName || change.objectId}
        />
      </div>
    </div>
  );
}
