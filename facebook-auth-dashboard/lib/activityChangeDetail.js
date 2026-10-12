import { formatMetricValue } from "./insightsMetrics";

// Facebook Activity Log extra_data for a budget change, confirmed live:
//   { old_value: { type: "payment_amount", currency, old_value, additional_value }, new_value: { ...new_value, additional_value }, type: "composite_data" }
// Amounts are in minor currency units (paise/cents) — the same convention
// lib/campaignLaunch.js's own toMinorUnits() uses for every budget value this
// app writes — so they're divided by 100 before display. additional_value
// carries "Per day" for a daily budget, "" for a lifetime one.
function describeBudgetChange(extraData) {
  const oldV = extraData?.old_value;
  const newV = extraData?.new_value;
  if (!oldV || !newV || oldV.type !== "payment_amount" || newV.type !== "payment_amount") return null;
  if (typeof oldV.old_value !== "number" || typeof newV.new_value !== "number") return null;
  const currency = newV.currency || oldV.currency;
  const suffix = (newV.additional_value || oldV.additional_value || "").toLowerCase() === "per day" ? "/day" : "";
  const from = `${formatMetricValue(oldV.old_value / 100, "currency", currency)}${suffix}`;
  const to = `${formatMetricValue(newV.new_value / 100, "currency", currency)}${suffix}`;
  return { from, to, text: `${from} → ${to}` };
}

// Other change types (status, name, …) occasionally carry a simple old/new
// pair directly on extra_data under one of these key names — only used when
// BOTH sides are primitives, never stringifying an object (the root cause of
// the original "[object Object]" bug).
const VALUE_KEY_PAIRS = [
  ["old_value", "new_value"],
  ["value_old", "value_new"],
  ["old_budget", "new_budget"],
  ["budget_value_old", "budget_value"],
  ["old_status", "new_status"],
];

function describePrimitivePair(extraData) {
  if (!extraData) return null;
  for (const [fromKey, toKey] of VALUE_KEY_PAIRS) {
    const from = extraData[fromKey];
    const to = extraData[toKey];
    if (from !== undefined && to !== undefined && typeof from !== "object" && typeof to !== "object") {
      return { from: String(from), to: String(to), text: `${from} → ${to}` };
    }
  }
  return null;
}

// Best-effort "what changed, from what to what" for one Activity Log entry's
// extra_data. Returns null when the shape isn't one of the ones confirmed/
// handled above — callers should fall back to raw JSON (see
// components/InvestigateDrawer.js) rather than guess further, same lesson as
// the original [object Object] bug.
export function describeChangeDetail(extraData) {
  if (!extraData) return null;
  return describeBudgetChange(extraData) || describePrimitivePair(extraData);
}
