import { useState } from "react";
import Loader from "./Loader";
import { ChevronIcon } from "./icons";
import { formatMetricValue } from "@/lib/insightsMetrics";
import styles from "@/styles/Home.module.css";

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
      since,
      until,
    }),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error);
  return json.rows || [];
}

// A breadcrumb trail of "children of X" tables — components/InvestigateDrawer.js
// mounts this with `key={change.id}` so switching to a different change
// remounts it fresh rather than carrying over a previous change's drilled-in
// state. `stack[i]` is one fetched level: `{ level, parentId, parentLabel,
// rows, loading, error, sort, visibleCount }`; only the last entry's table is
// shown, with earlier entries available as clickable breadcrumb labels.
export default function EntityDrillDown({ accountId, currency, parentLevel, parentObjectId, parentLabel }) {
  const [stack, setStack] = useState([]);

  function pushLevel(level, forParentId, forParentLabel) {
    setStack((prev) => [
      ...prev,
      { level, parentId: forParentId, parentLabel: forParentLabel, rows: null, loading: true, error: null, sort: "spend_desc", visibleCount: PAGE_SIZE },
    ]);
    fetchChildren({ accountId, level, idField: CHILD_ID_FILTER_FIELD[level], parentId: forParentId })
      .then((rows) => {
        setStack((prev) => prev.map((entry, i) => (i === prev.length - 1 ? { ...entry, rows, loading: false } : entry)));
      })
      .catch((err) => {
        setStack((prev) => prev.map((entry, i) => (i === prev.length - 1 ? { ...entry, error: err.message, loading: false } : entry)));
      });
  }

  function updateCurrent(patch) {
    setStack((prev) => prev.map((entry, i) => (i === prev.length - 1 ? { ...entry, ...patch } : entry)));
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

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
        <p className={styles.muted} style={{ margin: 0 }}>
          {CHILD_LEVEL_PLURAL[current.level]} · Last 30 Days
        </p>
        <div className={styles.tabGroup}>
          {SORT_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              type="button"
              className={current.sort === opt.key ? `${styles.tab} ${styles.tabActive}` : styles.tab}
              onClick={() => updateCurrent({ sort: opt.key, visibleCount: PAGE_SIZE })}
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
          <div style={{ overflowX: "auto" }}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Spend</th>
                  <th>ROAS</th>
                  {childLevel && <th></th>}
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => (
                  <tr key={row.entityId || row.entityLabel}>
                    <td>{row.entityLabel || "—"}</td>
                    <td>{formatMetricValue(row.spend, "currency", currency)}</td>
                    <td>{formatMetricValue(row.roas, "decimal", currency)}</td>
                    {childLevel && (
                      <td>
                        {row.entityId && (
                          <button
                            type="button"
                            className={styles.btnSecondary}
                            style={{ padding: "3px 8px", fontSize: 10.5 }}
                            onClick={() => pushLevel(childLevel, row.entityId, row.entityLabel || row.entityId)}
                          >
                            View {CHILD_LEVEL_PLURAL[childLevel]}
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {current.visibleCount < sortedRows.length ? (
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10 }}>
              <button
                type="button"
                className={styles.btnSecondary}
                onClick={() => updateCurrent({ visibleCount: current.visibleCount + PAGE_SIZE })}
              >
                Load 10 more
              </button>
              <span className={styles.muted}>
                {current.visibleCount} of {sortedRows.length} shown
              </span>
            </div>
          ) : (
            sortedRows.length > PAGE_SIZE && (
              <p className={styles.muted} style={{ marginTop: 10 }}>
                All {sortedRows.length} shown
              </p>
            )
          )}
        </>
      )}
    </div>
  );
}
