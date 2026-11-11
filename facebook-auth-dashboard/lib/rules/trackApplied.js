import { track } from "@/lib/analytics";

// One named event per recommendation that was actually applied (after the write succeeded), from either page that
// can apply one — Recommendations and Custom Views' "!" quick-action window. `screen` says which.
const EVENT = {
  PAUSE_AD: "recommendation_applied_ad_paused",
  INCREASE_BUDGET: "recommendation_applied_budget_increased",
  DECREASE_BUDGET: "recommendation_applied_budget_decreased",
};

export function trackRecommendationApplied(flag, extra = {}) {
  const name = EVENT[flag?.action];
  if (!name) return;
  track(name, {
    screen: typeof window !== "undefined" ? window.location.pathname : undefined,
    entity_type: flag.entityType,
    entity_id: flag.entityType === "ad" || flag.action === "PAUSE_AD" ? flag.entityId : flag.budgetTarget?.id || flag.entityId,
    rule_id: flag.matchedRules?.[0]?.id,
    ...extra,
  });
}

// One summary event for a "select several → apply" run.
export function trackRecommendationBulkApplied(action, { total, applied, pct }) {
  track("recommendation_bulk_applied", {
    screen: typeof window !== "undefined" ? window.location.pathname : undefined,
    action: action === "PAUSE_AD" ? "ad_paused" : action === "INCREASE_BUDGET" ? "budget_increased" : "budget_decreased",
    total,
    applied,
    failed: total - applied,
    ...(pct != null ? { change_pct: pct } : {}),
  });
}
