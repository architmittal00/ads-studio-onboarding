import { requireRuleOwner, VALID_ACCOUNT_ID } from "@/lib/customRulesAuth";
import { checkAccount } from "@/lib/rules/checkAccount";
import { validateSpec } from "@/lib/rules/customRule";

// POST /api/fb/custom-rules/test { spec, accountId, tz } -> { accountName, matches: [...], checked }
// Runs ONE (unsaved) rule against an ad account right now and lists what it would flag. Nothing is saved or changed.
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const owner = await requireRuleOwner(req, res, { write: true, needToken: true });
  if (!owner) return;
  const { spec: raw, accountId, tz } = req.body || {};
  if (!VALID_ACCOUNT_ID.test(String(accountId || ""))) return res.status(400).json({ error: "Pick an ad account" });
  const checked = validateSpec(raw);
  if (!checked.ok) return res.status(400).json({ error: checked.errors[0] });
  try {
    const result = await checkAccount({ accountId, token: owner.token, tz, lean: true, levels: [checked.spec.level], customRules: [{ id: "test", name: "Your rule", spec: checked.spec }] });
    const matches = result.flags
      .filter((f) => f.matchedRules.some((m) => m.custom))
      .slice(0, 25)
      .map((f) => ({ key: f.key, entityType: f.entityType, name: f.name, action: f.action, spend7: f.stats.spend7, roas7: f.stats.roas7, conditions: f.matchedRules.find((m) => m.custom).conditions }));
    return res.status(200).json({ matches, total: result.flags.filter((f) => f.matchedRules.some((m) => m.custom)).length, heldChecked: result.heldChecked });
  } catch (err) {
    return res.status(err.graphResponse ? 400 : 500).json({ error: err.message || "Request failed" });
  }
}
