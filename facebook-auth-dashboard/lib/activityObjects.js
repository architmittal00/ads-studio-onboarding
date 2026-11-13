// Reading Meta's Activity Log entries: which level an entry belongs to, its parsed extra_data and its time. The same
// rules pages/api/fb/recent-changes.js applies (that file keeps its own copy; this one serves the per-entity history).

// The log reports Meta's legacy object names: a Campaign is "CAMPAIGN_GROUP", an Ad Set is "CAMPAIGN", an Ad is "ADGROUP".
const RAW_TO_LEVEL = { CAMPAIGNGROUP: "campaign", CAMPAIGN: "adset", ADSET: "adset", ADGROUP: "ad", AD: "ad", ACCOUNT: "account" };

// Meta's own wording occasionally disagrees with the structural type for Campaign vs Ad Set; the text wins there.
export function levelOfEntry(objectType, eventType, translatedEventType) {
  const raw = String(objectType || "").toUpperCase().replace(/_/g, "");
  const level = RAW_TO_LEVEL[raw] || raw.toLowerCase();
  if (level !== "campaign" && level !== "adset") return level;
  const text = `${eventType || ""} ${translatedEventType || ""}`.toLowerCase();
  const mentionsAdSet = /\bad ?set\b/.test(text);
  const mentionsCampaign = /\bcampaign\b/.test(text);
  if (level === "campaign" && mentionsAdSet && !mentionsCampaign) return "adset";
  if (level === "adset" && mentionsCampaign && !mentionsAdSet) return "campaign";
  return level;
}

export function parseExtraData(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function eventTimeToIso(eventTime) {
  const d = typeof eventTime === "number" ? new Date(eventTime * 1000) : new Date(eventTime);
  return isNaN(d.getTime()) ? null : d.toISOString();
}
