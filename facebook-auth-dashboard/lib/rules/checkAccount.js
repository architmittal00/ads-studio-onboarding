import { graphGet, graphGetAllPages, graphGetInsights } from "@/lib/facebookGraph";
import { todayInTimeZone } from "@/lib/dateRanges";
import { lastNDaysRange, chunk } from "@/lib/adCreativeDetails";
import { WINDOWS } from "@/lib/rules/metrics";
import { evaluateAccount } from "@/lib/rules/engine";
import { toLeanFlag, currencySymbolOf } from "@/lib/rules/leanFlag";

// The one place an ad account is fetched and run through the rules (lib/rules/definitions.js). Used by
// the Rules page and by the "needs attention" marks in Custom Views — through /api/fb/rules/check — so a
// new or changed rule (or a change here) shows up in both.
//
// One insights pull per window (3/7 days at ad level, 14/30 days at ad set level, all ending yesterday)
// plus the account's ACTIVE campaigns / ad sets / ads; everything else (account, campaign and ad set
// totals) is summed from those rows, so the cost is 4 insights jobs + 3 list calls, all in parallel.
//
// `lean` is the light variant for Custom Views: it only needs to know WHICH entities are flagged, so it
// skips the parent-name lookup, can narrow itself to the `levels` being shown (no ad rows or ad list
// when only campaigns are on screen) and returns each flag trimmed to what the "!" window needs (lib/rules/leanFlag.js).
const COOLDOWN_HOURS = 48;

export function validTimeZone(tz) {
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

// Names for parents that are not in the active lists (an ad can sit under an ad set or campaign that
// is paused, in review or otherwise not "active"), so a flag card can still say where the ad lives.
// Soft-fail: a failed lookup just leaves those names out.
async function fetchMissingNames(token, campaigns, adsets, ads) {
  const have = new Set([...campaigns, ...adsets].map((x) => x.id));
  const wanted = new Set();
  for (const a of adsets) if (a.campaign_id) wanted.add(a.campaign_id);
  for (const a of ads) {
    if (a.adset_id) wanted.add(a.adset_id);
    if (a.campaign_id) wanted.add(a.campaign_id);
  }
  const missing = [...wanted].filter((id) => !have.has(id));
  const names = {};
  const results = await Promise.allSettled(chunk(missing, 50).map((ids) => graphGet("", token, { ids: ids.join(","), fields: "name" })));
  for (const r of results) {
    if (r.status !== "fulfilled") continue;
    for (const [id, obj] of Object.entries(r.value || {})) if (obj?.name) names[id] = obj.name;
  }
  return names;
}

const ACTIVE_FILTER = [{ field: "effective_status", operator: "IN", value: ["ACTIVE", "IN_PROCESS"] }];


export const RULE_LEVELS = ["campaign", "adset", "ad"];

// `emit(obj)` receives { type: "step", id, detail } as each piece finishes (the Rules page's live loader).
export async function checkAccount({ accountId, token, tz, emit = () => {}, lean = false, levels = null }) {
  const wanted = levels && levels.length ? RULE_LEVELS.filter((l) => levels.includes(l)) : null;
  // Ad rows and the ad list only matter to ad set / ad rules; with just campaigns on screen every window
  // is pulled per ad set instead.
  const needAds = !wanted || wanted.includes("adset") || wanted.includes("ad");
  const step = (id, promise, detail) =>
    promise.then((v) => {
      emit({ type: "step", id, detail: detail ? detail(v) : "" });
      return v;
    });

  // Everything starts at once. The time zone (needed to place the date windows) normally comes from
  // the client, which already has it for the picked account; only without it do we wait for the account call.
  const accountP = step("account", graphGet(`/${accountId}`, token, { fields: "name,currency,timezone_name" }), (a) => a.name);
  const listsP = step(
    "structure",
    Promise.all([
      graphGetAllPages(`/${accountId}/campaigns`, token, { fields: "id,name,daily_budget,lifetime_budget", filtering: ACTIVE_FILTER, limit: 500 }),
      graphGetAllPages(`/${accountId}/adsets`, token, { fields: "id,name,campaign_id,daily_budget,lifetime_budget", filtering: ACTIVE_FILTER, limit: 500 }),
      needAds ? graphGetAllPages(`/${accountId}/ads`, token, { fields: "id,name,adset_id,campaign_id", filtering: ACTIVE_FILTER, limit: 500 }) : Promise.resolve({ data: [] }),
    ]),
    ([c, a, d]) => `${(c.data || []).length} campaigns · ${(a.data || []).length} ad sets · ${(d.data || []).length} ads`
  );
  const namesP = lean ? Promise.resolve({}) : listsP.then(([c, a, d]) => fetchMissingNames(token, c.data || [], a.data || [], d.data || []));
  // Budget edits in the last 48h (soft-fail: if the activity log can't be read, nothing is held back).
  const changesP = step("changes", fetchRecentBudgetChanges(accountId, token), (c) => (c.ok ? `${Object.keys(c.changed).length} budget edits found` : "couldn't be read — skipped"));
  const today = todayInTimeZone(validTimeZone(tz) || (await accountP).timezone_name);

  const insightsFor = (days) => {
    const range = lastNDaysRange(days, today);
    // Only ad-level rules need ad rows, and they only look at 3 and 7 days; the 14 and 30-day figures feed
    // ad set / campaign / account totals, so those are pulled per ad set — far fewer rows.
    const level = needAds && days <= 7 ? "ad" : "adset";
    return step(
      `insights${days}`,
      graphGetInsights(
        `/${accountId}/insights`,
        token,
        {
          level,
          fields: `${level === "ad" ? "ad_id," : ""}adset_id,campaign_id,spend,impressions,clicks,actions,action_values`,
          time_range: { since: range.since, until: range.until },
          limit: 500,
        },
        { timeoutMs: 60000 }
      ).then((r) => r.data || []),
      (rows) => `${rows.length.toLocaleString("en-IN")} ${level === "ad" ? "ad" : "ad set"} rows`
    );
  };

  const [account, [campaigns, adsets, ads], recentBudgetChanges, extraNames, ...windowRows] = await Promise.all([accountP, listsP, changesP, namesP, ...WINDOWS.map(insightsFor)]);
  const insightsByWindow = Object.fromEntries(WINDOWS.map((w, i) => [w, windowRows[i]]));

  const currencySymbol = currencySymbolOf(account.currency);

  emit({ type: "step", id: "rules", pending: true });
  const result = evaluateAccount({
    structure: { campaigns: campaigns.data || [], adsets: adsets.data || [], ads: ads.data || [] },
    insightsByWindow,
    currency: account.currency,
    currencySymbol,
    recentBudgetChanges,
    extraNames,
    levels: wanted,
  });
  emit({ type: "step", id: "rules", detail: `${result.rulesChecked.length} rules · ${result.flags.length} flagged` });

  if (lean) {
    return {
      accountId,
      generatedAt: Date.now(),
      heldChecked: result.heldChecked,
      flags: result.flags.map(toLeanFlag),
    };
  }
  return {
    accountId,
    accountName: account.name,
    currency: account.currency,
    currencySymbol,
    generatedAt: Date.now(),
    windowEnd: lastNDaysRange(1, today).until,
    ...result,
  };
}
