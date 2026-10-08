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

const MAX_RANGE_DAYS = 30;
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
    accountId,
    level = "account",
    breakdownGroup = "none",
    metricKeys,
    customFields,
    customMetrics,
    since,
    until,
    timeIncrement,
    compareToPrevious,
  } = req.body || {};

  if (!accountId) {
    return res.status(400).json({ error: "accountId is required" });
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
  const calls = [graphGetInsights(`/${accountId}/insights`, token, baseParams)];

  if (compareToPrevious) {
    // Immediately-preceding period of equal length — e.g. a 7-day range
    // compares against the 7 days right before it ("week-over-week" when
    // the chosen range happens to be a week, but this works for any length).
    const prevUntil = new Date(`${since}T00:00:00Z`);
    prevUntil.setUTCDate(prevUntil.getUTCDate() - 1);
    const prevSince = new Date(prevUntil);
    prevSince.setUTCDate(prevSince.getUTCDate() - (rangeDays - 1));
    previousRange = { since: isoDate(prevSince), until: isoDate(prevUntil) };
    // Run both periods in parallel, not sequentially — graphGetInsights's
    // async-job path can take up to its own ~15s poll timeout per call, and
    // there's no reason two independent queries should serialize that cost.
    calls.push(graphGetInsights(`/${accountId}/insights`, token, { ...baseParams, time_range: previousRange }));
  }

  let results;
  try {
    results = await Promise.all(calls);
  } catch (err) {
    return res.status(err.graphResponse ? 400 : 500).json({ error: err.message });
  }

  const [currentJson, previousJson] = results;
  const currentRaw = currentJson.data || [];
  const previousRaw = previousJson?.data || [];

  const previousByKey = new Map();
  for (const row of previousRaw) {
    previousByKey.set(rowIdentityKey(row, level, breakdownGroup), row);
  }

  const allKeys = [...metricKeys, ...cleanCustomFields];

  const rows = currentRaw.map((row) => {
    const metrics = deriveRowMetrics(row, metricKeys, cleanCustomFields, cleanCustomMetrics);
    const out = {
      label: rowLabel(row, level, breakdownGroup),
      entityLabel: rowEntityLabel(row, level),
      breakdownLabel: rowBreakdownLabel(row, breakdownGroup),
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
    return out;
  });

  res.status(200).json({
    rows,
    meta: {
      level,
      breakdownGroup,
      metricKeys,
      customFields: cleanCustomFields,
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
