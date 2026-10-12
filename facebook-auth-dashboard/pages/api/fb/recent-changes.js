import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import { graphGetAllPages } from "@/lib/facebookGraph";

const MAX_ACCOUNTS = 10;
const VALID_HOURS = [24, 72, 168, 720];

// Which Facebook Activity Log object_types count as "campaign or adset
// related" for this feed — ad-level and account-level activity (and
// anything else, e.g. audiences/images) is dropped. Normalized by removing
// underscores so both "AD_SET" and "ADSET" (Meta has used both spellings in
// different API eras/docs) match the same check.
function isCampaignOrAdSet(objectType) {
  const normalized = String(objectType || "").toUpperCase().replace(/_/g, "");
  return normalized === "CAMPAIGN" || normalized === "ADSET";
}

function levelLabel(objectType) {
  const normalized = String(objectType || "").toUpperCase().replace(/_/g, "");
  return normalized === "CAMPAIGN" ? "Campaign" : "Ad Set";
}

// Cosmetic-only bucketing (icon/badge), never a hard filter — anything that
// doesn't match a known pattern still shows up as "Other" with Meta's own
// translated_event_type text, rather than silently disappearing because this
// list doesn't happen to cover every event_type string Meta has ever shipped
// (not verified against a live account in this environment).
function categorize(eventType, translatedEventType) {
  const haystack = `${eventType || ""} ${translatedEventType || ""}`.toLowerCase();
  if (haystack.includes("budget")) return { key: "budget", label: "Budget Change" };
  if (haystack.includes("create")) return { key: "created", label: "Created" };
  if (haystack.includes("name")) return { key: "name", label: "Name Change" };
  if (haystack.includes("status") || haystack.includes("pause") || haystack.includes("activat") || haystack.includes("resume")) {
    return { key: "status", label: "Status Change" };
  }
  return { key: "other", label: "Other" };
}

// extra_data is a JSON *string* (not an object) carrying old/new values for
// many event types — exact key names aren't verified against a live account,
// so this tries several plausible pairs (same "try a few known variants"
// defensiveness lib/insightsMetrics.js already uses for uncertain action-type
// strings) and falls back to null when nothing matches, rather than guessing.
const VALUE_KEY_PAIRS = [
  ["old_value", "new_value"],
  ["value_old", "value_new"],
  ["old_budget", "new_budget"],
  ["budget_value_old", "budget_value"],
  ["old_status", "new_status"],
];

// Most Graph API time fields come back as ISO8601 strings (e.g.
// "2024-01-15T10:30:00+0000"), not Unix timestamps — but this isn't verified
// for the Activity Log's own event_time field specifically, so this handles
// both: a numeric value is treated as Unix seconds, anything else is handed
// straight to Date().
function eventTimeToIso(eventTime) {
  const asDate = typeof eventTime === "number" ? new Date(eventTime * 1000) : new Date(eventTime);
  return isNaN(asDate.getTime()) ? null : asDate.toISOString();
}

function parseExtraData(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function describeChange(category, extraData, translatedEventType) {
  if (extraData) {
    for (const [fromKey, toKey] of VALUE_KEY_PAIRS) {
      if (extraData[fromKey] !== undefined && extraData[toKey] !== undefined) {
        const fieldLabel = category === "budget" ? "Budget" : category === "status" ? "Status" : category === "name" ? "Name" : "Value";
        return `${fieldLabel}: ${extraData[fromKey]} → ${extraData[toKey]}`;
      }
    }
  }
  return translatedEventType || "Change made";
}

// Team-wide "what changed recently" feed, backed by Facebook's own Activity
// Log (/act_<id>/activities) rather than anything this dashboard tracks
// itself — so it reflects changes made anywhere (Ads Manager, this
// dashboard, any other tool), not just actions taken through this app.
export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session?.accessToken) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  const accountIds = String(req.query.accountIds || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (accountIds.length === 0) {
    return res.status(400).json({ error: "At least one accountId is required" });
  }
  if (accountIds.length > MAX_ACCOUNTS) {
    return res.status(400).json({ error: `Cannot query more than ${MAX_ACCOUNTS} accounts at once (got ${accountIds.length})` });
  }

  const hours = parseInt(req.query.hours, 10);
  if (!VALID_HOURS.includes(hours)) {
    return res.status(400).json({ error: `hours must be one of: ${VALID_HOURS.join(", ")}` });
  }

  const token = session.accessToken;
  const nowUnix = Math.floor(Date.now() / 1000);
  const sinceUnix = nowUnix - hours * 3600;

  const results = await Promise.allSettled(
    accountIds.map((accountId) =>
      graphGetAllPages(`/${accountId}/activities`, token, {
        since: sinceUnix,
        until: nowUnix,
        fields: "actor_name,event_type,event_time,object_id,object_name,object_type,extra_data,translated_event_type",
      })
    )
  );

  const changes = [];
  const accountErrors = [];
  let firstFailure = null;
  results.forEach((result, i) => {
    const accountId = accountIds[i];
    if (result.status !== "fulfilled") {
      if (!firstFailure) firstFailure = result.reason;
      accountErrors.push({ accountId, message: result.reason?.message || "Request failed" });
      return;
    }
    for (const entry of result.value.data || []) {
      if (!isCampaignOrAdSet(entry.object_type)) continue;
      const { key: category, label: categoryLabel } = categorize(entry.event_type, entry.translated_event_type);
      const extraData = parseExtraData(entry.extra_data);
      changes.push({
        id: `${accountId}:${entry.object_id}:${entry.event_time}`,
        accountId,
        objectId: entry.object_id,
        objectName: entry.object_name,
        level: levelLabel(entry.object_type),
        actorName: entry.actor_name || "Unknown",
        eventTime: eventTimeToIso(entry.event_time),
        category,
        categoryLabel,
        description: describeChange(category, extraData, entry.translated_event_type),
      });
    }
  });

  if (changes.length === 0 && accountErrors.length === accountIds.length) {
    return res.status(firstFailure?.graphResponse ? 400 : 500).json({ error: firstFailure?.message || "Request failed" });
  }

  changes.sort((a, b) => new Date(b.eventTime) - new Date(a.eventTime));

  res.status(200).json({
    changes,
    meta: { accountIds, accountErrors, hours, rowCount: changes.length },
  });
}
