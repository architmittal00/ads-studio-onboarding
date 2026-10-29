import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import { graphGet, graphGetAllPages, graphGetInsights } from "@/lib/facebookGraph";
import { chunk, fetchAdDetails } from "@/lib/adCreativeDetails";
import { toMajorUnits } from "@/lib/reportShared";
import { normalizeStatus } from "@/lib/statusNormalize";
import {
  LEVEL_OPTIONS,
  LEVEL_ID_FIELD,
  getBreakdownGroup,
  resolveGraphFields,
  deriveRowMetrics,
  aggregateRowMetrics,
  rowIdentityKey,
  rowLabel,
  rowEntityLabel,
  rowBreakdownLabel,
} from "@/lib/insightsMetrics";

const MAX_RANGE_DAYS = 365;
const MAX_ACCOUNTS = 10;
// Multiple of 7 — when `time_increment=7` (weekly grouping), Facebook buckets
// days starting from each call's own `time_range.since`, so a chunk boundary
// that didn't land on a multiple of 7 would split one calendar week across
// two chunks as two partial-week rows instead of one. 28 (four weeks) keeps
// every chunk's week buckets contiguous with the next chunk's.
const CHUNK_DAYS = 28;
const VALID_LEVELS = LEVEL_OPTIONS.map((l) => l.value);
const DAY_MS = 24 * 60 * 60 * 1000;

// "Filter rows by name" (exclude, or include-only) is deliberately
// independent of the selected `level` — a user viewing Account totals can
// still say "exclude any campaign named X" (or "only include campaigns
// named Y"), and the resulting account total must genuinely reflect that,
// not just hide/show a table row that was already pre-aggregated by
// Facebook before we ever saw it. So whenever an active filter targets a
// finer entity than `level`, this fetches at that finer level instead
// (where the name is actually visible), drops the non-matching entities,
// and re-aggregates ("rolls up") what's left back into `level`-shaped rows
// — see rollupRows()/mergeRawRows() below.
const LEVEL_RANK = { account: 0, campaign: 1, adset: 2, ad: 3 };
const NAME_FILTER_FIELD_LEVEL = { campaignName: "campaign", adsetName: "adset", adName: "ad" };
const NAME_FILTER_RAW_FIELD = { campaignName: "campaign_name", adsetName: "adset_name", adName: "ad_name" };
const VALID_NAME_FILTER_FIELDS = Object.keys(NAME_FILTER_FIELD_LEVEL);

// "Only show these IDs" — an id-based always-include-only filter, for
// jumping straight to specific entities spotted elsewhere
// (e.g. in a different date range) instead of hunting for them again by
// name. Same finer-level-fetch-then-rollup mechanism: a Campaign ID filter
// applied while viewing Account totals fetches at the campaign level, keeps
// only the matching campaigns, and rolls the rest back up.
const ID_FILTER_FIELD_LEVEL = { campaignId: "campaign", adsetId: "adset", adId: "ad" };
const ID_FILTER_RAW_FIELD = { campaignId: "campaign_id", adsetId: "adset_id", adId: "ad_id" };
const VALID_ID_FILTER_FIELDS = Object.keys(ID_FILTER_FIELD_LEVEL);
const MAX_ID_FILTER_VALUES = 50;

// Splits on commas, whitespace, or newlines — matches however someone pastes
// a handful of IDs copied from the results table (one at a time, comma-
// joined, one per line, …) — then dedupes and drops anything blank.
function parseIdList(text) {
  return [...new Set(String(text || "").split(/[,\s]+/).map((s) => s.trim()).filter(Boolean))];
}

// Metrics that can't be correctly re-derived once rows from several entities
// get summed together, so they're dropped from the output whenever a rollup
// actually happens (see needsRollup below) rather than silently showing a
// plausible-looking but wrong number:
//  - `reach`/`unique_clicks` are Facebook's own deduplicated counts — the
//    same person reached by two campaigns counts once in each campaign's own
//    `reach`, but summing those two campaigns' `reach` double-counts them.
//    There's no field available here that lets this be corrected.
//  - `frequency` (impressions/reach) and `cpp` (spend/reach) are derived
//    directly from that same unreliable `reach`.
//  - `unique_ctr` is derived from `unique_clicks`, same problem.
// `ctr`/`cpc`/`cpm`/`roas` are NOT in this set — they're all re-derivable
// from `impressions`/`inline_link_clicks`/`spend`/`action_values`, which sum
// correctly, so mergeRawRows() below recomputes (or, for ctr/cpc, simply
// lets the catalog's own extract function recompute) them instead of
// dropping them.
const REACH_DEPENDENT_KEYS = new Set(["reach", "frequency", "cpp", "unique_clicks", "unique_ctr"]);

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

// Inclusive day count between two YYYY-MM-DD strings (e.g. the same day is 1
// day, not 0) — matches how a human reads a date range picker.
function inclusiveDayCount(since, until) {
  return Math.round((new Date(`${until}T00:00:00Z`) - new Date(`${since}T00:00:00Z`)) / DAY_MS) + 1;
}

// Splits one {since, until} range into consecutive sub-ranges of at most
// `maxDays` each (the last one shorter if it doesn't divide evenly) — e.g.
// a 90-day range in 28-day chunks becomes [28, 28, 28, 6] days. A range
// already within the cap comes back as a single chunk, so this is a no-op
// for the common case (today/this-week/last-30-days presets).
function splitRangeIntoChunks(since, until, maxDays) {
  const chunks = [];
  let chunkStart = new Date(`${since}T00:00:00Z`);
  const end = new Date(`${until}T00:00:00Z`);
  while (chunkStart <= end) {
    const chunkEnd = new Date(chunkStart);
    chunkEnd.setUTCDate(chunkEnd.getUTCDate() + maxDays - 1);
    if (chunkEnd > end) chunkEnd.setTime(end.getTime());
    chunks.push({ since: isoDate(chunkStart), until: isoDate(chunkEnd) });
    chunkStart = new Date(chunkEnd);
    chunkStart.setUTCDate(chunkStart.getUTCDate() + 1);
  }
  return chunks;
}

// Drops any raw Graph API row that doesn't pass every active name filter —
// run before anything else touches these rows, so an excluded entity never
// contributes to a later rollup's sum. Exclude filters are ANDed together
// (a row is dropped if it matches ANY of them — "not X and not Y"); include
// filters are ORed together (a row is kept only if it matches AT LEAST ONE
// of them, when there's at least one — "must be A or B"), the usual
// allow-list-vs-blocklist combination. A row missing the field entirely
// (e.g. an "Ad name" filter applied to a row fetched at the Campaign level)
// just never matches, same as the original client-side version of this
// filter.
function applyNameFilters(rows, filters) {
  if (!filters.length) return rows;
  const excludes = filters.filter((f) => f.mode !== "include");
  const includes = filters.filter((f) => f.mode === "include");
  const matches = (row, f) => String(row[NAME_FILTER_RAW_FIELD[f.field]] ?? "").toLowerCase().includes(f.value);
  return rows.filter((row) => {
    if (excludes.some((f) => matches(row, f))) return false;
    if (includes.length > 0 && !includes.some((f) => matches(row, f))) return false;
    return true;
  });
}

// Keeps only rows whose raw id field is one of the pasted IDs — always
// include-only-exact-match, unlike applyNameFilters above (which can do
// either). Same "run before rollup" placement so an unmatched entity never
// contributes to a rolled-up sum.
function applyIdFilter(rows, idFilter) {
  if (!idFilter) return rows;
  const wanted = new Set(idFilter.values);
  return rows.filter((row) => wanted.has(String(row[ID_FILTER_RAW_FIELD[idFilter.field]] || "")));
}

// Campaign/ad set/ad `effective_status` (Active/Paused/etc.) isn't an
// Insights API field at all — it lives on the entity's own node, not on an
// insights row — so this is a separate, one-time batched-by-id lookup (same
// `?ids=` pattern as lib/adCreativeDetails.js's fetchAdDetails) run after the
// main insights data is in hand, purely so the client can offer a "Status"
// filter alongside the metric-threshold ones. Only ever called when there's
// one real entity id per row to look up (see canHaveStatus below) — never at
// the account level, where there's no single entity a row could point at.
async function fetchEntityStatuses(ids, token) {
  const statusById = {};
  if (ids.length === 0) return statusById;

  const batches = chunk(ids, 50);
  const results = await Promise.allSettled(
    batches.map((batch) => graphGet("", token, { ids: batch.join(","), fields: "effective_status" }))
  );

  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    for (const [id, obj] of Object.entries(result.value || {})) {
      if (obj.effective_status) statusById[id] = normalizeStatus(obj.effective_status);
    }
  }

  return statusById;
}

// Same batched-lookup shape as fetchEntityStatuses above, for the budget
// fields the Explore row-actions feature needs to know what's even
// adjustable from a given row. Only ever called for campaign/adset ids (see
// canHaveBudget below) — `daily_budget`/`lifetime_budget` aren't Ad fields.
// Facebook sets at most one of the two, and only when THIS entity owns a
// budget at all: a campaign has neither when it's ABO (budget lives on its
// ad sets instead), and an ad set has neither when its campaign is CBO
// (budget lives on the campaign instead) — so "does this row have a
// non-null budget field" doubles as the CBO/ABO check, with no separate
// campaign_budget_optimization field needed (Facebook doesn't expose one;
// pages/api/fb/report/core.js infers it the same way).
async function fetchEntityBudgets(ids, token) {
  const budgetById = {};
  if (ids.length === 0) return budgetById;

  const batches = chunk(ids, 50);
  const results = await Promise.allSettled(
    batches.map((batch) => graphGet("", token, { ids: batch.join(","), fields: "daily_budget,lifetime_budget" }))
  );

  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    for (const [id, obj] of Object.entries(result.value || {})) {
      const dailyBudget = toMajorUnits(obj.daily_budget);
      const lifetimeBudget = toMajorUnits(obj.lifetime_budget);
      if (dailyBudget != null || lifetimeBudget != null) budgetById[id] = { dailyBudget, lifetimeBudget };
    }
  }

  return budgetById;
}

// Sums one actions-shaped field (an array of `{action_type, value}`) across
// several raw rows, combining entries that share an `action_type` into one —
// e.g. two campaigns' `actions` arrays, each with their own "purchase" entry,
// become a single "purchase" entry whose value is their sum. This is exactly
// what every METRIC_CATALOG `extract` function already expects to read, so
// the merged row can be handed to deriveRowMetrics() completely unchanged.
function mergeActionArrays(arrays) {
  const totals = new Map();
  for (const arr of arrays) {
    if (!arr) continue;
    for (const entry of arr) {
      totals.set(entry.action_type, (totals.get(entry.action_type) || 0) + parseFloat(entry.value || 0));
    }
  }
  return [...totals.entries()].map(([action_type, value]) => ({ action_type, value: String(value) }));
}

const SCALAR_SUM_FIELDS = ["spend", "impressions", "clicks", "inline_link_clicks"];
const ACTION_ARRAY_FIELDS = ["actions", "action_values", "video_p25_watched_actions", "video_p50_watched_actions", "video_p75_watched_actions", "video_p100_watched_actions", "video_play_actions"];

// Merges several raw rows that all belong to the same rollup group (same
// requested-level identity + breakdown + date, see rollupRows()) into one
// synthetic row shaped just like a single Graph API row — so every existing
// extract function in lib/insightsMetrics.js, which only ever knows how to
// read one row, works on it completely unchanged.
//
// Starts from the group's first row (which already carries the correct
// id/name/breakdown/date fields — identical across the group by
// construction, since that's exactly what the group was keyed on) and then:
//  - oversums the plain additive scalars,
//  - sums the actions-shaped arrays by action_type,
//  - preserves the "field entirely absent" vs "field present with 0" used by
//    Hold Rate's video_thruplay_watched_actions (lib/insightsMetrics.js) —
//    only merges rows that actually have it, and only includes the result if
//    at least one row did,
//  - deletes every field that would otherwise leak one entity's own narrow
//    ratio into a row whose underlying totals have just changed: `cpm` is
//    recomputed from the now-summed base fields instead (the catalog's own
//    extract function reads it directly rather than deriving it, so a stale
//    value must be overwritten, not merely left as rows[0]'s) — `ctr`/`cpc`
//    need no such step since their extract functions already derive from
//    `inline_link_clicks`/`impressions`/`spend`, all of which SCALAR_SUM_FIELDS
//    above already sums correctly; `purchase_roas` is deleted so the `roas`
//    metric's own fallback (lib/metrics.js's roasFromRow) recomputes it from
//    the merged `spend`/`action_values` instead of trusting rows[0]'s
//    narrower figure; `quality_ranking`/`engagement_rate_ranking`/
//    `conversion_rate_ranking` are categorical and can't be combined, so
//    they're dropped entirely (their extract functions already render an
//    absent field as "unknown", which is honest here); any free-text custom
//    field (`customFields`) is dropped for the same reason — this app has no
//    way to know how to combine an arbitrary, unknown-shaped field.
//  - `reach`/`unique_clicks`/`frequency`/`cpp`/`unique_ctr`
//    (REACH_DEPENDENT_KEYS) are deleted outright — Facebook's own
//    deduplicated counts can't be correctly reconstructed by summing
//    per-entity values, so these are excluded from the result entirely
//    rather than shown as a plausible-looking but wrong number (handled by
//    the caller stripping them from `effectiveMetricKeys`, not here).
function mergeRawRows(rows, customFields) {
  const merged = { ...rows[0] };

  for (const field of SCALAR_SUM_FIELDS) {
    merged[field] = String(rows.reduce((sum, r) => sum + parseFloat(r[field] || 0), 0));
  }
  for (const field of ACTION_ARRAY_FIELDS) {
    merged[field] = mergeActionArrays(rows.map((r) => r[field]));
  }
  const thruplayRows = rows.filter((r) => r.video_thruplay_watched_actions);
  if (thruplayRows.length > 0) {
    merged.video_thruplay_watched_actions = mergeActionArrays(thruplayRows.map((r) => r.video_thruplay_watched_actions));
  } else {
    delete merged.video_thruplay_watched_actions;
  }

  const impressions = parseFloat(merged.impressions || 0);
  const spend = parseFloat(merged.spend || 0);
  merged.cpm = impressions > 0 ? String((spend / impressions) * 1000) : "0";
  // Facebook's own per-row ctr/cpc (all-clicks based) are never read by the
  // catalog's extract functions any more, but rows[0]'s copy would otherwise
  // sit here looking like real data for this merged, multi-entity row.
  delete merged.ctr;
  delete merged.cpc;

  delete merged.purchase_roas;
  delete merged.quality_ranking;
  delete merged.engagement_rate_ranking;
  delete merged.conversion_rate_ranking;
  for (const field of REACH_DEPENDENT_KEYS) delete merged[field];
  // Guards against the free-text "raw field name" escape hatch being typed
  // as the same name as a field already computed above (e.g. someone adding
  // "spend" there even though it's already offered as a metric pill) — never
  // delete a field this function itself just summed/recomputed/reserved.
  const reserved = new Set([...SCALAR_SUM_FIELDS, ...ACTION_ARRAY_FIELDS, "video_thruplay_watched_actions", "ctr", "cpc", "cpm", "purchase_roas", "quality_ranking", "engagement_rate_ranking", "conversion_rate_ranking", ...REACH_DEPENDENT_KEYS]);
  for (const field of customFields) {
    if (!reserved.has(field)) delete merged[field];
  }

  return merged;
}

// Groups already-name-filtered raw rows by what they'd share once rolled up
// to `level` — the level's own identity (its own id, or the literal string
// "account" when `level` is "account" itself — see rowIdentityKey()) plus
// every active breakdown dimension, plus the date (when daily/weekly
// grouping is on; rowIdentityKey alone doesn't account for that). Rows that
// land in the same group are exactly the finer-grained entities whose
// numbers need to be summed together to form one `level`-shaped total — e.g.
// every remaining (non-excluded) campaign's rows for the same date and
// breakdown value collapse into that one Account-level row for that
// date/breakdown.
function rollupRows(rows, level, breakdownGroupValue, customFields) {
  const groups = new Map();
  for (const row of rows) {
    const key = `${rowIdentityKey(row, level, breakdownGroupValue)}::${row.date_start || ""}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.values()].map((groupRows) => mergeRawRows(groupRows, customFields));
}

// POST, not GET+query-string: the query spec (a breakdown group, a list of
// metric keys, an optional list of raw custom field names, a compare toggle)
// doesn't fit cleanly in a URL, and this endpoint isn't meant to be
// HTTP/CDN-cacheable the way /api/fb/report.js is — caching for this one is
// handled entirely client-side (lib/clientCache.js). Same precedent as
// /api/fb/interest-recommendations.js.
// Every non-deleted campaign/ad set/ad of an account as an all-zero raw
// insights row (same field names Facebook's insights rows use), so entities
// with no delivery in the range can sit alongside the ones that have data.
const ZERO_ROW_EDGE = { campaign: "campaigns", adset: "adsets", ad: "ads" };
const ZERO_ROW_FIELDS = {
  campaign: "id,name",
  adset: "id,name,campaign_id,campaign{name}",
  ad: "id,name,adset_id,adset{name},campaign_id,campaign{name}",
};
const ZERO_ROW_MAX = 5000;
async function fetchZeroSpendEntities(accountId, level, token) {
  const json = await graphGetAllPages(`/${accountId}/${ZERO_ROW_EDGE[level]}`, token, {
    fields: ZERO_ROW_FIELDS[level],
    limit: 200, // smaller pages: nested fields on big ad lists can trip Meta's "reduce the amount of data"
    effective_status: ["ACTIVE", "PAUSED", "CAMPAIGN_PAUSED", "ADSET_PAUSED", "PENDING_REVIEW", "DISAPPROVED", "WITH_ISSUES", "IN_PROCESS"],
  });
  return (json.data || []).slice(0, ZERO_ROW_MAX).map((e) => {
    const row = { spend: "0", impressions: "0" };
    row[`${level}_id`] = e.id;
    row[`${level}_name`] = e.name;
    if (level !== "campaign") row.campaign_id = e.campaign_id;
    if (level !== "campaign") row.campaign_name = e.campaign?.name;
    if (level === "ad") {
      row.adset_id = e.adset_id;
      row.adset_name = e.adset?.name;
    }
    return row;
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session?.accessToken) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  const {
    accountIds,
    level = "account",
    breakdownGroup = "none",
    metricKeys,
    customFields,
    customMetrics,
    customEvents,
    nameFilters,
    idFilter,
    includeCreative,
    includeZeroSpend,
    since,
    until,
    timeIncrement,
    compareToPrevious,
    previousSince: customPreviousSince,
    previousUntil: customPreviousUntil,
  } = req.body || {};

  if (!Array.isArray(accountIds) || accountIds.length === 0) {
    return res.status(400).json({ error: "At least one accountId is required" });
  }
  if (accountIds.length > MAX_ACCOUNTS) {
    return res.status(400).json({ error: `Cannot query more than ${MAX_ACCOUNTS} accounts at once (got ${accountIds.length})` });
  }
  if (!VALID_LEVELS.includes(level)) {
    return res.status(400).json({ error: `level must be one of: ${VALID_LEVELS.join(", ")}` });
  }
  if (!since || !until || isNaN(Date.parse(since)) || isNaN(Date.parse(until))) {
    return res.status(400).json({ error: "since and until are required, valid YYYY-MM-DD dates" });
  }
  if (since > until) {
    return res.status(400).json({ error: "since must not be after until" });
  }
  // The client resolves "today" in the ad account's own time zone, which can be
  // a calendar day ahead of UTC (up to UTC+14) — allow that one day of slack.
  const todayStr = isoDate(new Date(Date.now() + 86400000));
  if (until > todayStr) {
    return res.status(400).json({ error: "until cannot be in the future" });
  }
  const rangeDays = inclusiveDayCount(since, until);
  if (rangeDays > MAX_RANGE_DAYS) {
    return res.status(400).json({ error: `Date range cannot exceed ${MAX_RANGE_DAYS} days (got ${rangeDays})` });
  }
  if (!Array.isArray(metricKeys) || metricKeys.length === 0) {
    return res.status(400).json({ error: "At least one metric is required" });
  }

  // customMetrics carries the full definition (not just the id) for any
  // user-defined ratio metric present in metricKeys — this route has no
  // localStorage access, so the client must send what it already has.
  // Nesting (a custom metric referencing another custom metric) is rejected
  // here as well as in the UI, since there's no principled resolution order
  // for it without cycle detection, which this deliberately-simple feature
  // doesn't need.
  const cleanCustomMetrics = [];
  if (customMetrics !== undefined) {
    if (!Array.isArray(customMetrics)) {
      return res.status(400).json({ error: "customMetrics must be an array" });
    }
    const idsInBatch = new Set(customMetrics.map((cm) => cm && cm.id));
    for (const cm of customMetrics) {
      if (!cm || typeof cm.id !== "string" || typeof cm.numeratorKey !== "string" || typeof cm.denominatorKey !== "string") {
        return res.status(400).json({ error: "Each customMetrics entry needs id, numeratorKey, and denominatorKey" });
      }
      if (idsInBatch.has(cm.numeratorKey) || idsInBatch.has(cm.denominatorKey)) {
        return res.status(400).json({ error: `Custom metric "${cm.id}" cannot reference another custom metric` });
      }
      cleanCustomMetrics.push({ id: cm.id, numeratorKey: cm.numeratorKey, denominatorKey: cm.denominatorKey });
    }
  }

  // customEvents carries the full definition for any discovered custom
  // conversion present in metricKeys (fetched via
  // /api/fb/custom-conversions — this route has no way to look it up itself,
  // same reasoning as customMetrics above). Each entry's accountId must be
  // one of this request's own accountIds — rejects a mismatched/forged
  // entry up front rather than letting it silently resolve to nothing.
  const cleanCustomEvents = [];
  if (customEvents !== undefined) {
    if (!Array.isArray(customEvents)) {
      return res.status(400).json({ error: "customEvents must be an array" });
    }
    for (const ce of customEvents) {
      if (!ce || typeof ce.id !== "string" || typeof ce.accountId !== "string" || typeof ce.actionType !== "string") {
        return res.status(400).json({ error: "Each customEvents entry needs id, accountId, and actionType" });
      }
      if (!accountIds.includes(ce.accountId)) {
        return res.status(400).json({ error: `customEvents entry "${ce.id}" references an account not in accountIds` });
      }
      cleanCustomEvents.push({ id: ce.id, accountId: ce.accountId, actionType: ce.actionType });
    }
  }

  // {field, value, mode} — field names which name column to match (Campaign/
  // Ad Set/Ad name), value is a case-insensitive "contains" match, mode is
  // "exclude" (default — drop any matching row) or "include" (keep only
  // matching rows, see applyNameFilters above). An entry with an empty/
  // whitespace-only value is dropped rather than rejected — mirrors the
  // client only ever sending filters it considers "active".
  const cleanNameFilters = [];
  if (nameFilters !== undefined) {
    if (!Array.isArray(nameFilters)) {
      return res.status(400).json({ error: "nameFilters must be an array" });
    }
    for (const f of nameFilters) {
      if (
        !f ||
        !VALID_NAME_FILTER_FIELDS.includes(f.field) ||
        typeof f.value !== "string" ||
        (f.mode !== undefined && f.mode !== "include" && f.mode !== "exclude")
      ) {
        return res
          .status(400)
          .json({ error: `Each nameFilters entry needs a field (${VALID_NAME_FILTER_FIELDS.join(", ")}), a string value, and an optional mode ("include" or "exclude")` });
      }
      const value = f.value.trim().toLowerCase();
      if (value) cleanNameFilters.push({ field: f.field, value, mode: f.mode === "include" ? "include" : "exclude" });
    }
  }

  // {field, value} — field names which id column to match exactly (Campaign/
  // Ad Set/Ad ID), value is a raw string of one or more IDs (comma/whitespace/
  // newline separated, see parseIdList). Empty after parsing (e.g. blank or
  // whitespace-only) is treated as "no filter", same as an empty nameFilters
  // value above.
  let cleanIdFilter = null;
  if (idFilter !== undefined && idFilter !== null) {
    if (typeof idFilter !== "object" || !VALID_ID_FILTER_FIELDS.includes(idFilter.field) || typeof idFilter.value !== "string") {
      return res.status(400).json({ error: `idFilter needs a field (${VALID_ID_FILTER_FIELDS.join(", ")}) and a string value` });
    }
    const values = parseIdList(idFilter.value);
    if (values.length > MAX_ID_FILTER_VALUES) {
      return res.status(400).json({ error: `idFilter cannot list more than ${MAX_ID_FILTER_VALUES} IDs (got ${values.length})` });
    }
    if (values.length > 0) cleanIdFilter = { field: idFilter.field, values };
  }

  // The finest level any active filter needs to even see its own name/id
  // field at, vs. the level actually requested — whichever is finer wins,
  // since that's the only way to both know which entities to keep/exclude
  // AND still be able to roll the rest back up to what was asked for. See
  // the comment on REACH_DEPENDENT_KEYS above and rollupRows()/
  // mergeRawRows() below for what "rolling up" actually involves.
  let requiredLevel = cleanNameFilters.reduce(
    (lvl, f) => (LEVEL_RANK[NAME_FILTER_FIELD_LEVEL[f.field]] > LEVEL_RANK[lvl] ? NAME_FILTER_FIELD_LEVEL[f.field] : lvl),
    level
  );
  if (cleanIdFilter && LEVEL_RANK[ID_FILTER_FIELD_LEVEL[cleanIdFilter.field]] > LEVEL_RANK[requiredLevel]) {
    requiredLevel = ID_FILTER_FIELD_LEVEL[cleanIdFilter.field];
  }
  const fetchLevel = LEVEL_RANK[requiredLevel] > LEVEL_RANK[level] ? requiredLevel : level;
  const needsRollup = fetchLevel !== level;

  // Reach-derived metrics are silently dropped from the OUTPUT (not the
  // request) whenever a rollup is actually happening — `meta.metricKeys`
  // reflects this, so the table/chart naturally stop showing columns for
  // them (both already render only whatever's in `meta.metricKeys`, never
  // the original request's `metricKeys`) with no further client change
  // needed. `excludedMetrics` lets the UI explain why they disappeared.
  const effectiveMetricKeys = needsRollup ? metricKeys.filter((k) => !REACH_DEPENDENT_KEYS.has(k)) : metricKeys;
  const excludedMetrics = needsRollup ? metricKeys.filter((k) => REACH_DEPENDENT_KEYS.has(k)) : [];

  // "monthly" is a literal Meta API value (not a day count, unlike "1"/"7")
  // — it buckets by real calendar month, so a range that doesn't start/end
  // on a month boundary gets a partial first and/or last bucket, same as
  // Ads Manager's own monthly view would show.
  const validTimeIncrement = timeIncrement === "1" || timeIncrement === "7" || timeIncrement === "monthly" ? timeIncrement : null;
  if (compareToPrevious && validTimeIncrement) {
    return res.status(400).json({
      error: "Compare-to-previous-period isn't supported together with daily/weekly grouping",
    });
  }

  const cleanCustomFields = Array.isArray(customFields) ? customFields.map((f) => String(f).trim()).filter(Boolean) : [];
  const outputCustomFields = needsRollup ? [] : cleanCustomFields;
  const group = getBreakdownGroup(breakdownGroup);
  const fieldList = resolveGraphFields(metricKeys, cleanCustomFields, fetchLevel, cleanCustomMetrics, cleanCustomEvents);
  // `spend` is always fetched below the account level — the default "only
  // entities that spent" filter (see includeZeroSpend) needs it even when the
  // view does not show a Spend column.
  if (fetchLevel !== "account" && !fieldList.includes("spend")) fieldList.push("spend");
  const fields = fieldList.join(",");
  const token = session.accessToken;

  const baseParams = {
    level: fetchLevel,
    fields,
    time_range: { since, until },
    limit: 500,
  };
  if (group.breakdowns.length > 0) baseParams.breakdowns = group.breakdowns.join(",");
  if (validTimeIncrement) baseParams.time_increment = validTimeIncrement;

  let previousRange = null;
  if (compareToPrevious) {
    if (customPreviousSince || customPreviousUntil) {
      // A user-chosen comparison window, not the immediately-preceding one —
      // still constrained to the exact same length as the primary range (the
      // one piece of this that isn't the user's choice), so every delta is
      // still a like-for-like comparison.
      if (
        !customPreviousSince ||
        !customPreviousUntil ||
        isNaN(Date.parse(customPreviousSince)) ||
        isNaN(Date.parse(customPreviousUntil))
      ) {
        return res.status(400).json({ error: "previousSince and previousUntil must both be valid YYYY-MM-DD dates" });
      }
      if (customPreviousSince > customPreviousUntil) {
        return res.status(400).json({ error: "previousSince must not be after previousUntil" });
      }
      if (customPreviousUntil > todayStr) {
        return res.status(400).json({ error: "previousUntil cannot be in the future" });
      }
      const customDays = inclusiveDayCount(customPreviousSince, customPreviousUntil);
      if (customDays !== rangeDays) {
        return res.status(400).json({
          error: `Comparison period must be exactly ${rangeDays} day${rangeDays === 1 ? "" : "s"} long, matching the selected date range (got ${customDays})`,
        });
      }
      previousRange = { since: customPreviousSince, until: customPreviousUntil };
    } else {
      // Default: the immediately-preceding period of equal length — e.g. a
      // 7-day range compares against the 7 days right before it
      // ("week-over-week" when the chosen range happens to be a week, but
      // this works for any length). Computed once — identical for every
      // account.
      const prevUntil = new Date(`${since}T00:00:00Z`);
      prevUntil.setUTCDate(prevUntil.getUTCDate() - 1);
      const prevSince = new Date(prevUntil);
      prevSince.setUTCDate(prevSince.getUTCDate() - (rangeDays - 1));
      previousRange = { since: isoDate(prevSince), until: isoDate(prevUntil) };
    }
  }

  // A daily/weekly-grouped query over a long range can return a lot of rows
  // (days × entities × breakdown values) — chunked into several smaller
  // date windows run in parallel, each well within Facebook's own per-call
  // pagination ceiling, rather than one call whose result could silently
  // truncate. An aggregate query (no time grouping) returns one pre-summed
  // row per entity/breakdown regardless of range length, and Facebook's own
  // sums (and derived ratios like CTR) can't be correctly reconstructed by
  // just concatenating partial-range rows — only the time-series case is
  // chunked, where each chunk's rows are already independent and safe to
  // concatenate. (compareToPrevious is already mutually exclusive with
  // time_increment, so the previous-period call is never chunked.)
  // "monthly" buckets stay unchunked regardless of range length — even a
  // full MAX_RANGE_DAYS range is at most ~13 calendar-month buckets, nowhere
  // near enough rows to need splitting, and a fixed-day chunk size like
  // CHUNK_DAYS would cut across calendar month boundaries anyway (the exact
  // problem CHUNK_DAYS being a multiple of 7 exists to avoid for weekly).
  const currentChunks =
    validTimeIncrement && validTimeIncrement !== "monthly" ? splitRangeIntoChunks(since, until, CHUNK_DAYS) : [{ since, until }];

  // One flat list of calls across every account, every current-period chunk,
  // and (when comparing) the previous period — run together in a single
  // Promise.allSettled, not nested per-account awaits, for the same reason
  // the original single-account compare-to-previous code ran its two calls
  // in parallel: graphGetInsights's async-job path can take up to its own
  // ~15s poll timeout per call, and there's no reason independent queries
  // should serialize that cost. allSettled (not all) so one revoked/erroring
  // account — or one failed chunk — doesn't block the rest from returning
  // data.
  // Ad-level rows × a time-increment grouping is, by a wide margin, the
  // single heaviest shape this endpoint ever requests (row count scales with
  // ads × date buckets, vs. one row per bucket at Account level or far fewer
  // entities than ads at Campaign/Ad Set) — the shape most likely to tip
  // Facebook into its async-job path and most likely to still be running
  // past graphGetInsights' default 15s poll window. Raised well within this
  // route's own 60s `maxDuration` (vercel.json) rather than left to fail a
  // query that was still going to succeed a few seconds later.
  const insightsTimeoutMs = fetchLevel === "ad" && validTimeIncrement ? 45000 : undefined;

  // Default: only entities that actually spent. With `includeZeroSpend` the
  // view also lists entities with no delivery in the range — Meta's insights
  // endpoint never returns those, so they are listed separately and added as
  // all-zero rows. Only for plain campaign/ad set/ad views (no breakdown or
  // time grouping, where a "zero row" has no clear meaning).
  let zeroSpendFailure = null;
  const wantZeroSpend = includeZeroSpend === true;
  const canAddZeroRows = wantZeroSpend && fetchLevel !== "account" && group.breakdowns.length === 0 && !validTimeIncrement;
  const zeroRowsPromise = canAddZeroRows
    ? Promise.all(
        accountIds.map((accountId) =>
          fetchZeroSpendEntities(accountId, fetchLevel, token).catch((err) => {
            zeroSpendFailure = err?.message || "Request failed";
            return [];
          })
        )
      )
    : null;

  const callPlan = [];
  const rawCalls = [];
  for (const accountId of accountIds) {
    for (const chunk of currentChunks) {
      rawCalls.push(graphGetInsights(`/${accountId}/insights`, token, { ...baseParams, time_range: chunk }, { timeoutMs: insightsTimeoutMs }));
      callPlan.push({ accountId, period: "current" });
    }
    if (compareToPrevious) {
      rawCalls.push(graphGetInsights(`/${accountId}/insights`, token, { ...baseParams, time_range: previousRange }, { timeoutMs: insightsTimeoutMs }));
      callPlan.push({ accountId, period: "previous" });
    }
  }

  // From here on, the response streams newline-delimited JSON (same
  // convention as pages/api/fb/launch-campaign.js) instead of one plain JSON
  // body — everything above this point is cheap, synchronous validation, so
  // every early `res.status(...).json(...)` return above stays untouched; a
  // validation failure never costs the client a dropped connection with
  // headers already sent. From here down, every remaining response (the
  // "every account failed" branch below and the final success response) is a
  // streamed "done" event instead, since headers can't be resent once
  // `writeHead` below has run.
  //
  // `calls.length` is known up front (the fan-out plan above is fixed before
  // any of them resolve), so each one's own completion — in whatever order
  // they actually finish, since this stays Promise.allSettled underneath,
  // not sequential — can report truthful "N of M" progress without changing
  // the deliberate full-parallelism this endpoint already relies on (see the
  // comment on `calls` above: one slow/erroring account shouldn't block the
  // rest).
  res.writeHead(200, { "Content-Type": "application/x-ndjson", "Cache-Control": "no-cache" });
  function progress(message) {
    res.write(`${JSON.stringify({ type: "progress", message })}\n`);
  }
  let completedCalls = 0;
  const calls = rawCalls.map((p) =>
    p.then(
      (value) => {
        completedCalls++;
        progress(`Fetched ${completedCalls} of ${rawCalls.length}…`);
        return value;
      },
      (err) => {
        completedCalls++;
        progress(`Fetched ${completedCalls} of ${rawCalls.length}…`);
        throw err;
      }
    )
  );

  const settled = await Promise.allSettled(calls);

  const zeroRowsByAccount = zeroRowsPromise ? await zeroRowsPromise : [];
  const byAccount = new Map(accountIds.map((id) => [id, { current: [], previous: [] }]));
  const accountErrors = [];
  let firstFailure = null;
  settled.forEach((result, i) => {
    const { accountId, period } = callPlan[i];
    if (result.status === "fulfilled") {
      byAccount.get(accountId)[period].push(...(result.value.data || []));
    } else {
      if (!firstFailure) firstFailure = result.reason;
      if (!accountErrors.some((e) => e.accountId === accountId)) {
        accountErrors.push({ accountId, message: result.reason?.message || "Request failed" });
      }
    }
  });

  // Checked by actual data, not just by `accountErrors.length` — with a
  // chunked time-series query, an account can appear in `accountErrors` from
  // one failed chunk while still having real rows from its other, succeeded
  // chunks. Only an account with zero current-period rows at all has nothing
  // to show.
  if (accountIds.every((id) => byAccount.get(id).current.length === 0)) {
    // Every account failed — nothing to show, surface it as a real error
    // rather than an empty-but-200 response. Streamed as a "done" event with
    // an `error` field (not a fresh res.status(...).json(...)) — headers
    // were already sent above once streaming started.
    res.write(`${JSON.stringify({ type: "done", error: firstFailure?.message || "Request failed" })}\n`);
    return res.end();
  }

  const allKeys = [...effectiveMetricKeys, ...outputCustomFields];
  let filteredByNameCount = 0;

  // Whether a row can meaningfully have its own status/id at all: only false
  // at the account level, which has no single entity to point at (every row
  // shares the literal rowIdentityKey() id-part "account", so a rollup there
  // really does merge several distinct entities into one total). At every
  // other level, a rollup still lands each output row on exactly one entity
  // — rowIdentityKey()/rollupRows() group finer-grained rows by `level`'s own
  // id field precisely so mergeRawRows() always starts from (and keeps) one
  // consistent id for the group, e.g. "every ad set under campaign X" still
  // rolls up to a single row whose campaign_id is X. So this does NOT also
  // require `!needsRollup`.
  const statusIdField = LEVEL_ID_FIELD[level];
  const canHaveStatus = !!statusIdField;
  // Budget is never an Ad-level concept (only campaigns/ad sets carry one),
  // unlike status/entityId which are meaningful at every non-account level.
  const canHaveBudget = canHaveStatus && (level === "campaign" || level === "adset");

  const rows = [];
  // Every account's own (already filtered + rolled-up) raw rows, paired with
  // that account's own custom-conversion definitions — collected here so the
  // Total row below (see aggregateRowMetrics) can combine every account's
  // rows together while still resolving each row's custom conversions
  // against the right account, the same scoping `accountCustomEvents` below
  // already applies to the per-row output loop.
  const allCurrentEntries = [];
  const allPreviousEntries = [];
  for (const accountId of accountIds) {
    let { current, previous } = byAccount.get(accountId);

    if (canAddZeroRows) {
      const idField = LEVEL_ID_FIELD[fetchLevel];
      const have = new Set(current.map((r) => r[idField]));
      const extra = (zeroRowsByAccount[accountIds.indexOf(accountId)] || []).filter((r) => !have.has(r[idField]));
      current = [...current, ...extra];
    }

    // Only this account's own custom conversions apply to its rows — a
    // custom conversion's action_type is meaningless outside the Facebook
    // account that owns it, so a metric key for account X's custom
    // conversion must resolve to 0/absent on every other account's rows
    // rather than accidentally picking up a same-id coincidence. Every
    // entry's accountId was already checked against this request's
    // accountIds above (see cleanCustomEvents validation).
    const accountCustomEvents = cleanCustomEvents.filter((ce) => ce.accountId === accountId);

    // Applied before anything else touches these rows — dropping a
    // filtered-out entity here means it never contributes to a rollup's sum
    // below, the same as if Facebook had never returned it. Counted (not
    // removed.length directly) since this runs per account and
    // compareToPrevious doubles the per-account row count without doubling
    // the number of *entities* a user would think of as filtered out.
    const preFilterCount = current.length;
    current = applyNameFilters(current, cleanNameFilters);
    previous = applyNameFilters(previous, cleanNameFilters);
    filteredByNameCount += preFilterCount - current.length;

    // Applied as its own, separate narrowing step (not folded into the
    // name-filter count above, which is specifically about that filter) —
    // "only show these IDs" and the name filters above can both be active at
    // once, each independently shrinking the set before it's rolled up.
    if (cleanIdFilter) {
      current = applyIdFilter(current, cleanIdFilter);
      previous = applyIdFilter(previous, cleanIdFilter);
    }

    // Rolls the (already filtered) finer-grained rows back up to `level` —
    // e.g. every remaining campaign's rows become one Account-level total
    // per date/breakdown, with the excluded campaigns' numbers genuinely
    // absent from the sum rather than merely hidden from a table. A no-op
    // when `fetchLevel === level` (the common case — no active filter forced
    // a finer fetch), since each remaining row is already exactly the shape
    // `level` expects.
    if (needsRollup) {
      current = rollupRows(current, level, breakdownGroup, cleanCustomFields);
      previous = rollupRows(previous, level, breakdownGroup, cleanCustomFields);
    }

    if (!wantZeroSpend && level !== "account" && !validTimeIncrement) {
      current = current.filter((r) => parseFloat(r.spend || 0) > 0);
    }

    for (const row of current) allCurrentEntries.push({ row, customEvents: accountCustomEvents });
    if (compareToPrevious) {
      for (const row of previous) allPreviousEntries.push({ row, customEvents: accountCustomEvents });
    }

    // Scoped to this one account's own current/previous pair — at the
    // account level (no breakdown, no entity), rowIdentityKey's id part is
    // the literal string "account" for every account, so a Map shared
    // across accounts would let one account's previous-period row silently
    // match against a different account's current row. Keeping this Map
    // local to each loop iteration is what prevents that collision.
    const previousByKey = new Map();
    for (const row of previous) {
      previousByKey.set(rowIdentityKey(row, level, breakdownGroup), row);
    }

    for (const row of current) {
      const metrics = deriveRowMetrics(row, effectiveMetricKeys, outputCustomFields, cleanCustomMetrics, accountCustomEvents);
      const out = {
        accountId,
        label: rowLabel(row, level, breakdownGroup),
        entityLabel: rowEntityLabel(row, level),
        breakdownLabel: rowBreakdownLabel(row, breakdownGroup),
        // Exposed independently of `entityLabel` (which is only ever the
        // *selected* level's own name) for the "exclude rows by name" UI to
        // show which campaign/ad set/ad a row came from. `null` whenever
        // this row is itself a rollup of several entities (mergeRawRows()
        // above keeps rows[0]'s own name fields verbatim, which would
        // otherwise look like "this whole total is just this one campaign").
        campaignName: needsRollup ? null : row.campaign_name ?? null,
        adsetName: needsRollup ? null : row.adset_name ?? null,
        adName: needsRollup ? null : row.ad_name ?? null,
        ...metrics,
      };
      if (row.date_start) out.date = row.date_start;
      // The row's own id at `level` — read by the status lookup below, and
      // also sent to the client as-is so the results table can offer a
      // "copy ID" action (for jumping straight to this exact entity in
      // another view/date range via the "only show these IDs" filter).
      // Same gating as status: absent only at the account level, where
      // there's no single entity to point at.
      if (canHaveStatus) out.entityId = row[statusIdField] || null;

      if (compareToPrevious) {
        const prevRow = previousByKey.get(rowIdentityKey(row, level, breakdownGroup));
        const prevMetrics = prevRow
          ? deriveRowMetrics(prevRow, effectiveMetricKeys, outputCustomFields, cleanCustomMetrics, accountCustomEvents)
          : null;
        out._previous = prevMetrics;
        out._deltaPct = {};
        for (const key of allKeys) {
          const curVal = metrics[key];
          const prevVal = prevMetrics ? prevMetrics[key] : null;
          out._deltaPct[key] =
            typeof curVal === "number" && typeof prevVal === "number" && prevVal !== 0
              ? ((curVal - prevVal) / Math.abs(prevVal)) * 100
              : null;
        }
      }
      rows.push(out);
    }
  }

  // A "Total" row for the client to pin above/below the real rows — only at
  // a non-account level, where several rows actually exist to total up (an
  // Account-level result is already one row per account, nothing to sum).
  // Shaped exactly like a normal output row (down to `_previous`/
  // `_deltaPct`, the comparison-mode shape every column render function
  // already knows how to read) so the client needs no special-casing beyond
  // recognizing this one extra row. Built from the exact same `allKeys` the
  // per-row comparison loop above uses, over every account's full (filtered,
  // rolled-up, but NOT client-side status/search-filtered — this endpoint
  // has no visibility into that) current/previous rows.
  let totalsRow = null;
  if (level !== "account" && allCurrentEntries.length > 0) {
    const totals = aggregateRowMetrics(allCurrentEntries, effectiveMetricKeys, cleanCustomMetrics);
    totalsRow = { label: "Total", entityLabel: "Total", ...totals };
    if (compareToPrevious) {
      const previousTotals = aggregateRowMetrics(allPreviousEntries, effectiveMetricKeys, cleanCustomMetrics);
      totalsRow._previous = previousTotals;
      totalsRow._deltaPct = {};
      for (const key of allKeys) {
        const curVal = totals[key];
        const prevVal = previousTotals[key];
        totalsRow._deltaPct[key] =
          typeof curVal === "number" && typeof prevVal === "number" && prevVal !== 0
            ? ((curVal - prevVal) / Math.abs(prevVal)) * 100
            : null;
      }
    }
  }

  // One lookup across every account/row together (not per-account), so an
  // id used by several rows (e.g. the same campaign appearing once per
  // breakdown value) is only ever fetched once.
  // Status, budgets and (optionally) creative details are independent lookups
  // over the same entity ids — fired together instead of one after another.
  // Each one soft-fails on its own (see the per-block notes below).
  const lookupIds = [...new Set(rows.map((r) => r.entityId).filter(Boolean))];
  const softFail = (promise, fallback) => promise.catch(() => fallback);
  const [statusById, budgetById, detailsByAdId] = await Promise.all([
    canHaveStatus ? softFail(fetchEntityStatuses(lookupIds, token), {}) : {},
    canHaveBudget ? softFail(fetchEntityBudgets(lookupIds, token), {}) : {},
    includeCreative && level === "ad" ? softFail(fetchAdDetails(lookupIds, token), {}) : {},
  ]);

  // Status only powers an optional filter, so a failed lookup just means no status on any row.
  if (canHaveStatus) {
    for (const row of rows) {
      row.status = statusById[row.entityId] || null;
    }
  }

  // Powers the Explore row-actions "Change Budget" option — a row only gets it when
  // the entity it points at actually owns a budget (see canHaveBudget and
  // fetchEntityBudgets' own comment for the CBO/ABO reasoning).
  if (canHaveBudget) {
    for (const row of rows) {
      const budget = budgetById[row.entityId];
      row.dailyBudget = budget?.dailyBudget ?? null;
      row.lifetimeBudget = budget?.lifetimeBudget ?? null;
      // Overwrites the `budget` field's placeholder `null` from the generic
      // metric-extraction pass above (see METRIC_CATALOG's own comment) with
      // whichever of the two is actually set — an entity never has both.
      row.budget = row.dailyBudget ?? row.lifetimeBudget ?? null;
    }
  }

  // Opt-in via `includeCreative` (the drill-down/RCA paths); a top-level Ad-level query
  // fetches thumbnails separately in the background — see pages/explore.js.
  if (includeCreative && level === "ad") {
    for (const row of rows) {
      const details = detailsByAdId[row.entityId];
      row.thumbnailUrl = details?.thumbnailUrl ?? null;
      row.isVideo = !!details?.videoId;
      // Overwrites the `landing_page` metric's placeholder `null` from the
      // generic extraction pass above (same convention as `budget` just
      // above) — doesn't resolve the post-based fallback fetchPostLandingUrls()
      // covers (details.postId), same tradeoff this drill-down path already
      // makes for thumbnails: good enough for a small, synchronously-fetched
      // id list, not worth a second Graph round trip here.
      row.landing_page = details?.landingUrl ?? null;
    }
  }

  // Per-entity pivot summaries — one row per entity, aggregated across every
  // date bucket it has, for Explore's table to show when a real level (not
  // Account) and time grouping are both active: one row per entity instead
  // of a flat (entity, date) list, with each entity's own date rows (already
  // right there in `rows`) nested underneath it client-side. Computed the
  // same way as `totalsRow` above — real per-metric sums with ratios
  // re-derived from those sums, never an average of already-computed
  // per-day percentages — just grouped by entity instead of collapsed into
  // one grand total. Built from `allCurrentEntries` (the pre-derive raw
  // rows `aggregateRowMetrics`'s per-metric `aggregate()` functions need —
  // they read Facebook's own raw field names like `inline_link_clicks`,
  // which the already-derived `rows` below no longer carry at all) and
  // cross-referenced against `rows` (now fully enriched with status/budget/
  // creative, right above) only for the handful of fields that don't vary
  // by date and don't need re-aggregating in the first place.
  // compareToPrevious is unreachable here — already rejected above whenever
  // validTimeIncrement is set — so there's no previous-period counterpart
  // to compute for these the way totalsRow has one.
  let pivotRows = null;
  if (validTimeIncrement && level !== "account" && group.breakdowns.length === 0 && statusIdField) {
    const entriesByEntity = new Map();
    for (const entry of allCurrentEntries) {
      const id = entry.row[statusIdField];
      if (!id) continue;
      if (!entriesByEntity.has(id)) entriesByEntity.set(id, []);
      entriesByEntity.get(id).push(entry);
    }
    pivotRows = [...entriesByEntity.entries()]
      .map(([entityId, entries]) => {
        const sample = rows.find((r) => r.entityId === entityId);
        if (!sample) return null;
        const metrics = aggregateRowMetrics(entries, effectiveMetricKeys, cleanCustomMetrics);
        return {
          entityId,
          accountId: sample.accountId,
          label: sample.entityLabel,
          entityLabel: sample.entityLabel,
          status: sample.status,
          dailyBudget: sample.dailyBudget,
          lifetimeBudget: sample.lifetimeBudget,
          thumbnailUrl: sample.thumbnailUrl,
          isVideo: sample.isVideo,
          ...metrics,
        };
      })
      .filter(Boolean);
  }

  const meta = {
    level,
    breakdownGroup,
    metricKeys: effectiveMetricKeys,
    customFields: outputCustomFields,
    accountIds,
    accountErrors,
    since,
    until,
    timeIncrement: validTimeIncrement,
    compareToPrevious: !!compareToPrevious,
    previousSince: previousRange?.since || null,
    previousUntil: previousRange?.until || null,
    rowCount: rows.length,
    zeroSpendIncluded: canAddZeroRows,
    // What the caller asked for (drill-down children reuse it), and why the zero-spend listing came back empty if it failed.
    includeZeroSpendRequested: wantZeroSpend,
    zeroSpendFailure,
    // Lets the UI explain itself: whether a name filter forced fetching at
    // a finer level than requested and rolling the result back up (and, if
    // so, which requested metrics got dropped because they can't be
    // correctly re-aggregated — see REACH_DEPENDENT_KEYS), and how many
    // underlying entities a filter (exclude or include) actually filtered out.
    nameFiltersApplied: cleanNameFilters.length > 0,
    idFilterApplied: !!cleanIdFilter,
    rollupApplied: needsRollup,
    excludedMetrics,
    filteredByNameCount,
    // Tells the client whether rows carry a real `status` and the Status
    // filter is worth showing at all — false only at the account level,
    // which has no single entity to check.
    statusAvailable: canHaveStatus,
    // Tells the client whether rows carry real `dailyBudget`/`lifetimeBudget`
    // fields worth checking for the "Change Budget" row action — false at
    // the account level and the Ad level, where a budget action never makes
    // sense; true at Campaign/Ad Set level even though any individual row
    // there might still come back with neither field set (ABO campaign /
    // CBO-parented ad set, respectively — see fetchEntityBudgets).
    budgetAvailable: canHaveBudget,
    // A pinned "Total" row the client renders outside normal sort/search/
    // pagination (see pages/explore.js) — `null` at the account level,
    // where there's nothing to total (one row per account already).
    totalsRow,
    // One aggregated row per entity when time grouping is active at a real
    // level (see the computation above) — `null` otherwise, including at
    // the account level or whenever a breakdown is also active, where
    // there's no single-entity pivot to offer.
    pivotRows,
    // Tells the client whether Ad-level rows already carry real
    // `thumbnailUrl`/`isVideo` values (true only when the caller actually
    // asked for them via `includeCreative`) or still need the separate,
    // lazy /api/fb/ad-thumbnails fetch — see pages/explore.js's
    // loadThumbnailsForView(). Meaningless (and left false) at every other
    // level, which never carries creative data regardless.
    thumbnailsFetched: includeCreative && level === "ad",
    // Same idea as thumbnailsFetched, for the `landing_page` metric — true
    // only when this same `includeCreative` lookup already resolved it (the
    // drill-down/expand path), false otherwise so pages/explore.js's own
    // loadLandingPagesForView() knows it still needs to run.
    landingPagesFetched: includeCreative && level === "ad",
  };
  res.write(`${JSON.stringify({ type: "done", rows, meta })}\n`);
  res.end();
}
