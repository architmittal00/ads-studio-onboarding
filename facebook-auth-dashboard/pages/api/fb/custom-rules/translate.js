import { requireRuleOwner } from "@/lib/customRulesAuth";
import { translateRule } from "@/lib/rules/translateRule";
import { currencySymbolOf } from "@/lib/rules/leanFlag";
import { LEVELS, ACTION_TYPES } from "@/lib/rules/customRule";

// A person can ask for at most this many translations an hour (each one is a paid model call). Held in memory per server
// instance, so it is a brake against a runaway loop or abuse, not an exact meter.
const MAX_PER_HOUR = 40;
const recent = new Map(); // email -> [timestamps]
function allowed(email) {
  const now = Date.now();
  const list = (recent.get(email) || []).filter((t) => now - t < 3600000);
  if (list.length >= MAX_PER_HOUR) {
    recent.set(email, list);
    return false;
  }
  list.push(now);
  recent.set(email, list);
  return true;
}

// What the person chose on the form (the level the rule looks at and the action with its budget %); null when not given.
function readChoices(body) {
  if (body?.level == null && body?.action == null) return { fixed: null };
  if (!LEVELS.includes(body.level)) return { error: "Choose what the rule applies to." };
  const type = body.action?.type;
  if (!ACTION_TYPES.includes(type)) return { error: "Choose what the rule should do." };
  if (type === "INCREASE_BUDGET" || type === "DECREASE_BUDGET") {
    if (body.level === "ad") return { error: "An ad has no budget of its own: pick ad sets or campaigns for budget changes." };
    const step = Number(body.action.stepPct);
    if (!Number.isFinite(step) || step < 1 || step > 50) return { error: "Enter a budget change between 1% and 50%." };
    return { fixed: { level: body.level, action: { type, stepPct: step } } };
  }
  return { fixed: { level: body.level, action: { type } } };
}

// What the person sees for each way the model call can fail (the raw provider message only goes to the server log).
const FAILURE_TEXT = {
  not_configured: "Reading rules isn't switched on yet: the translation key is missing on the server. Please tell the admin.",
  auth: "The translation service refused our key. Please tell the admin.",
  credits: "The translation service has run out of credit. Please tell the admin.",
  model: "The translation model isn't available right now. Please tell the admin.",
  timeout: "The translation service took too long. Try again in a moment.",
  busy: "The translation service is busy. Try again in a minute.",
  upstream: "The translation service had a hiccup. Try again in a moment.",
  empty: "The translation service sent back an empty answer. Try again, or rephrase the conditions a little.",
  other: "The translation service didn't answer. Try again in a moment.",
};

// POST /api/fb/custom-rules/translate { text, currency, level?, action? } -> { status: "ok" | "clarify" | "conflict" | "unsupported" | "error", ... }
// `text` holds the conditions in plain language; `level` / `action` are the form's choices and are used exactly as chosen.
// Turns it into a checked rule plus the plain-English sentence to confirm. Saves nothing.
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const owner = await requireRuleOwner(req, res, { write: true });
  if (!owner) return;
  if (!allowed(owner.email)) return res.status(429).json({ status: "error", message: "That's a lot of rules in a short time. Try again in a little while." });
  const currency = typeof req.body?.currency === "string" && /^[A-Za-z]{3}$/.test(req.body.currency) ? req.body.currency.toUpperCase() : "INR";
  const choices = readChoices(req.body);
  if (choices.error) return res.status(400).json({ status: "error", message: choices.error });
  try {
    return res.status(200).json(await translateRule({ text: req.body?.text, currency, symbol: currencySymbolOf(currency), fixed: choices.fixed }));
  } catch (err) {
    console.error("custom-rules translate failed:", err?.kind || "", err?.message);
    return res.status(502).json({ status: "error", message: FAILURE_TEXT[err?.kind] || FAILURE_TEXT.other });
  }
}
