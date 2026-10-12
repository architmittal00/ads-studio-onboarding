import { useEffect, useState } from "react";
import { CloseIcon } from "./icons";
import { METRIC_CATALOG, RATE_METRIC_KEYS, formatMetricValue } from "@/lib/insightsMetrics";
import { getCachedEntry, setCachedEntry } from "@/lib/clientCache";
import styles from "@/styles/Home.module.css";

const CACHE_PREFIX = "recent-changes-investigate:";

const DEFAULT_METRIC_KEYS = ["spend", "purchases", "cost_per_purchase", "roas"];

const WINDOW_ORDER = ["sevenDaysBefore", "threeDaysBefore", "oneDayBefore", "sinceChange", "last3Days", "last7Days"];
const WINDOW_LABEL = {
  sevenDaysBefore: "7 Days Before",
  threeDaysBefore: "3 Days Before",
  oneDayBefore: "1 Day Before",
  sinceChange: "Since Change",
  last3Days: "Last 3 Days",
  last7Days: "Last 7 Days",
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

export default function InvestigateModal({ change, onClose, currency }) {
  const [selectedKeys, setSelectedKeys] = useState(DEFAULT_METRIC_KEYS);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

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
    const sortedKeys = [...selectedKeys].sort();
    const cacheKey = `${CACHE_PREFIX}${change.objectId}:${change.eventTime}:${sortedKeys.join(",")}`;
    const cached = getCachedEntry(cacheKey);
    if (cached) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time read of an already-fetched, still-fresh cache entry, not derivable from props/state
      setData(cached.data);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({
      objectId: change.objectId,
      level: levelParam(change.level),
      eventTime: change.eventTime,
      metricKeys: sortedKeys.join(","),
    });
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
  }, [change, selectedKeys]);

  if (!change) return null;

  function toggleMetric(key) {
    setSelectedKeys((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.65)",
        backdropFilter: "blur(6px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 800,
        padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={styles.card}
        style={{ background: "var(--bg)", width: "min(680px, 100%)", maxHeight: "85vh", overflowY: "auto" }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
          <div>
            <h2 className={styles.h2} style={{ marginBottom: 2 }}>
              {change.objectName || change.objectId}
            </h2>
            <p className={styles.sub}>
              {change.level} · {change.description}
            </p>
            <p className={styles.muted}>By {change.actorName}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className={styles.btnSecondary} style={{ padding: 6 }}>
            <CloseIcon size={14} />
          </button>
        </div>

        <div style={{ marginTop: 16 }}>
          <p className={styles.muted} style={{ marginBottom: 6 }}>
            Metrics
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {METRIC_CATALOG.map((m) => {
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

        {loading && !data && <p className={styles.sub} style={{ marginTop: 16 }}>Loading…</p>}

        {data && selectedKeys.length === 0 && (
          <p className={styles.sub} style={{ marginTop: 16 }}>
            Pick at least one metric above.
          </p>
        )}

        {data && selectedKeys.length > 0 && (
          <div style={{ overflowX: "auto", marginTop: 16 }}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Metric</th>
                  {WINDOW_ORDER.map((name) => {
                    const w = data.windows[name];
                    return (
                      <th key={name}>
                        {WINDOW_LABEL[name]}
                        {w && !w.tooRecent && <span className={styles.muted}> ({w.days}d)</span>}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {selectedKeys.map((key) => {
                  const metric = METRIC_CATALOG.find((m) => m.key === key);
                  if (!metric) return null;
                  return (
                    <tr key={key}>
                      <td>{metric.label}</td>
                      {WINDOW_ORDER.map((name) => {
                        const w = data.windows[name];
                        if (!w) return <td key={name}>—</td>;
                        if (w.tooRecent) {
                          return (
                            <td key={name} className={styles.muted}>
                              Not enough time yet
                            </td>
                          );
                        }
                        const raw = w.metrics?.[key];
                        const value = normalizedValue(metric, raw, w.days);
                        return <td key={name}>{formatMetricValue(value, metric.format, currency)}</td>;
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
