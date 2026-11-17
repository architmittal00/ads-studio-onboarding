import { requireRuleOwner, VALID_ACCOUNT_ID } from "@/lib/customRulesAuth";
import { listRules, createRule, updateRule, deleteRule } from "@/lib/customRulesDb";
import { validateSpec, requiredData, describeRule } from "@/lib/rules/customRule";
import { MAX_TEXT_CHARS } from "@/lib/rules/translateRule";

// GET    /api/fb/custom-rules                          -> { rules }
// POST   { text, spec, name?, allAccounts?, accountIds?, model?, promptVersion? } -> { rule }
// PATCH  { id, enabled?, name?, allAccounts?, accountIds? }  -> { rule }
// DELETE { id }                                        -> { ok }
// The owner is the session's Google email. A saved rule's spec is ALWAYS re-checked here: nothing the browser sends is trusted.
const cleanAccounts = (v) => (Array.isArray(v) ? [...new Set(v.filter((x) => VALID_ACCOUNT_ID.test(String(x))).map(String))].slice(0, 300) : null);
const cleanName = (v) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 80) : null);

export default async function handler(req, res) {
  const owner = await requireRuleOwner(req, res, { write: req.method !== "GET" });
  if (!owner) return;
  const body = req.body || {};
  try {
    if (req.method === "GET") return res.status(200).json({ rules: await listRules(owner.email) });

    if (req.method === "POST") {
      const checked = validateSpec(body.spec);
      if (!checked.ok) return res.status(400).json({ error: checked.errors[0] });
      const text = typeof body.text === "string" ? body.text.trim().slice(0, MAX_TEXT_CHARS) : "";
      if (!text) return res.status(400).json({ error: "Missing the original text" });
      const allAccounts = body.allAccounts === true;
      const accountIds = cleanAccounts(body.accountIds) || [];
      if (!allAccounts && accountIds.length === 0) return res.status(400).json({ error: "Pick at least one ad account" });
      const out = await createRule(owner.email, {
        name: cleanName(body.name) || checked.spec.name || describeRule(checked.spec).slice(0, 60),
        originalText: text,
        spec: checked.spec,
        requires: requiredData(checked.spec),
        allAccounts,
        accountIds: allAccounts ? [] : accountIds,
        model: typeof body.model === "string" ? body.model.slice(0, 80) : null,
        promptVersion: Number.isInteger(body.promptVersion) ? body.promptVersion : null,
      });
      if (out.full) return res.status(400).json({ error: "You have reached the limit of 20 rules. Delete one first." });
      return res.status(200).json({ rule: out.rule });
    }

    if (req.method === "PATCH") {
      const id = Number(body.id);
      if (!Number.isInteger(id)) return res.status(400).json({ error: "Missing id" });
      const patch = {};
      if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
      if (body.name != null) patch.name = cleanName(body.name);
      if (typeof body.allAccounts === "boolean") patch.allAccounts = body.allAccounts;
      if (body.accountIds != null) patch.accountIds = cleanAccounts(body.accountIds);
      if (patch.allAccounts === false && (!patch.accountIds || patch.accountIds.length === 0)) return res.status(400).json({ error: "Pick at least one ad account" });
      const rule = await updateRule(owner.email, id, patch);
      return rule ? res.status(200).json({ rule }) : res.status(404).json({ error: "Rule not found" });
    }

    if (req.method === "DELETE") {
      const id = Number(body.id);
      if (!Number.isInteger(id)) return res.status(400).json({ error: "Missing id" });
      return (await deleteRule(owner.email, id)) ? res.status(200).json({ ok: true }) : res.status(404).json({ error: "Rule not found" });
    }

    res.setHeader("Allow", "GET, POST, PATCH, DELETE");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("custom-rules failed:", err?.message);
    return res.status(500).json({ error: "Could not reach the rules database" });
  }
}
