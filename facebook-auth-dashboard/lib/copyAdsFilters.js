// Post-query metric-threshold filtering for the Copy Ads source-ads picker —
// ported from pages/explore.js's own "Filter results" feature (not exported
// there, so duplicated rather than cross-imported, matching this app's
// established "small dedicated logic per domain" convention — see
// pages/explore.js's own MetricSelect doc comment for precedent). Trimmed to
// value-only comparisons: Explore's version also supports a "% change"
// basis, which only has data once a view is comparing to a previous period —
// Copy Ads has no comparison feature at all, so that basis doesn't apply.
export const METRIC_FILTER_OPERATORS = [
  { value: "gte", label: "≥" },
  { value: "lte", label: "≤" },
  { value: "gt", label: ">" },
  { value: "lt", label: "<" },
  { value: "eq", label: "=" },
  { value: "neq", label: "≠" },
];

export function compareMetricValue(rowValue, operator, threshold) {
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
// user removed that metric from the picker's column selection — same
// reasoning as Explore's own version: without this, a stale condition's
// `row[key]` would be `undefined` on every row, which compareMetricValue
// correctly treats as "doesn't match," silently hiding every row instead of
// just no-op'ing the dangling condition. A condition whose value was cleared
// mid-edit (the number input momentarily blank) is guarded the same way.
//
// `getValue` defaults to the Ad level's own shape (metrics flattened
// directly onto each row, e.g. `row.spend`). The Ad Set/Campaign-level
// pickers instead nest their performance numbers under `row.performance`
// (see pages/api/fb/adsets-list.js/campaigns-list.js) — those callers pass
// `(row, key) => row.performance?.[key]` instead, reusing this exact same
// filtering logic rather than a second copy of it.
export function applyResultFilters(rows, conditions, availableMetricKeys, getValue = (row, key) => row[key]) {
  if (!rows) return rows;
  const active = (conditions || []).filter(
    (c) => availableMetricKeys.includes(c.metricKey) && typeof c.value === "number" && !isNaN(c.value)
  );
  if (active.length === 0) return rows;
  return rows.filter((row) => active.every((c) => compareMetricValue(getValue(row, c.metricKey), c.operator, c.value)));
}
