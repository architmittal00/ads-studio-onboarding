import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import { graphGetAllPages } from "@/lib/facebookGraph";
import { MAX_IMPACT_CHANGES, impactWindowFor } from "@/lib/recentChangesImpact";

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

// Confirmed live: Facebook's Activity Log object_type isn't always reliable
// for a budget change specifically — one entry came back with
// object_type "CAMPAIGN" while its own translated_event_type read "Ad set
// budget updated" and the edited entity was, in fact, an ad set. Showing
// "Campaign" in that case isn't just a cosmetic label mismatch: the
// Investigate drawer's "View Ad Sets in this Campaign" drill-down
// (components/EntityDrillDown.js) then queries explore-insights for ad
// sets whose campaign_id equals this object's id — but the id is really an
// ad set's own id, so that query matches nothing and the drill-down looks
// broken. Meta's human-readable text is generated from the same underlying
// event it shows the user in Ads Manager, so when it unambiguously names
// one level and disagrees with the structural object_type, trust the text.
function resolveLevel(objectType, eventType, translatedEventType) {
  const normalized = String(objectType || "").toUpperCase().replace(/_/g, "");
  const structural = normalized === "CAMPAIGN" ? "Campaign" : "Ad Set";
  const haystack = `${eventType || ""} ${translatedEventType || ""}`.toLowerCase();
  const mentionsAdSet = /\bad ?set\b/.test(haystack);
  const mentionsCampaign = /\bcampaign\b/.test(haystack);
  if (structural === "Campaign" && mentionsAdSet && !mentionsCampaign) return "Ad Set";
  if (structural === "Ad Set" && mentionsCampaign && !mentionsAdSet) return "Campaign";
  return structural;
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

// extra_data is a JSON *string* carrying additional detail for many event
// types. Confirmed live: for a budget change, the old/new fields under keys
// like old_value/new_value are themselves OBJECTS (e.g. an amount+currency
// shape), not plain numbers or strings — interpolating one directly into a
// template string prints the literal text "[object Object]", which is
// exactly the bug a live account surfaced. Rather than guess at the nested
// shape (budget's own old/new keys aren't the only ones this would need to
// get right, and getting it wrong risks confidently showing a *wrong*
// number, worse than not showing one), the one-line description always uses
// Meta's own translated_event_type — a human-readable string Meta provides
// specifically for display, so it's never an object. The raw extra_data
// still travels to the client as `rawExtraData` for a future "Investigate"
// detail view to show as-is, which is also how a real shape ever gets
// confirmed instead of guessed at again.

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

function describeChange(translatedEventType, categoryLabel) {
  return translatedEventType || categoryLabel || "Change made";
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
        level: resolveLevel(entry.object_type, entry.event_type, entry.translated_event_type),
        actorName: entry.actor_name || "Unknown",
        eventTime: eventTimeToIso(entry.event_time),
        category,
        categoryLabel,
        description: describeChange(entry.translated_event_type, categoryLabel),
        rawExtraData: extraData,
      });
    }
  });

  if (changes.length === 0 && accountErrors.length === accountIds.length) {
    return res.status(firstFailure?.graphResponse ? 400 : 500).json({ error: firstFailure?.message || "Request failed" });
  }

  changes.sort((a, b) => new Date(b.eventTime) - new Date(a.eventTime));

  // Performance impact (Spend/Purchases/ROAS before vs. after) used to be
  // computed right here, inline, for every eligible change before this
  // endpoint ever responded — up to MAX_IMPACT_CHANGES * 2 extra Insights
  // calls, which meant the whole page stayed blank until all of them
  // finished (very noticeable on "Last 7 Days", where there are often many
  // more eligible changes). This endpoint now only decides *eligibility*
  // (cheap date math + a cap, zero extra Graph calls) and returns
  // immediately; pages/recent-changes.js fetches impact for the eligible
  // changes itself, in small batches, via
  // pages/api/fb/recent-changes/impact.js, right after this list renders —
  // so the list shows up first and quick-signal badges fill in
  // progressively as each batch resolves instead of blocking first paint.
  const truncated = changes.length > MAX_IMPACT_CHANGES;
  const impactEligible = changes.slice(0, MAX_IMPACT_CHANGES).filter((c) => c.eventTime);
  const impactEligibleIds = new Set(impactEligible.map((c) => c.id));
  for (const c of impactEligible) {
    c.tooRecent = impactWindowFor(c.eventTime).tooRecent;
  }
  for (const c of changes) {
    // Beyond MAX_IMPACT_CHANGES (or, rarely, missing an eventTime to compute
    // a window from) — flagged explicitly so the UI can say why this row has
    // no quick signal instead of silently showing nothing, which read as a
    // bug rather than the documented, deliberate cap.
    if (!impactEligibleIds.has(c.id)) c.impactCapped = true;
  }

  res.status(200).json({
    changes,
    meta: { accountIds, accountErrors, hours, rowCount: changes.length, truncated },
  });
}
