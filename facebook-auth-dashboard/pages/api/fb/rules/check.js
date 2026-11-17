import { getServerSession } from "next-auth/next";
import { authOptions } from "../../auth/[...nextauth]";
import { checkAccount, RULE_LEVELS, friendlyCheckError } from "@/lib/rules/checkAccount";
import { activeRulesForAccount } from "@/lib/customRulesDb";

// GET /api/fb/rules/check?accountId=act_123 — validates one ad account against the rules
// (lib/rules/checkAccount.js does the work; this is only the HTTP wrapper).
//  - `stream=1`: progress as newline-delimited JSON ({type:"step"} per finished piece, then
//    {type:"result"} or {type:"error"}) for the Rules page's live loader; otherwise plain JSON.
//  - `lean=1` (+ optional `levels=campaign,adset`): the light flags-only variant Custom Views uses.
const VALID_ID = /^act_\d+$/;

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const session = await getServerSession(req, res, authOptions);
  if (!session?.accessToken) return res.status(401).json({ error: "Not authenticated" });
  const { accountId } = req.query;
  if (!VALID_ID.test(String(accountId || ""))) return res.status(400).json({ error: "accountId must be an ad account id like act_123" });

  const stream = req.query.stream === "1";
  if (stream) res.writeHead(200, { "Content-Type": "application/x-ndjson", "Cache-Control": "no-cache" });
  const emit = (obj) => {
    if (stream) res.write(`${JSON.stringify(obj)}\n`);
  };
  const levels = typeof req.query.levels === "string" ? req.query.levels.split(",").filter((l) => RULE_LEVELS.includes(l)) : null;

  // The person's own rules for this account (personal, by Google email). If the database can't be reached the built-in
  // rules still run exactly as before.
  let customRules = [];
  if (session.googleEmail) {
    try {
      customRules = ((await activeRulesForAccount(String(session.googleEmail).toLowerCase(), accountId)) || []).map((r) => ({ id: r.id, name: r.name, spec: r.spec }));
    } catch {}
  }

  try {
    const body = await checkAccount({ accountId, token: session.accessToken, tz: req.query.tz, emit, lean: req.query.lean === "1", levels, customRules });
    if (stream) {
      emit({ type: "result", data: body });
      res.end();
    } else {
      res.status(200).json(body);
    }
  } catch (err) {
    if (stream) {
      emit({ type: "error", error: friendlyCheckError(err.message) });
      res.end();
    } else {
      res.status(err.graphResponse ? 400 : 500).json({ error: friendlyCheckError(err.message) });
    }
  }
}
