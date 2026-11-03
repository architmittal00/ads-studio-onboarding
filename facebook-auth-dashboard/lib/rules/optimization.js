// The rules judge performance on purchases (ROAS, cost per purchase, purchase counts), so they only make
// sense for ad sets that are optimized for Purchase or purchase value. An ad set optimized for add to cart,
// landing page views, clicks, leads… is skipped (Meta's own ROAS for it says little about how well it does
// what it was set up to do).
//
// Meta stores this on the ad set: `optimization_goal` plus, for conversion goals, the event in
// `promoted_object.custom_event_type`. Custom conversions can't be told apart from here, so they are skipped.
export const ADSET_OPTIMIZATION_FIELDS = "optimization_goal,promoted_object{custom_event_type}";

export function isPurchaseOptimized(adset) {
  const goal = adset?.optimization_goal;
  const event = adset?.promoted_object?.custom_event_type;
  if (goal === "OFFSITE_CONVERSIONS" || goal === "CONVERSIONS") return event === "PURCHASE";
  // Value optimization is purchase value unless the ad set says it targets another event.
  if (goal === "VALUE") return !event || event === "PURCHASE";
  return false;
}

// An ad set Meta still reports as in its learning phase is left alone: its numbers are unstable and a budget
// change would restart the phase. Read from the same ad set list call as everything else, so it costs no
// extra request. Campaigns have no learning state of their own; see engine.js.
export const ADSET_LEARNING_FIELDS = "learning_stage_info{status}";

export function isLearning(adset) {
  return adset?.learning_stage_info?.status === "LEARNING";
}
