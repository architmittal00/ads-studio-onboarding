// Custom (personal) rules. A person types a rule in plain language; a model turns it into the small, strictly shaped spec
// below (PR 2); NOTHING the model writes is ever run: the spec is checked by validateSpec(), shown back to the person as a
// sentence built from the spec by describeRule() (so what they confirm is exactly what runs), and evaluated by the same
// engine as the built-in rules (lib/rules/engine.js) through compileCustomRule().
//
// Spec (version 1):
//   {
//     version: 1,
//     name?: string,
//     level: "campaign" | "adset" | "ad",
//     match?: "all" | "any",                       // default "all"
//     conditions: [ { metric, window?, op: "gt"|"gte"|"lt"|"lte", value } ],
//        value: { kind: "number", value }                       // a plain figure (money in the account's currency)
//             | { kind: "account", multiplier, window? }        // multiplier × the account's same metric
//             | { kind: "self", window, multiplier? }           // multiplier × this item's own metric in another window
//     action: { type: "PAUSE" | "INCREASE_BUDGET" | "DECREASE_BUDGET" | "FLAG", stepPct? },
//     assumed?: string[]                                         // what the translation had to assume (shown on confirm)
//   }
//
// The guardrails of the built-in rules apply unchanged (engine.js): only items optimised for purchase / purchase value,
// none still in Meta's learning phase, nothing without delivery in the last 7 days, and no budget suggestion within 48
// hours of a budget edit.

import { cond } from "./definitions";

export const SPEC_VERSION = 1;
export const LEVELS = ["campaign", "adset", "ad"];
export const WINDOW_OPTIONS = [1, 3, 7, 14, 30, 60, 90];
export const DEFAULT_WINDOW = 7;
export const DEFAULT_STEP_PCT = 10;
export const MAX_CONDITIONS = 8;
export const OPS = ["gt", "gte", "lt", "lte"];
export const ACTION_TYPES = ["PAUSE", "INCREASE_BUDGET", "DECREASE_BUDGET", "FLAG"];
export const ASSUMPTION_CODES = ["window", "level", "cost_per_result", "currency", "step", "match"];

// What a rule can talk about. `engine` is the key in the engine's per-window metrics; `unit` picks how a figure is shown;
// `account`: the account's own figure exists, so "× the account's" works; `windowed: false` metrics describe the item right now.
const ALL = LEVELS;
export const RULE_METRICS = {
  spend: { label: "spend", unit: "money", levels: ALL, account: true, windowed: true },
  revenue: { label: "purchase value", unit: "money", levels: ALL, account: true, windowed: true },
  purchases: { label: "purchases", unit: "int", levels: ALL, account: true, windowed: true },
  impressions: { label: "impressions", unit: "int", levels: ALL, account: true, windowed: true },
  link_clicks: { label: "link clicks", unit: "int", engine: "linkClicks", levels: ALL, account: true, windowed: true },
  roas: { label: "ROAS", unit: "num", levels: ALL, account: true, windowed: true },
  cpr: { label: "cost per purchase", unit: "money", levels: ALL, account: true, windowed: true },
  cpm: { label: "CPM", unit: "money", levels: ALL, account: true, windowed: true },
  ctr: { label: "CTR", unit: "pct", levels: ALL, account: true, windowed: true },
  cpc: { label: "CPC", unit: "money", levels: ALL, account: true, windowed: true },
  cvr: { label: "conversion rate", unit: "pct", levels: ALL, account: true, windowed: true },
  budget: { label: "budget", unit: "money", levels: ["campaign", "adset"], account: false, windowed: false },
  active_ads: { label: "number of active ads", unit: "int", levels: ["adset"], account: false, windowed: false },
};
const engineKey = (metric) => RULE_METRICS[metric].engine || metric;

const LEVEL_PLURAL = { campaign: "Campaigns", adset: "Ad sets", ad: "Ads" };
const OP_WORD = { gt: "above", gte: "at least", lt: "below", lte: "at most" };
const OP_SIGN = { gt: "gt", gte: "gte", lt: "lt", lte: "lte" };

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const isWindow = (w) => WINDOW_OPTIONS.includes(w);

// Returns { ok, errors, spec, assumptions }. `spec` is the cleaned copy (unknown keys dropped, defaults filled in) and is
// what gets saved; `assumptions` lists what was filled in or assumed so the confirm screen can say so.
export function validateSpec(raw) {
  const errors = [];
  const assumptions = new Set();
  const fail = (msg) => errors.push(msg);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, errors: ["The rule is not an object."], spec: null, assumptions: [] };
  if (raw.version != null && raw.version !== SPEC_VERSION) fail(`Unknown rule version ${String(raw.version).slice(0, 10)}.`);

  const level = raw.level;
  if (!LEVELS.includes(level)) fail("The rule must say whether it judges campaigns, ad sets or ads.");
  const match = raw.match == null ? "all" : raw.match;
  if (match !== "all" && match !== "any") fail('"match" must be "all" or "any".');
  if (raw.match == null) assumptions.add("match");

  const conditions = [];
  if (!Array.isArray(raw.conditions) || raw.conditions.length === 0) fail("The rule needs at least one condition.");
  else if (raw.conditions.length > MAX_CONDITIONS) fail(`A rule can have at most ${MAX_CONDITIONS} conditions.`);
  else {
    raw.conditions.forEach((c, i) => {
      const at = `Condition ${i + 1}`;
      const m = c && RULE_METRICS[c.metric];
      if (!m) return fail(`${at}: unknown metric "${String(c?.metric).slice(0, 30)}".`);
      if (LEVELS.includes(level) && !m.levels.includes(level)) return fail(`${at}: ${m.label} can't be used for ${LEVEL_PLURAL[level].toLowerCase()}.`);
      if (!OPS.includes(c.op)) return fail(`${at}: the comparison must be above, at least, below or at most.`);
      let window = null;
      if (m.windowed) {
        if (c.window == null) {
          window = DEFAULT_WINDOW;
          assumptions.add("window");
        } else if (!isWindow(c.window)) return fail(`${at}: the time frame must be one of ${WINDOW_OPTIONS.join(", ")} days.`);
        else window = c.window;
      } else if (c.window != null) {
        return fail(`${at}: ${m.label} has no time frame.`);
      }
      const v = c.value;
      let value = null;
      if (!v || typeof v !== "object") return fail(`${at}: missing the value to compare with.`);
      if (v.kind === "number") {
        if (!isNum(v.value) || v.value < 0 || v.value > 1e12) return fail(`${at}: the figure must be a number of 0 or more.`);
        value = { kind: "number", value: v.value };
      } else if (v.kind === "account") {
        if (!m.account) return fail(`${at}: ${m.label} can't be compared with the account.`);
        if (!isNum(v.multiplier) || v.multiplier <= 0 || v.multiplier > 1000) return fail(`${at}: the multiple of the account must be above 0.`);
        if (v.window != null && !isWindow(v.window)) return fail(`${at}: the account's time frame must be one of ${WINDOW_OPTIONS.join(", ")} days.`);
        value = { kind: "account", multiplier: v.multiplier, window: v.window ?? window };
      } else if (v.kind === "self") {
        if (!m.windowed) return fail(`${at}: ${m.label} can't be compared across time frames.`);
        if (!isWindow(v.window)) return fail(`${at}: the time frame to compare with must be one of ${WINDOW_OPTIONS.join(", ")} days.`);
        if (v.window === window) return fail(`${at}: compare two different time frames.`);
        const multiplier = v.multiplier == null ? 1 : v.multiplier;
        if (!isNum(multiplier) || multiplier <= 0 || multiplier > 1000) return fail(`${at}: the multiple must be above 0.`);
        value = { kind: "self", window: v.window, multiplier };
      } else return fail(`${at}: unknown kind of value.`);
      conditions.push({ metric: c.metric, ...(window != null ? { window } : {}), op: c.op, value });
    });
  }

  const a = raw.action;
  let action = null;
  if (!a || !ACTION_TYPES.includes(a.type)) fail("The rule must say what to suggest: pause, increase budget, decrease budget or flag.");
  else {
    action = { type: a.type };
    const budgetAction = a.type === "INCREASE_BUDGET" || a.type === "DECREASE_BUDGET";
    if (budgetAction && LEVELS.includes(level) && level === "ad") fail("An ad has no budget of its own: use ad sets or campaigns for budget changes.");
    if (budgetAction) {
      if (a.stepPct == null) {
        action.stepPct = DEFAULT_STEP_PCT;
        assumptions.add("step");
      } else if (!isNum(a.stepPct) || a.stepPct < 1 || a.stepPct > 50) fail("The budget change must be between 1% and 50%.");
      else action.stepPct = a.stepPct;
    }
  }

  if (raw.assumed != null) {
    if (!Array.isArray(raw.assumed)) fail('"assumed" must be a list.');
    else for (const code of raw.assumed) if (ASSUMPTION_CODES.includes(code)) assumptions.add(code);
  }
  const name = typeof raw.name === "string" && raw.name.trim() ? raw.name.trim().slice(0, 80) : null;
  if (errors.length) return { ok: false, errors, spec: null, assumptions: [...assumptions] };
  const spec = { version: SPEC_VERSION, ...(name ? { name } : {}), level, match, conditions, action, assumed: [...assumptions] };
  return { ok: true, errors: [], spec, assumptions: [...assumptions] };
}

// ---- Plain-English sentence (what the person confirms) ----------------------------------------------------------------

function money(v, symbol) {
  const n = Math.abs(v) < 100 ? v.toFixed(2).replace(/\.00$/, "") : Math.round(v).toLocaleString("en-IN");
  return `${symbol}${n}`;
}
function figure(v, unit, symbol) {
  if (unit === "money") return money(v, symbol);
  if (unit === "pct") return `${v}%`;
  if (unit === "int") return Math.round(v).toLocaleString("en-IN");
  return String(Math.round(v * 100) / 100);
}
const timeframe = (w) => (w === 1 ? "yesterday's" : `${w}-day`);
const mult = (x) => `${Math.round(x * 100) / 100}×`;

function metricPhrase(c) {
  const m = RULE_METRICS[c.metric];
  return m.windowed ? `${timeframe(c.window)} ${m.label}` : `the ${m.label}`;
}
function valuePhrase(c, symbol) {
  const m = RULE_METRICS[c.metric];
  const v = c.value;
  if (v.kind === "number") return figure(v.value, m.unit, symbol);
  if (v.kind === "account") return `${mult(v.multiplier)} the account's ${timeframe(v.window)} ${m.label}`;
  return `${mult(v.multiplier)} its own ${timeframe(v.window)} ${m.label}`;
}
export function describeCondition(c, symbol = "₹") {
  return `${metricPhrase(c)} is ${OP_WORD[c.op]} ${valuePhrase(c, symbol)}`;
}
export function describeAction(action) {
  switch (action.type) {
    case "PAUSE":
      return "suggest pausing it";
    case "INCREASE_BUDGET":
      return `suggest raising its budget by ${action.stepPct}%`;
    case "DECREASE_BUDGET":
      return `suggest lowering its budget by ${action.stepPct}%`;
    default:
      return "flag it for attention";
  }
}
// "Ad sets where the 7-day cost per purchase is below ₹200 and the budget is above ₹3,000 → suggest pausing it."
export function describeRule(spec, symbol = "₹") {
  const joiner = spec.match === "any" ? " or " : " and ";
  return `${LEVEL_PLURAL[spec.level]} where ${spec.conditions.map((c) => describeCondition(c, symbol)).join(joiner)} → ${describeAction(spec.action)}.`;
}

const ASSUMPTION_TEXT = {
  window: "No time frame was given for some conditions, so the last 7 days (ending yesterday) is used.",
  level: "It wasn't said what the rule judges, so ad sets are used.",
  cost_per_result: '"Cost per result" is read as cost per purchase.',
  currency: "Amounts are in the ad account's own currency.",
  step: `No amount was given for the budget change, so ${DEFAULT_STEP_PCT}% is used (it can be edited before applying).`,
  match: "All conditions must hold.",
};
export const describeAssumptions = (codes) => (codes || []).filter((c) => ASSUMPTION_TEXT[c]).map((c) => ASSUMPTION_TEXT[c]);

// ---- Data a rule needs --------------------------------------------------------------------------------------------------

// Every (window, row level) the spec reads. Items are summed up from insights rows, so an ad's numbers need ad-level rows
// for that window; ad sets and campaigns can be built from either. Account figures use whatever rows are there.
export function requiredData(spec) {
  const need = new Map(); // window -> "ad" | "adset"
  const add = (window, rowLevel) => {
    if (window == null) return;
    if (need.get(window) !== "ad") need.set(window, rowLevel);
  };
  const rowLevel = spec.level === "ad" ? "ad" : "adset";
  for (const c of spec.conditions) {
    if (!RULE_METRICS[c.metric].windowed) continue;
    add(c.window, rowLevel);
    if (c.value.kind === "self") add(c.value.window, rowLevel);
    if (c.value.kind === "account") add(c.value.window, "adset");
  }
  return [...need.entries()].map(([window, level]) => ({ window, rowLevel: level })).sort((a, b) => a.window - b.window);
}

// What is still missing from what the built-in rules already read (ad rows for 3 and 7 days, ad set rows for 14 and 30),
// across a person's rules for one account: [{ window, rowLevel }], each once, the finer level winning.
const BUILT_IN = { 3: "ad", 7: "ad", 14: "adset", 30: "adset" };
export function extraFetches(specs) {
  const need = new Map();
  for (const spec of specs) {
    for (const { window, rowLevel } of requiredData(spec)) {
      const have = BUILT_IN[window];
      if (have === "ad" || have === rowLevel) continue;
      if (need.get(window) !== "ad") need.set(window, rowLevel);
    }
  }
  return [...need.entries()].map(([window, rowLevel]) => ({ window, rowLevel })).sort((a, b) => a.window - b.window);
}

// ---- Engine hookup --------------------------------------------------------------------------------------------------------

const engineAction = (spec) => (spec.action.type === "PAUSE" ? (spec.level === "ad" ? "PAUSE_AD" : "PAUSE_ENTITY") : spec.action.type === "FLAG" ? "NOTE" : spec.action.type);

// Does the data for this window exist at a fine enough level to judge this item type?
function haveData(ctx, level, window) {
  const got = ctx.dataLevel?.[window];
  if (!got) return false;
  return level === "ad" ? got === "ad" : true;
}

function readMetric(s, ctx, c) {
  const m = RULE_METRICS[c.metric];
  if (c.metric === "budget") return s.budget ?? null;
  if (c.metric === "active_ads") return ctx.adsOfAdset(s.id).length;
  if (!haveData(ctx, s.type, c.window)) return undefined; // not read
  return s.m[c.window]?.[engineKey(c.metric)] ?? null;
}

function evalCondition(c, s, ctx) {
  const m = RULE_METRICS[c.metric];
  const label = `${metricPhrase(c)} ${OPS_LABEL[c.op]} ${c.value.kind === "number" ? figure(c.value.value, m.unit, ctx.currencySymbol) : c.value.kind === "account" ? `${mult(c.value.multiplier)} account` : `${mult(c.value.multiplier)} ${timeframe(c.value.window)} ${m.label}`}`;
  const actual = readMetric(s, ctx, c);
  let target = null;
  let hint = "";
  if (actual === undefined) {
    return cond(ctx, label, null, c.op, null, m.unit, `This needs the ${c.window}-day figures${s.type === "ad" ? " per ad" : ""}, which were not read.`);
  }
  if (c.value.kind === "number") target = c.value.value;
  else if (c.value.kind === "account") {
    const base = ctx.acc[c.value.window]?.[engineKey(c.metric)];
    target = base == null ? null : base * c.value.multiplier;
    if (ctx.dataLevel?.[c.value.window] == null) target = null;
  } else {
    if (!haveData(ctx, s.type, c.value.window)) {
      return cond(ctx, label, actual, c.op, null, m.unit, `This needs the ${c.value.window}-day figures, which were not read.`);
    }
    const own = s.m[c.value.window]?.[engineKey(c.metric)];
    target = own == null ? null : own * c.value.multiplier;
    hint = own == null ? `No ${c.value.window}-day figure to compare with.` : "";
  }
  return cond(ctx, label, actual, c.op, target, m.unit, hint);
}
const OPS_LABEL = { gt: ">", gte: "≥", lt: "<", lte: "≤" };

// A saved rule -> an engine rule ({ id, name, level, action, text, check }) like the entries of RULES in definitions.js.
// `rule`: { id, name?, spec }; spec must already have passed validateSpec().
export function compileCustomRule(rule, { currencySymbol = "₹" } = {}) {
  const { spec } = rule;
  return {
    id: `custom:${rule.id}`,
    ruleId: rule.id,
    name: rule.name || spec.name || "Your rule",
    level: spec.level,
    action: engineAction(spec),
    stepPct: spec.action.stepPct ?? null,
    custom: true,
    text: describeRule(spec, currencySymbol),
    check: (s, ctx) => {
      if (spec.level === "adset" && s.type !== "adset") return null;
      const results = spec.conditions.map((c) => evalCondition(c, s, ctx));
      if (spec.match === "any") return { conditions: [{ label: "Any of these", ok: results.some((r) => r.ok), either: results }] };
      return { conditions: results };
    },
  };
}
