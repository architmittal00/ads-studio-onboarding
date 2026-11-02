// The slice of a rule flag Custom Views needs for its "!" marks and quick-action window: enough to
// explain the flag and apply its action, nothing else (no parent names, no per-ad detail). Used on the
// server (lean check) and on the client (reading a full result the Rules page saved) so both agree.
export function toLeanFlag(f) {
  return {
    key: f.key,
    entityType: f.entityType,
    entityId: f.entityId,
    name: f.name,
    action: f.action,
    budgetTarget: f.budgetTarget || null,
    budgetNote: f.budgetNote || null,
    stats: f.stats,
    matchedRules: f.matchedRules,
    hiddenConflicts: f.hiddenConflicts || [],
  };
}

export function currencySymbolOf(currency) {
  try {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency: currency || "INR" }).formatToParts(0).find((p) => p.type === "currency")?.value || "₹";
  } catch {
    return "₹";
  }
}
