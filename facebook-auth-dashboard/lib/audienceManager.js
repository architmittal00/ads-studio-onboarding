import { graphGet, graphPost } from "./facebookGraph";

// Names tagged with our own prefix so a second launch finds and reuses these
// instead of creating duplicates every time ("auto-create if missing" implies
// check-then-create, not blind creation on every launch).
const VISITORS_AUDIENCE_NAME = "AUTO-Visitors180d";
const PURCHASERS_SEED_NAME = "AUTO-Purchasers730d-Seed";
const LOOKALIKE_NAME = "AUTO-Purchasers-LAL1pct-IN";

const LOOKALIKE_RATIO = 0.01; // 1%, per the user — not configurable yet
const LOOKALIKE_COUNTRY = "IN"; // matches the hardcoded India geo-targeting

async function findAudienceByName(accountId, token, name) {
  const json = await graphGet(`/${accountId}/customaudiences`, token, {
    fields: "id,name,subtype",
    limit: 200,
  });
  return (json.data || []).find((a) => a.name === name) || null;
}

// A website-pixel rule covering ALL visits ("visited_site" is Meta's
// implicit any-pageview event — no specific event name needed) or a named
// standard event (e.g. "Purchase") for the lookalike seed.
function websiteRule(pixelId, eventName, retentionDays) {
  return {
    inclusions: {
      operator: "or",
      rules: [
        {
          event_sources: [{ type: "pixel", id: pixelId }],
          retention_seconds: retentionDays * 86400,
          filter: {
            operator: "and",
            filters: [{ field: "event", operator: "=", value: eventName || "visited_site" }],
          },
        },
      ],
    },
  };
}

async function createWebsiteAudience(accountId, token, { name, pixelId, eventName, retentionDays }) {
  // No `subtype` here on purpose — confirmed live against a real account
  // that the current API version rejects it outright for a rule-based
  // request ("the parameter 'subtype' is not supported in the current API
  // version", error 2654/1870053). Turns out this ISN'T a blanket "subtype
  // is dead everywhere" change, though — see getOrCreateBuyerLookalike()
  // below, which hit the opposite error requiring it. For a `rule`-based
  // request specifically, Facebook infers WEBSITE from the rule's pixel
  // event_source and rejects an explicit subtype as redundant.
  const json = await graphPost(`/${accountId}/customaudiences`, token, {
    name,
    rule: websiteRule(pixelId, eventName, retentionDays),
    prefill: true,
  });
  return json.id;
}

// Finds (or creates) the "website visitors, last 180 days" Custom Audience
// used by retargeting ad sets. Pure website-visitor coverage — Page/IG
// "engagers" is a different Meta audience concept (subtype ENGAGEMENT, no
// pixel involved) and is attached as a second, separate custom_audiences
// entry on the ad set rather than merged into this one.
export async function getOrCreateVisitorsAudience(accountId, token, pixelId) {
  const existing = await findAudienceByName(accountId, token, VISITORS_AUDIENCE_NAME);
  if (existing) return { id: existing.id, created: false };
  const id = await createWebsiteAudience(accountId, token, {
    name: VISITORS_AUDIENCE_NAME,
    pixelId,
    eventName: null, // any visit
    retentionDays: 180,
  });
  return { id, created: true };
}

// Finds (or creates) the 1% India Lookalike of purchasers, creating the
// purchasers seed audience first if that's also missing. Returns both IDs
// since the seed is itself a real audience the account may want to reuse.
export async function getOrCreateBuyerLookalike(accountId, token, pixelId) {
  let seed = await findAudienceByName(accountId, token, PURCHASERS_SEED_NAME);
  let seedCreated = false;
  if (!seed) {
    const seedId = await createWebsiteAudience(accountId, token, {
      name: PURCHASERS_SEED_NAME,
      pixelId,
      eventName: "Purchase",
      retentionDays: 730, // Meta's max retention for purchase events
    });
    seed = { id: seedId };
    seedCreated = true;
  }

  const existingLookalike = await findAudienceByName(accountId, token, LOOKALIKE_NAME);
  if (existingLookalike) {
    return { id: existingLookalike.id, seedId: seed.id, created: false, seedCreated };
  }

  // Unlike the rule-based WEBSITE call above, a LOOKALIKE request DOES still
  // need `subtype` explicitly — confirmed live: omitting it here errors with
  // "(#100) Missing parameter(s): subtype", the opposite of the WEBSITE
  // case. So the real rule isn't "subtype is deprecated everywhere", just
  // that a `rule`-based request already implies WEBSITE on its own while an
  // origin_audience_id/lookalike_spec request still needs it spelled out.
  const json = await graphPost(`/${accountId}/customaudiences`, token, {
    name: LOOKALIKE_NAME,
    subtype: "LOOKALIKE",
    origin_audience_id: seed.id,
    lookalike_spec: { type: "similarity", ratio: LOOKALIKE_RATIO, country: LOOKALIKE_COUNTRY },
  });
  return { id: json.id, seedId: seed.id, created: true, seedCreated };
}
