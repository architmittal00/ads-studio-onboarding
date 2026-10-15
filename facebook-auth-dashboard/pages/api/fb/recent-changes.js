import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import { graphGet, graphGetAllPages } from "@/lib/facebookGraph";
import { chunk } from "@/lib/adCreativeDetails";
import { MAX_IMPACT_CHANGES, impactWindowFor } from "@/lib/recentChangesImpact";

// Backs pages/recent-changes.js — one account at a time, a strict allowlist
// of 6 tracked actions (ad launched/paused, ad set/campaign budget change,
// ad set/campaign paused; anything else is dropped silently rather than
// shown as "Other" the way a flatter change feed might), pre-grouped into
// the entity "buckets" the landing view and per-entity drawer both expect,
// with changes nested and already attributed to the right level — the
// client does no grouping of its own beyond splitting a bucket's changes by
// day.
const VALID_HOURS = [24, 72, 168];

// See pages/recent-changes.js for the matching preset list.
function validateHours(raw) {
  const hours = parseInt(raw, 10);
  return VALID_HOURS.includes(hours) ? hours : null;
}

function normalizeObjectType(objectType) {
  return String(objectType || "").toUpperCase().replace(/_/g, "");
}

// Confirmed live (via this endpoint's own ?debug=1 diagnostic, see below,
// against a real account): the Activity Log's `object_type` field reports
// Meta's legacy three-tier object names, not the Campaign/Ad Set/Ad
// terminology used everywhere else in this API (campaign/ad set/ad CRUD,
// Insights, …) — a real Campaign's own activity comes back as
// "CAMPAIGN_GROUP", a real Ad Set's as "CAMPAIGN", and a real Ad's as
// "ADGROUP". This isn't an occasional mislabeling, it's simply this edge's
// naming — a raw "CAMPAIGN" entry's own translated_event_type read "Ad set
// ... updated" in every single example seen, never "Campaign ... updated".
// Modern spellings are still mapped too, defensively, in case Meta ever
// actually sends them here.
const RAW_OBJECT_TYPE_TO_LEVEL = {
  CAMPAIGNGROUP: "CAMPAIGN",
  CAMPAIGN: "ADSET",
  ADSET: "ADSET",
  ADGROUP: "AD",
  AD: "AD",
  ACCOUNT: "ACCOUNT",
};

function canonicalLevel(objectType) {
  const normalized = normalizeObjectType(objectType);
  return RAW_OBJECT_TYPE_TO_LEVEL[normalized] || normalized;
}

// A defensive safety net on top of the mapping above — even within the
// legacy naming scheme, Meta's own text occasionally disagrees with the
// structural object_type for a Campaign vs. Ad Set change specifically, and
// this endpoint's entity attribution would silently misfile such a change
// onto the wrong entity if it trusted the mapping alone. Only ever corrects
// between CAMPAIGN and ADSET — there's no confirmed equivalent confusion
// involving AD.
function resolveObjectType(objectType, eventType, translatedEventType) {
  const level = canonicalLevel(objectType);
  if (level !== "CAMPAIGN" && level !== "ADSET") return level;
  const haystack = `${eventType || ""} ${translatedEventType || ""}`.toLowerCase();
  const mentionsAdSet = /\bad ?set\b/.test(haystack);
  const mentionsCampaign = /\bcampaign\b/.test(haystack);
  if (level === "CAMPAIGN" && mentionsAdSet && !mentionsCampaign) return "ADSET";
  if (level === "ADSET" && mentionsCampaign && !mentionsAdSet) return "CAMPAIGN";
  return level;
}

// Confirmed live: a run-status change's own event_type/translated_event_type
// is generic at every level — "Ad status updated" / "Ad set status updated" /
// "Campaign status updated" — it never actually says "paused" or
// "activated"/"turned on". The real before/after state lives only in
// extra_data, as a plain `new_value` string ("Active", "Paused"/"Inactive",
// plus review-pipeline states like "Pending Review"/"Pending process" that
// aren't a deliberate pause — not tracked). The "..._to_be_set_after_review"
// event_type variant is a forward-looking "what this will become once
// review finishes" setting, not a completed status change, so only the
// plain "update_..._run_status" event_type is read here.
function statusFromExtraData(extraData) {
  const newValue = extraData?.new_value;
  if (newValue === "Active") return "on";
  if (newValue === "Paused" || newValue === "Inactive") return "off";
  return null;
}

// Budget-change detection stays text-based — confirmed live, Meta's own
// translated_event_type reliably contains "budget" for both an Ad Set's own
// budget update and a Campaign's own (e.g. "Ad set budget updated",
// "Campaign budget updated") — unlike run-status changes, there's no
// direction to get wrong here.
function isBudgetChange(eventType, translatedEventType) {
  return `${eventType || ""} ${translatedEventType || ""}`.toLowerCase().includes("budget");
}

// The entire tracked-action taxonomy for this page, by deliberate, explicit
// design — "only certain actions... for now" per the original ask. Anything
// not matching one of these six is dropped silently, not shown as "Other."
// `extraData` is the already-JSON.parse()'d extra_data (or null) — needed
// for run-status direction, see statusFromExtraData above.
function classifyAction(objectType, eventType, translatedEventType, extraData) {
  if (objectType === "AD") {
    if (eventType !== "update_ad_run_status") return null;
    const status = statusFromExtraData(extraData);
    if (status === "on") return "ad_launched";
    if (status === "off") return "ad_paused";
    return null;
  }
  if (objectType === "ADSET") {
    if (isBudgetChange(eventType, translatedEventType)) return "adset_budget_change";
    if (eventType === "update_ad_set_run_status" && statusFromExtraData(extraData) === "off") return "adset_paused";
    return null;
  }
  if (objectType === "CAMPAIGN") {
    if (isBudgetChange(eventType, translatedEventType)) return "campaign_budget_change";
    if (eventType === "update_campaign_run_status" && statusFromExtraData(extraData) === "off") return "campaign_paused";
    return null;
  }
  return null;
}

const ACTION_LABELS = {
  ad_launched: "Ad Launched",
  ad_paused: "Ad Paused",
  adset_budget_change: "Ad Set Budget Change",
  campaign_budget_change: "Campaign Budget Change",
  adset_paused: "Ad Set Paused",
  campaign_paused: "Campaign Paused",
};

// Which entity a tracked action's change is actually attributed to — one
// level up from where it happened, except for an entity's own direct
// property changes (its own budget, or Campaign's own pause), which stay
// exactly where they happened. Per the original spec: ad-level activity and
// an ad set's own budget change both read as "something about this ad set,"
// while an ad set being paused and a campaign's own budget/pause both read
// as "something about this campaign."
const BUCKET_LEVEL = {
  ad_launched: "adset",
  ad_paused: "adset",
  adset_budget_change: "adset",
  adset_paused: "campaign",
  campaign_budget_change: "campaign",
  campaign_paused: "campaign",
};

// true when the bucket this action belongs to is a DIFFERENT entity than
// the one Facebook logged the activity against — those need a parent-id
// lookup (see fetchParents below) before they can be bucketed; the other
// three already carry their own id/name straight from the activity entry.
const NEEDS_PARENT_LOOKUP = { ad_launched: true, ad_paused: true, adset_paused: true };

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

// One `?ids=a,b,c` batch call per parent field needed — chunked the same way
// lib/adCreativeDetails.js's fetchAdDetails() chunks ad-detail lookups, for
// the same reason (URL/response-size limits on a long id list). Soft-fails
// per id (a failed chunk just means those entries can't be bucketed and are
// dropped, not a failed request) — same reasoning as every other secondary
// enrichment lookup in this app (status, budget, creative thumbnails).
async function fetchParents(ids, token, fields) {
  const byId = {};
  if (ids.length === 0) return byId;
  const batches = chunk(ids, 50);
  const results = await Promise.allSettled(batches.map((batch) => graphGet("", token, { ids: batch.join(","), fields })));
  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    Object.assign(byId, result.value || {});
  }
  return byId;
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session?.accessToken) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  const accountId = typeof req.query.accountId === "string" ? req.query.accountId.trim() : "";
  if (!accountId) {
    return res.status(400).json({ error: "accountId is required" });
  }
  const hours = validateHours(req.query.hours);
  if (!hours) {
    return res.status(400).json({ error: `hours must be one of: ${VALID_HOURS.join(", ")}` });
  }

  const token = session.accessToken;
  const nowUnix = Math.floor(Date.now() / 1000);
  const sinceUnix = nowUnix - hours * 3600;

  let activity;
  try {
    // `limit` matters a lot here: graphGetAllPages (lib/facebookGraph.js)
    // walks `paging.next` strictly sequentially, one full round-trip per
    // page, and Facebook's own default page size for this edge is small
    // (tens of rows). A busy account's 7-day Activity Log can easily be
    // thousands of raw entries (every action, not just the six this endpoint
    // tracks) — at the default page size that's enough sequential
    // round-trips to blow past the 60s function budget (confirmed: this was
    // the cause of a live FUNCTION_INVOCATION_TIMEOUT). 500/page (the same
    // cap used everywhere else list data is paginated in this app, e.g.
    // pages/api/fb/campaigns-list.js) cuts the round-trip count by ~20x.
    activity = await graphGetAllPages(`/${accountId}/activities`, token, {
      since: sinceUnix,
      until: nowUnix,
      limit: 500,
      fields: "actor_name,event_type,event_time,object_id,object_name,object_type,extra_data,translated_event_type",
    });
  } catch (err) {
    return res.status(err.graphResponse ? 400 : 500).json({ error: err.message });
  }

  // Opt-in diagnostic (?debug=1), not rendered anywhere in the UI — kept
  // around (not just for the original Ad-level investigation) since
  // classifyAction's text/extra_data assumptions are still only confirmed
  // against one account; this is how a future mismatch gets confirmed
  // instead of guessed at again, same reasoning lib/activityChangeDetail.js's
  // own comment gives for keeping rawExtraData around.
  const debugMode = req.query.debug === "1";
  const debugSamples = [];
  const seenDebugCombos = new Set();

  // First pass: resolve each entry's corrected object_type, parse its
  // extra_data once, and classify — dropping anything that isn't one of the
  // six tracked actions up front, so only entries that survive need a
  // parent-id lookup at all.
  const classified = [];
  for (const entry of activity.data || []) {
    const objectType = resolveObjectType(entry.object_type, entry.event_type, entry.translated_event_type);
    const extraData = parseExtraData(entry.extra_data);
    const action = classifyAction(objectType, entry.event_type, entry.translated_event_type, extraData);
    if (debugMode) {
      // Deliberately excludes extra_data from the dedup key — two budget
      // changes with the same event_type but different amounts would
      // otherwise both count as "distinct," crowding out the 50-sample cap
      // with near-duplicates instead of actual variety. extraData is still
      // included in the sample itself below.
      const combo = `${entry.object_type}|${objectType}|${entry.event_type}|${entry.translated_event_type}`;
      if (!seenDebugCombos.has(combo) && debugSamples.length < 50) {
        seenDebugCombos.add(combo);
        debugSamples.push({
          rawObjectType: entry.object_type,
          resolvedObjectType: objectType,
          eventType: entry.event_type,
          translatedEventType: entry.translated_event_type,
          extraData,
          matchedAction: action,
        });
      }
    }
    if (!action) continue;
    classified.push({ entry, objectType, action, extraData });
  }

  const adIdsNeeded = [...new Set(classified.filter((c) => c.action === "ad_launched" || c.action === "ad_paused").map((c) => c.entry.object_id))];
  const adsetIdsNeeded = [...new Set(classified.filter((c) => c.action === "adset_paused").map((c) => c.entry.object_id))];

  const [adParents, adsetParents] = await Promise.all([
    fetchParents(adIdsNeeded, token, "adset_id,adset{name}"),
    fetchParents(adsetIdsNeeded, token, "campaign_id,campaign{name}"),
  ]);

  const buckets = new Map();
  let rowCount = 0;

  for (const { entry, action, extraData } of classified) {
    let bucketLevel = BUCKET_LEVEL[action];
    let bucketId = null;
    let bucketName = null;

    if (NEEDS_PARENT_LOOKUP[action]) {
      if (action === "ad_launched" || action === "ad_paused") {
        const parent = adParents[entry.object_id];
        bucketId = parent?.adset_id || null;
        bucketName = parent?.adset?.name || null;
      } else {
        const parent = adsetParents[entry.object_id];
        bucketId = parent?.campaign_id || null;
        bucketName = parent?.campaign?.name || null;
      }
      // The parent lookup failed or came back empty — there's no reliable
      // entity to attach this change to, so it's dropped rather than shown
      // against a guessed or blank bucket.
      if (!bucketId) continue;
    } else {
      bucketId = entry.object_id;
      bucketName = entry.object_name;
    }

    const bucketKey = `${bucketLevel}:${bucketId}`;
    if (!buckets.has(bucketKey)) {
      buckets.set(bucketKey, { level: bucketLevel, entityId: bucketId, entityName: bucketName, accountId, changes: [] });
    }
    const bucket = buckets.get(bucketKey);
    if (!bucket.entityName && bucketName) bucket.entityName = bucketName;

    const eventTime = eventTimeToIso(entry.event_time);
    bucket.changes.push({
      id: `${accountId}:${entry.object_id}:${entry.event_time}`,
      action,
      actionLabel: ACTION_LABELS[action],
      eventTime,
      actorName: entry.actor_name || "Unknown",
      rawExtraData: extraData,
      // The actual object this specific change happened to — e.g. for an
      // ad_launched change bucketed onto its parent ad set, this is the ad
      // itself, not the ad set. Lets the client show "Ad 'X' launched"
      // inside the ad set's own change list instead of a generic entry with
      // no specifics.
      sourceObjectId: entry.object_id,
      sourceObjectName: entry.object_name,
    });
    rowCount++;
  }

  // Every Ad Set bucket's own parent Campaign (id + name) — needed for the
  // "in <campaign>" line shown under an Ad Set row and for the landing
  // page's own name/campaign search filter, which has to match Ad Set rows
  // by their parent campaign too, not just Campaign rows. A Campaign bucket
  // already *is* its own campaign, so no lookup is needed for those.
  const adsetBucketIds = [...buckets.values()].filter((b) => b.level === "adset").map((b) => b.entityId);
  const campaignParents = await fetchParents(adsetBucketIds, token, "campaign_id,campaign{name}");

  const entities = [...buckets.values()].map((bucket) => {
    const changes = bucket.changes.sort((a, b) => new Date(b.eventTime) - new Date(a.eventTime));
    const campaignId = bucket.level === "campaign" ? bucket.entityId : campaignParents[bucket.entityId]?.campaign_id || null;
    const campaignName = bucket.level === "campaign" ? bucket.entityName : campaignParents[bucket.entityId]?.campaign?.name || null;
    return {
      ...bucket,
      campaignId,
      campaignName,
      changeCount: changes.length,
      lastChangeTime: changes[0]?.eventTime || null,
      changes,
    };
  });
  entities.sort((a, b) => new Date(b.lastChangeTime) - new Date(a.lastChangeTime));

  // Each entity's own current live status (Active/Paused/...), for the
  // landing page's Active/Inactive filter and status badge — one more
  // batched `?ids=` node lookup via the same fetchParents() helper already
  // used above, not a bulk Insights call, so it carries none of the
  // pagination/timeout risk the Activity Log fetch above does.
  const statusById = await fetchParents(
    entities.map((e) => e.entityId),
    token,
    "effective_status"
  );
  for (const e of entities) {
    e.status = statusById[e.entityId]?.effective_status || null;
  }

  // Performance-impact eligibility (Spend/Purchases/ROAS, one day before vs.
  // one day after each entity's own most recent change) is decided here —
  // cheap date math only, zero extra Graph calls — exactly the same
  // "decide eligibility here, fetch the actual numbers client-side in small
  // batches after the list has already rendered" split this endpoint's own
  // Activity Log pagination fix (see the `limit: 500` comment above) was
  // itself motivated by: computing real before/after Insights calls for
  // every entity inline, in this same request, would reintroduce the exact
  // kind of unbounded-Graph-calls timeout that fix addressed. See
  // pages/recent-changes.js's fetchImpactProgressively and
  // pages/api/fb/recent-changes/impact.js for the actual lookup.
  const impactEligible = entities.slice(0, MAX_IMPACT_CHANGES).filter((e) => e.lastChangeTime);
  const impactEligibleIds = new Set(impactEligible.map((e) => `${e.level}:${e.entityId}`));
  for (const e of impactEligible) {
    const window = impactWindowFor(e.lastChangeTime);
    e.tooRecent = window.tooRecent;
    // How many days each side of the before/after comparison actually covers
    // — surfaced so pages/recent-changes.js can label its quick-signal
    // badges with the window they're actually summarizing instead of always
    // implying a fixed "1 day vs 1 day" the way this used to work.
    e.impactDays = window.daysElapsed;
  }
  for (const e of entities) {
    // Beyond MAX_IMPACT_CHANGES (or, rarely, missing a lastChangeTime to
    // compute a window from) — flagged explicitly so the UI can say why this
    // row has no quick signal instead of silently showing nothing.
    if (!impactEligibleIds.has(`${e.level}:${e.entityId}`)) e.impactCapped = true;
  }

  res.status(200).json({
    entities,
    meta: { accountId, hours, rowCount, truncated: entities.length > MAX_IMPACT_CHANGES, ...(debugMode ? { debugSamples } : {}) },
  });
}
