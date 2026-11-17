// Wording shared by the recommendation screens for suggestions that can come from a person's own rules: a pause can be
// for a campaign, ad set or ad, and a budget step can be the rule's own (default 10%).
const NOUN = { campaign: "campaign", adset: "ad set", ad: "ad" };
export const entityNoun = (entityType) => NOUN[entityType] || "ad";
export const pauseLabel = (entityType) => `Pause ${entityNoun(entityType)}`;
export const DEFAULT_STEP_PCT = 10;
export const stepPctOf = (flag) => flag?.suggestedStepPct || DEFAULT_STEP_PCT;
