import { requireRuleOwner } from "@/lib/customRulesAuth";
import { translateRule } from "@/lib/rules/translateRule";
import { currencySymbolOf } from "@/lib/rules/leanFlag";

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

// POST /api/fb/custom-rules/translate { text, currency } -> { status: "ok" | "clarify" | "unsupported" | "error", ... }
// Turns a sentence into a checked rule plus the plain-English sentence to confirm. Saves nothing.
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const owner = await requireRuleOwner(req, res, { write: true });
  if (!owner) return;
  if (!allowed(owner.email)) return res.status(429).json({ status: "error", message: "That's a lot of rules in a short time. Try again in a little while." });
  const currency = typeof req.body?.currency === "string" && /^[A-Za-z]{3}$/.test(req.body.currency) ? req.body.currency.toUpperCase() : "INR";
  try {
    return res.status(200).json(await translateRule({ text: req.body?.text, currency, symbol: currencySymbolOf(currency) }));
  } catch (err) {
    console.error("custom-rules translate failed:", err?.message);
    return res.status(502).json({ status: "error", message: "The translation service didn't answer. Try again in a moment." });
  }
}
