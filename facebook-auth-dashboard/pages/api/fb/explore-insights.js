import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import { graphGetInsights } from "@/lib/facebookGraph";
import {
  LEVEL_OPTIONS,
  getBreakdownGroup,
  resolveGraphFields,
  deriveRowMetrics,
  rowIdentityKey,
  rowLabel,
  rowEntityLabel,
  rowBreakdownLabel,
} from "@/lib/insightsMetrics";

const MAX_RANGE_DAYS = 90;
const MAX_ACCOUNTS = 10;
// Multiple of 7 — when `time_increment=7` (weekly grouping), Facebook buckets
// days starting from each call's own `time_range.since`, so a chunk boundary
// that didn't land on a multiple of 7 would split one calendar week across
// two chunks as two partial-week rows instead of one. 28 (four weeks) keeps
// every chunk's week buckets contiguous with the next chunk's.
const CHUNK_DAYS = 28;
const VALID_LEVELS = LEVEL_OPTIONS.map((l) => l.value);
const DAY_MS = 24 * 60 * 60 * 1000;

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

// POST, not GET+query-string: the query spec (a breakdown group, a list of
// metric keys, an optional list of raw custom field names, a compare toggle)
// doesn't fit cleanly in a URL, and this endpoint isn't meant to be
// HTTP/CDN-cacheable the way /api/fb/report.js is — caching for this one is
// handled entirely client-side (lib/clientCache.js). Same precedent as
// /api/fb/interest-recommendations.js.
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
  const todayStr = isoDate(new Date());
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

  const validTimeIncrement = timeIncrement === "1" || timeIncrement === "7" ? timeIncrement : null;
  if (compareToPrevious && validTimeIncrement) {
    return res.status(400).json({
      error: "Compare-to-previous-period isn't supported together with daily/weekly grouping",
    });
  }

  const cleanCustomFields = Array.isArray(customFields) ? customFields.map((f) => String(f).trim()).filter(Boolean) : [];
  const group = getBreakdownGroup(breakdownGroup);
  const fields = resolveGraphFields(metricKeys, cleanCustomFields, level, cleanCustomMetrics).join(",");
  const token = session.accessToken;

  const baseParams = {
    level,
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
  const currentChunks = validTimeIncrement ? splitRangeIntoChunks(since, until, CHUNK_DAYS) : [{ since, until }];

  // One flat list of calls across every account, every current-period chunk,
  // and (when comparing) the previous period — run together in a single
  // Promise.allSettled, not nested per-account awaits, for the same reason
  // the original single-account compare-to-previous code ran its two calls
  // in parallel: graphGetInsights's async-job path can take up to its own
  // ~15s poll timeout per call, and there's no reason independent queries
  // should serialize that cost. allSettled (not all) so one revoked/erroring
  // account — or one failed chunk — doesn't block the rest from returning
  // data.
  const callPlan = [];
  const calls = [];
  for (const accountId of accountIds) {
    for (const chunk of currentChunks) {
      calls.push(graphGetInsights(`/${accountId}/insights`, token, { ...baseParams, time_range: chunk }));
      callPlan.push({ accountId, period: "current" });
    }
    if (compareToPrevious) {
      calls.push(graphGetInsights(`/${accountId}/insights`, token, { ...baseParams, time_range: previousRange }));
      callPlan.push({ accountId, period: "previous" });
    }
  }

  const settled = await Promise.allSettled(calls);

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
    // rather than an empty-but-200 response.
    return res.status(firstFailure?.graphResponse ? 400 : 500).json({ error: firstFailure?.message || "Request failed" });
  }

  const allKeys = [...metricKeys, ...cleanCustomFields];

  const rows = [];
  for (const accountId of accountIds) {
    const { current, previous } = byAccount.get(accountId);

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
      const metrics = deriveRowMetrics(row, metricKeys, cleanCustomFields, cleanCustomMetrics);
      const out = {
        accountId,
        label: rowLabel(row, level, breakdownGroup),
        entityLabel: rowEntityLabel(row, level),
        breakdownLabel: rowBreakdownLabel(row, breakdownGroup),
        // Exposed independently of `entityLabel` (which is only ever the
        // *selected* level's own name) so the client can offer a "exclude
        // rows by name" filter against campaign/ad set/ad name regardless of
        // which level is selected — e.g. filtering by campaign name while
        // viewing at the ad level. Each is already part of this level's own
        // LEVEL_EXTRA_FIELDS fetch (lib/insightsMetrics.js) whenever it's
        // meaningful, so this adds no new Graph API fields.
        campaignName: row.campaign_name ?? null,
        adsetName: row.adset_name ?? null,
        adName: row.ad_name ?? null,
        ...metrics,
      };
      if (row.date_start) out.date = row.date_start;

      if (compareToPrevious) {
        const prevRow = previousByKey.get(rowIdentityKey(row, level, breakdownGroup));
        const prevMetrics = prevRow ? deriveRowMetrics(prevRow, metricKeys, cleanCustomFields, cleanCustomMetrics) : null;
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

  res.status(200).json({
    rows,
    meta: {
      level,
      breakdownGroup,
      metricKeys,
      customFields: cleanCustomFields,
      accountIds,
      accountErrors,
      since,
      until,
      timeIncrement: validTimeIncrement,
      compareToPrevious: !!compareToPrevious,
      previousSince: previousRange?.since || null,
      previousUntil: previousRange?.until || null,
      rowCount: rows.length,
    },
  });
}
