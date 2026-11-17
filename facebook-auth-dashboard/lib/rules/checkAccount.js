import { graphGet, graphGetAllPages, graphGetInsights } from "@/lib/facebookGraph";
import { todayInTimeZone } from "@/lib/dateRanges";
import { lastNDaysRange, chunk } from "@/lib/adCreativeDetails";
import { fetchActivities } from "@/lib/activityLog";
import { evaluateAccount } from "@/lib/rules/engine";
import { compileCustomRule, extraFetches } from "@/lib/rules/customRule";
import { toLeanFlag, currencySymbolOf } from "@/lib/rules/leanFlag";
import { ADSET_OPTIMIZATION_FIELDS, ADSET_LEARNING_FIELDS } from "@/lib/rules/optimization";

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
// The whole read is capped: the page shows the early result while it runs, so an unbounded wait here is minutes of
// "still reading" (a busy account's log once took ~110 s and then failed anyway). Past the cap it counts as "couldn't be
// read", the same soft-fail as any other error.
const CHANGES_WAIT_MS = 40000;

async function fetchRecentBudgetChanges(accountId, token) {
  const nowUnix = Math.floor(Date.now() / 1000);
  const range = {
    sinceUnix: nowUnix - COOLDOWN_HOURS * 3600,
    untilUnix: nowUnix,
    fields: "event_type,event_time,object_id,translated_event_type",
  };
  const read = async () => {
    // Read as parallel time slices (lib/activityLog.js), and only the budget events: that is all this needs. If Meta
    // rejects the category filter, fall back to the full log.
    let activity;
    try {
      activity = await fetchActivities(accountId, token, { ...range, category: "BUDGET" });
    } catch {
      activity = await fetchActivities(accountId, token, range);
    }
    const changed = {};
    for (const e of activity.data || []) {
      if (!`${e.event_type || ""} ${e.translated_event_type || ""}`.toLowerCase().includes("budget")) continue;
      const at = typeof e.event_time === "number" ? new Date(e.event_time * 1000) : new Date(e.event_time);
      if (!e.object_id || isNaN(at.getTime())) continue;
      if (!changed[e.object_id] || at > new Date(changed[e.object_id])) changed[e.object_id] = at.toISOString();
    }
    return { ok: true, changed };
  };
  let timer;
  try {
    return await Promise.race([read(), new Promise((_, reject) => (timer = setTimeout(() => reject(new Error("timed out")), CHANGES_WAIT_MS)))]);
  } catch {
    return { ok: false, changed: {} };
  } finally {
    clearTimeout(timer);
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

// Meta refuses some insights reads outright ("Please reduce the amount of data you're asking for", code 1): a long window at ad
// level on a big account. That error is permanent, so repeating the same request never helps. The window is split in half
// and each half read on its own (recursively, with smaller pages), and the rows are simply put together: the engine adds
// up every row of the same item (addInsightsRow), so two half-windows give the same totals as one whole window.
const TOO_MUCH_DATA = /reduce the amount of data/i;
const MAX_SPLIT_DEPTH = 4;
const DAY_MS = 86400000;
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
const dayCount = (range) => Math.round((Date.parse(`${range.until}T00:00:00Z`) - Date.parse(`${range.since}T00:00:00Z`)) / DAY_MS) + 1;

// What to show when Meta still refuses after the window was split as far as it goes: plain words, not Meta's error text.
export function friendlyCheckError(message) {
  return TOO_MUCH_DATA.test(message || "")
    ? "Meta says this check asks for too much data on this ad account, even in smaller pieces. If a rule of yours uses a long time frame (30, 60 or 90 days) at ad level, try a shorter one (7 or 14 days) or apply it to ad sets; otherwise try again in a few minutes."
    : message || "Request failed";
}

export async function readInsightsRows(read, range, depth = 0) {
  try {
    return await read(range, depth === 0 ? 500 : 200);
  } catch (err) {
    if (!TOO_MUCH_DATA.test(err?.message || "") || dayCount(range) <= 1 || depth >= MAX_SPLIT_DEPTH) throw err;
    const sinceMs = Date.parse(`${range.since}T00:00:00Z`);
    const midMs = sinceMs + Math.floor((dayCount(range) - 1) / 2) * DAY_MS;
    const halves = [
      { since: range.since, until: isoDay(midMs) },
      { since: isoDay(midMs + DAY_MS), until: range.until },
    ];
    const parts = await Promise.all(halves.map((h) => readInsightsRows(read, h, depth + 1)));
    return parts.flat();
  }
}

const ACTIVE_FILTER = [{ field: "effective_status", operator: "IN", value: ["ACTIVE", "IN_PROCESS"] }];


export const RULE_LEVELS = ["campaign", "adset", "ad"];

// `emit(obj)` receives { type: "step", id, detail } as each piece finishes (the Rules page's live loader).
// `customRules`: the person's own rules that apply to this account, [{ id, name, spec }] (lib/rules/customRule.js). They add
// whatever extra insight reads they need on top of the built-in four (other time frames, per-ad figures for 14 / 30 days).
export async function checkAccount({ accountId, token, tz, emit = () => {}, lean = false, levels = null, customRules = [] }) {
  const wanted = levels && levels.length ? RULE_LEVELS.filter((l) => levels.includes(l)) : null;
  // Ad rows and the ad list only matter to ad set / ad rules; with just campaigns on screen every window
  // is pulled per ad set instead.
  const needAds = !wanted || wanted.includes("adset") || wanted.includes("ad");
  const rulesInScope = customRules.filter((r) => !wanted || wanted.includes(r.spec.level));
  // Which row level each time frame is read at: the built-in four, then whatever the person's rules need on top.
  const levelByWindow = { 3: needAds ? "ad" : "adset", 7: needAds ? "ad" : "adset", 14: "adset", 30: "adset" };
  for (const { window, rowLevel } of extraFetches(rulesInScope.map((r) => r.spec))) {
    if (!levelByWindow[window] || rowLevel === "ad") levelByWindow[window] = rowLevel;
  }
  const allWindows = Object.keys(levelByWindow).map(Number);
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
      graphGetAllPages(`/${accountId}/adsets`, token, { fields: `id,name,campaign_id,daily_budget,lifetime_budget,${ADSET_OPTIMIZATION_FIELDS},${ADSET_LEARNING_FIELDS}`, filtering: ACTIVE_FILTER, limit: 500 }),
      needAds ? graphGetAllPages(`/${accountId}/ads`, token, { fields: "id,name,adset_id,campaign_id,created_time", filtering: ACTIVE_FILTER, limit: 500 }) : Promise.resolve({ data: [] }),
    ]),
    ([c, a, d]) => `${(c.data || []).length} campaigns · ${(a.data || []).length} ad sets · ${(d.data || []).length} ads`
  );
  const namesP = lean ? Promise.resolve({}) : listsP.then(([c, a, d]) => fetchMissingNames(token, c.data || [], a.data || [], d.data || []));
  // Budget edits in the last 48h (soft-fail: if the activity log can't be read, nothing is held back).
  const changesP = step("changes", fetchRecentBudgetChanges(accountId, token), (c) => (c.ok ? `${Object.keys(c.changed).length} budget edits found` : "couldn't be read — skipped"));
  const today = todayInTimeZone(validTimeZone(tz) || (await accountP).timezone_name);

  const insightsFor = (days) => {
    const range = lastNDaysRange(days, today);
    // Only ad-level rules need ad rows, and the built-in ones only look at 3 and 7 days; the 14 and 30-day figures feed
    // ad set / campaign / account totals, so those are pulled per ad set — far fewer rows (unless a custom rule needs per-ad).
    const level = levelByWindow[days];
    return step(
      `insights${days}`,
      readInsightsRows(
        (r, limit) =>
          graphGetInsights(
            `/${accountId}/insights`,
            token,
            {
              level,
              fields: `${level === "ad" ? "ad_id," : ""}adset_id,campaign_id,spend,impressions,inline_link_clicks,actions,action_values`,
              time_range: { since: r.since, until: r.until },
              limit,
            },
            { timeoutMs: 60000 }
          ).then((res) => res.data || []),
        { since: range.since, until: range.until }
      ),
      (rows) => `${rows.length.toLocaleString("en-IN")} ${level === "ad" ? "ad" : "ad set"} rows`
    );
  };

  // The 48-hour activity log is by far the slowest call on a busy account (it pages through every event, often 25+ s
  // after everything else is done). A full check doesn't wait for it: the rules run without the cool-down first and
  // that result is sent straight away ("partial"), then re-run once the log arrives. The light Custom Views check
  // has no screen to show a partial result on, so it still waits.
  const [account, [campaigns, adsets, ads], earlyChanges, extraNames, ...windowRows] = await Promise.all([accountP, listsP, lean ? changesP : Promise.resolve(null), namesP, ...allWindows.map(insightsFor)]);
  const insightsByWindow = Object.fromEntries(allWindows.map((w, i) => [w, windowRows[i]]));

  const currencySymbol = currencySymbolOf(account.currency);
  const compiledRules = rulesInScope.map((r) => compileCustomRule(r, { currencySymbol }));

  emit({ type: "step", id: "rules", pending: true });
  const evaluate = (recentBudgetChanges) =>
    evaluateAccount({
      structure: { campaigns: campaigns.data || [], adsets: adsets.data || [], ads: ads.data || [] },
      insightsByWindow,
      currency: account.currency,
      currencySymbol,
      recentBudgetChanges,
      extraNames,
      levels: wanted,
      customRules: compiledRules,
      insightLevels: levelByWindow,
    });
  const fullBody = (result) => ({
    accountId,
    accountName: account.name,
    currency: account.currency,
    currencySymbol,
    generatedAt: Date.now(),
    windowEnd: lastNDaysRange(1, today).until,
    ...result,
  });

  if (!lean) {
    emit({ type: "partial", data: fullBody(evaluate(null)) });
    const recentBudgetChanges = await changesP;
    const result = evaluate(recentBudgetChanges);
    emit({ type: "step", id: "rules", detail: `${result.rulesChecked.length} rules · ${result.flags.length} flagged` });
    return fullBody(result);
  }

  const result = evaluate(earlyChanges);
  emit({ type: "step", id: "rules", detail: `${result.rulesChecked.length} rules · ${result.flags.length} flagged` });
  return {
    accountId,
    generatedAt: Date.now(),
    heldChecked: result.heldChecked,
    flags: result.flags.map(toLeanFlag),
  };
}
