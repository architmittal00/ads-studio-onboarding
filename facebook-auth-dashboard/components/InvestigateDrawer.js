import { useEffect, useState } from "react";
import Loader from "./Loader";
import { CloseIcon, ChevronIcon } from "./icons";
import { METRIC_CATALOG, RATE_METRIC_KEYS, formatMetricValue } from "@/lib/insightsMetrics";
import { describeChangeDetail } from "@/lib/activityChangeDetail";
import { getCachedEntry, setCachedEntry } from "@/lib/clientCache";
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
                  const metric = METRIC_CATALOG.find((m) => m.key === key);
                  if (!metric) return null;
                  return (
                    <tr key={key}>
                      <td>{metric.label}</td>
                      {WINDOW_ORDER.map((name) => {
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
                        const raw = w.metrics?.[key];
                        const value = normalizedValue(metric, raw, w.days);
                        return (
                          <td key={name} className={cellClass}>
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
      </div>
    </div>
  );
}
