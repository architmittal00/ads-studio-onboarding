// Pure helpers over one Content Discovery API item's shape — shared by
// client components (PartnerCard, ExpandedCardModal, …) and safe to import
// there, unlike lib/partnershipAds.js which pulls in server-only Graph
// helpers. Keep anything that touches `fetch`/tokens out of this file.

// `partnership_info` is an array on the raw API shape (first entry used,
// matching the Python reference's own `partnership_info[0] if ... else {}`
// convention) — most callers just want "this item's partnership info," not
// the array itself.
export function firstPartnershipInfo(item) {
  return item?.partnership_info?.[0] || {};
}

export function permissionState(item) {
  const info = firstPartnershipInfo(item);
  const status = (info.permission_status || "").toUpperCase();
  if (status === "AUTHORIZED") return "ready";
  if (status === "PENDING" || status === "REQUESTED") return "requested";
  return "need";
}

const COMPACT_FMT = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

export function formatCompactNumber(n) {
  if (typeof n !== "number" || isNaN(n)) return "—";
  return COMPACT_FMT.format(n);
}
