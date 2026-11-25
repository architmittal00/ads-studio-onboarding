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
    custom_rule: !!flag.matchedRules?.some((r) => r.custom),
    ...extra,
  });
}

// What the server logs (lib/recLogDb.js) about the recommendation behind a write, sent along with the request as `rec`.
// For a budget change the entity is the budget's own campaign / ad set; `oldBudget` is what it was before.
export function recLogContext(flag, { accountId, source, bulk, changePct, entityType, entityName, extra } = {}) {
  const isBudget = flag?.action === "INCREASE_BUDGET" || flag?.action === "DECREASE_BUDGET";
  return {
    accountId: accountId || flag?.accountId || undefined,
    entityType: entityType || (isBudget ? flag.budgetTarget?.level : flag?.entityType),
    entityName: entityName || (isBudget ? flag.budgetTarget?.name : flag?.name),
    ruleId: flag?.matchedRules?.[0]?.id,
    ruleName: flag?.matchedRules?.[0]?.name,
    custom: !!flag?.matchedRules?.some((r) => r.custom),
    source,
    screen: typeof window !== "undefined" ? window.location.pathname : undefined,
    bulk: !!bulk,
    oldBudget: isBudget ? flag.budgetTarget?.current : undefined,
    changePct,
    ...extra,
  };
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
