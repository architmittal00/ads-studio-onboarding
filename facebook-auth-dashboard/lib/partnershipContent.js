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

// A piece of content authored by the Business's own Instagram account can
// never become a Partnership Ad, regardless of its own permission_status —
// confirmed against a real launch attempt's own Graph error: "@sheshaayurveda
// isn't a partner of @sheshaayurveda. You can select a post, where
// @sheshaayurveda is a partner to turn into a partnership ad." (code 100,
// subcode 3867018). Branded-content creatives require the advertiser to be a
// tagged PARTNER on someone ELSE's post — structurally impossible for a post
// you authored yourself. Content Discovery still often reports
// permission_status: AUTHORIZED for the account's own posts (that's a
// separate, unrelated "can this be boosted as an ad at all" signal, not
// "can this specifically become a Partnership/branded-content ad"), so this
// needs its own explicit, author-based check rather than folding into
// permission_status.
export function isOwnPost(item, igUserId) {
  return !!igUserId && !!item?.author?.ig_user_id && item.author.ig_user_id === igUserId;
}

export function permissionState(item, igUserId) {
  if (isOwnPost(item, igUserId)) return "own";
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
