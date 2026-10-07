import { graphGetAllPages, graphPost } from "./facebookGraph";

// Names tagged with our own prefix so a second launch finds and reuses these
// instead of creating duplicates every time ("auto-create if missing" implies
// check-then-create, not blind creation on every launch).
const VISITORS_AUDIENCE_NAME = "AUTO-Visitors180d";
const ENGAGERS_AUDIENCE_NAME = "AUTO-Engagers365d";
const PURCHASERS_SEED_NAME = "AUTO-Purchasers730d-Seed";
const LOOKALIKE_NAME = "AUTO-Purchasers-LAL1pct-IN";

const LOOKALIKE_RATIO = 0.01; // 1%, per the user — not configurable yet
const LOOKALIKE_COUNTRY = "IN"; // matches the hardcoded India geo-targeting

// Paginates to completion — an account with more than one page of custom
// audiences (200+) would otherwise risk this not finding an
// already-created one on later pages and creating a duplicate.
async function findAudienceByName(accountId, token, name) {
  const json = await graphGetAllPages(`/${accountId}/customaudiences`, token, {
    fields: "id,name,subtype",
    limit: 200,
  });
  return (json.data || []).find((a) => a.name === name) || null;
}

// A rule-based audience definition shared by website-pixel audiences (e.g.
// "visited_site" for any visit, or a named standard event like "Purchase")
// and Page-engagement audiences ("page_engaged" — Meta's broadest engagement
// event, covering anyone who visited the Page or engaged with any of its
// content/ads, which is what "ad engagers" means in practice since ad
// engagement rolls up to Page engagement). Same `{event_sources, filter}`
// shape either way, just a different source type/id.
function audienceRule({ sourceType, sourceId, eventValue, retentionDays }) {
  return {
    inclusions: {
      operator: "or",
      rules: [
        {
          event_sources: [{ type: sourceType, id: sourceId }],
          retention_seconds: retentionDays * 86400,
          filter: {
            operator: "and",
            filters: [{ field: "event", operator: "=", value: eventValue }],
          },
        },
      ],
    },
  };
}

async function createRuleAudience(accountId, token, { name, rule }) {
  // No `subtype` here on purpose — confirmed live against a real account
  // that the current API version rejects it outright for a rule-based
  // request ("the parameter 'subtype' is not supported in the current API
  // version", error 2654/1870053). Turns out this ISN'T a blanket "subtype
  // is dead everywhere" change, though — see getOrCreateBuyerLookalike()
  // below, which hit the opposite error requiring it. For a `rule`-based
  // request specifically (website pixel OR Page engagement — same shape),
  // Facebook infers the audience type from the rule's event_sources and
  // rejects an explicit subtype as redundant.
  const json = await graphPost(`/${accountId}/customaudiences`, token, { name, rule, prefill: true });
  return json.id;
}

// Finds (or creates) the "website visitors, last 180 days" Custom Audience
// used by retargeting ad sets.
export async function getOrCreateVisitorsAudience(accountId, token, pixelId) {
  const existing = await findAudienceByName(accountId, token, VISITORS_AUDIENCE_NAME);
  if (existing) return { id: existing.id, created: false };
  const id = await createRuleAudience(accountId, token, {
    name: VISITORS_AUDIENCE_NAME,
    rule: audienceRule({ sourceType: "pixel", sourceId: pixelId, eventValue: "visited_site", retentionDays: 180 }),
  });
  return { id, created: true };
}

// Finds (or creates) the "Page/ad engagers, last 365 days" Custom Audience —
// "page_engaged" is Meta's broadest engagement event (visited the Page or
// engaged with any of its content/ads), which is what "ad engagers" means in
// practice: ad-level engagement rolls up to the Page. 365 days is the max
// retention Meta allows for engagement audiences (vs. 180 for standard
// website events). Used alongside the visitors audience above — unioned as
// a second custom_audiences entry on the ad set, not merged into one
// audience, since they're different Meta audience objects (WEBSITE vs
// Page-engagement) under the hood.
export async function getOrCreateEngagersAudience(accountId, token, pageId) {
  const existing = await findAudienceByName(accountId, token, ENGAGERS_AUDIENCE_NAME);
  if (existing) return { id: existing.id, created: false };
  const id = await createRuleAudience(accountId, token, {
    name: ENGAGERS_AUDIENCE_NAME,
    rule: audienceRule({ sourceType: "page", sourceId: pageId, eventValue: "page_engaged", retentionDays: 365 }),
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
    const seedId = await createRuleAudience(accountId, token, {
      name: PURCHASERS_SEED_NAME,
      rule: audienceRule({ sourceType: "pixel", sourceId: pixelId, eventValue: "Purchase", retentionDays: 730 }), // Meta's max retention for purchase events
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
