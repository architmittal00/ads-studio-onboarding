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

// A piece of content with no eligible tagged partner can never become a
// Partnership Ad — confirmed against a real launch attempt's own Graph
// error: "@sheshaayurveda isn't a partner of @sheshaayurveda. You can select
// a post, where @sheshaayurveda is a partner to turn into a partnership ad."
// (code 100, subcode 3867018). Branded-content creatives require the
// advertiser to be a tagged PARTNER on someone ELSE's content — structurally
// impossible when there's no other party involved at all.
//
// Originally this checked ONLY `item.author.ig_user_id === igUserId` ("this
// account posted it itself"), which is right for a plain solo post but wrong
// for an Instagram Collab post: Content Discovery can report the item's
// `author` as the advertiser's own account even when the post also carries a
// genuine, distinct `tagged_partner` (the actual other collaborator) — the
// `author` field alone doesn't mean "nobody else is involved." Reported by
// the user: a card showing this exact "Your own post" badge was, in fact,
// the same content they'd just launched successfully by hand once
// lib/partnershipAds.js's createBrandedCreative sponsor-identity bug was
// fixed (PR #284) — proving it genuinely had a usable tagged partner the
// whole time, and this check was wrongly blocking it on `author` alone.
//
// Now: only treated as permanently ineligible when there's truly no OTHER
// party tagged on the content — i.e. `author` is the advertiser's own
// account AND `tagged_partner` is either absent or itself resolves back to
// the advertiser (a degenerate, self-referential tag). Anything with a real,
// distinct tagged_partner is eligible regardless of what `author` says,
// since `tagged_partner` is the field that actually encodes who this
// specific partnership-ad opportunity is with. Content Discovery still often
// reports permission_status: AUTHORIZED for the account's own posts too
// (that's a separate, unrelated "can this be boosted as an ad at all"
// signal, not "can this specifically become a Partnership/branded-content
// ad"), so this needs its own explicit check rather than folding into
// permission_status.
export function isOwnPost(item, igUserId) {
  if (!igUserId || !item?.author?.ig_user_id) return false;
  if (item.author.ig_user_id !== igUserId) return false;

  const partner = firstPartnershipInfo(item).tagged_partner;
  const hasDistinctPartner = !!partner && (partner.ig_user_id ? partner.ig_user_id !== igUserId : !!partner.fb_page_id);
  return !hasDistinctPartner;
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
