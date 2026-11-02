import { getServerSession } from "next-auth/next";
import { authOptions } from "../../auth/[...nextauth]";
import { graphGet, graphGetAllPages, graphGetInsights } from "@/lib/facebookGraph";
import { todayInTimeZone } from "@/lib/dateRanges";
import { lastNDaysRange } from "@/lib/adCreativeDetails";
import { WINDOWS } from "@/lib/rules/metrics";
import { evaluateAccount } from "@/lib/rules/engine";

// Validates one ad account against the rules sheet (lib/rules/definitions.js).
// One insights pull per window (3/7 days at ad level, 14/30 days at ad set level, all ending yesterday) plus the account's
// ACTIVE campaigns / ad sets / ads; everything else (account, campaign and ad set totals) is
// summed from those rows, so the cost is 4 insights jobs + 3 list calls, all in parallel.
const VALID_ID = /^act_\d+$/;
const COOLDOWN_HOURS = 48;

function validTimeZone(tz) {
  if (typeof tz !== "string" || !tz) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return null;
  }
}

// Map of object id -> ISO time of its latest budget edit in the last COOLDOWN_HOURS. The activity
// log reports an ad set's or campaign's own budget change against that entity's id.
async function fetchRecentBudgetChanges(accountId, token) {
  const nowUnix = Math.floor(Date.now() / 1000);
  try {
    const activity = await graphGetAllPages(`/${accountId}/activities`, token, {
      since: nowUnix - COOLDOWN_HOURS * 3600,
      until: nowUnix,
      limit: 500,
      fields: "event_type,event_time,object_id,translated_event_type",
    });
    const changed = {};
    for (const e of activity.data || []) {
      if (!`${e.event_type || ""} ${e.translated_event_type || ""}`.toLowerCase().includes("budget")) continue;
      const at = typeof e.event_time === "number" ? new Date(e.event_time * 1000) : new Date(e.event_time);
      if (!e.object_id || isNaN(at.getTime())) continue;
      if (!changed[e.object_id] || at > new Date(changed[e.object_id])) changed[e.object_id] = at.toISOString();
    }
    return { ok: true, changed };
  } catch {
    return { ok: false, changed: {} };
  }
}

const ACTIVE_FILTER = [{ field: "effective_status", operator: "IN", value: ["ACTIVE", "IN_PROCESS"] }];

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const session = await getServerSession(req, res, authOptions);
  if (!session?.accessToken) return res.status(401).json({ error: "Not authenticated" });
  const { accountId } = req.query;
  if (!VALID_ID.test(String(accountId || ""))) return res.status(400).json({ error: "accountId must be an ad account id like act_123" });
  const token = session.accessToken;

  // `?stream=1` sends progress as newline-delimited JSON ({type:"step"} per finished piece, then
  // {type:"result"} or {type:"error"}) so the page can show what is happening; without it the
  // plain JSON response is unchanged.
  const stream = req.query.stream === "1";
  if (stream) res.writeHead(200, { "Content-Type": "application/x-ndjson", "Cache-Control": "no-cache" });
  const emit = (obj) => {
    if (stream) res.write(`${JSON.stringify(obj)}\n`);
  };
  const step = (id, promise, detail) =>
    promise.then((v) => {
      emit({ type: "step", id, detail: detail ? detail(v) : "" });
      return v;
    });

  try {
    // Everything starts at once. The time zone (needed to place the date windows) normally comes
    // from the client, which already has it for the picked account; only without it do we have to
    // wait for the account call first.
    const accountP = step("account", graphGet(`/${accountId}`, token, { fields: "name,currency,timezone_name" }), (a) => a.name);
    const listsP = step("structure", Promise.all([
      graphGetAllPages(`/${accountId}/campaigns`, token, { fields: "id,name,daily_budget,lifetime_budget", filtering: ACTIVE_FILTER, limit: 500 }),
      graphGetAllPages(`/${accountId}/adsets`, token, { fields: "id,name,campaign_id,daily_budget,lifetime_budget", filtering: ACTIVE_FILTER, limit: 500 }),
      graphGetAllPages(`/${accountId}/ads`, token, { fields: "id,name,adset_id,campaign_id", filtering: ACTIVE_FILTER, limit: 500 }),
    ]), ([c, a, d]) => `${(c.data || []).length} campaigns · ${(a.data || []).length} ad sets · ${(d.data || []).length} ads`);
    // Budget edits in the last 48h (soft-fail: if the activity log can't be read, nothing is held back).
    const changesP = step("changes", fetchRecentBudgetChanges(accountId, token), (c) => (c.ok ? `${Object.keys(c.changed).length} budget edits found` : "couldn't be read — skipped"));
    const clientTz = validTimeZone(req.query.tz);
    const today = todayInTimeZone(clientTz || (await accountP).timezone_name);

    const insightsFor = (days) => {
      const range = lastNDaysRange(days, today);
      // Only ad-level rules need ad rows, and they only look at 3 and 7 days; the 14 and 30-day
      // figures feed ad set / campaign / account totals, so those are pulled per ad set — far fewer rows.
      const level = days <= 7 ? "ad" : "adset";
      return step(`insights${days}`, graphGetInsights(
        `/${accountId}/insights`,
        token,
        {
          level,
          fields: `${level === "ad" ? "ad_id," : ""}adset_id,campaign_id,spend,impressions,clicks,actions,action_values`,
          time_range: { since: range.since, until: range.until },
          limit: 500,
        },
        { timeoutMs: 60000 }
      ).then((r) => r.data || []), (rows) => `${rows.length.toLocaleString("en-IN")} ${level === "ad" ? "ad" : "ad set"} rows`);
    };

    const [account, [campaigns, adsets, ads], recentBudgetChanges, ...windowRows] = await Promise.all([accountP, listsP, changesP, ...WINDOWS.map(insightsFor)]);
    const insightsByWindow = Object.fromEntries(WINDOWS.map((w, i) => [w, windowRows[i]]));

    let currencySymbol = "₹";
    try {
      currencySymbol = new Intl.NumberFormat("en-IN", { style: "currency", currency: account.currency || "INR" }).formatToParts(0).find((p) => p.type === "currency")?.value || "₹";
    } catch {}

    emit({ type: "step", id: "rules", pending: true });
    const result = evaluateAccount({
      structure: { campaigns: campaigns.data || [], adsets: adsets.data || [], ads: ads.data || [] },
      insightsByWindow,
      currency: account.currency,
      currencySymbol,
      recentBudgetChanges,
    });
    const body = {
      accountId,
      accountName: account.name,
      currency: account.currency,
      currencySymbol,
      generatedAt: Date.now(),
      windowEnd: lastNDaysRange(1, today).until,
      ...result,
    };
    if (stream) {
      emit({ type: "step", id: "rules", detail: `${result.rulesChecked.length} rules · ${result.flags.length} flagged` });
      emit({ type: "result", data: body });
      res.end();
    } else {
      res.status(200).json(body);
    }
  } catch (err) {
    const status = err.graphResponse ? 400 : 500;
    if (stream) {
      emit({ type: "error", error: err.message || "Request failed" });
      res.end();
    } else {
      res.status(status).json({ error: err.message || "Request failed" });
    }
  }
}
