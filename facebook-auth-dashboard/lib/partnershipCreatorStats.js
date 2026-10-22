// Groups pages/api/fb/partnership/mine.js's own per-ad rows by creator — a
// pure client-side transform (the per-ad data is already fetched; no reason
// to round-trip to the server again just to group it). Ads with no resolved
// creator (lib/partnershipDetection.js's permalink lookup can fail or come
// back empty for a given ad) are bucketed under "Unknown" rather than
// dropped, so the total ad count here always matches My Partnership Ads'.
//
// Reach/Frequency are summed per-ad here, same as every other per-ad rollup
// in this app (see pages/api/fb/partnership/overview.js's own comment on the
// more-correct account-level IN-filter approach it uses instead) — Creator
// Hub is an exploratory view, not a billing-grade number, so the small
// double-counting a creator's own overlapping audiences across multiple ads
// can introduce is an accepted approximation here, not treated as exact.
export function groupByCreator(ads) {
  const byCreator = new Map();
  for (const ad of ads) {
    const key = ad.creatorIgId || ad.creatorUsername || "unknown";
    if (!byCreator.has(key)) {
      byCreator.set(key, {
        key,
        creatorUsername: ad.creatorUsername || null,
        creatorProfilePictureUrl: ad.creatorProfilePictureUrl || null,
        creatorFollowersCount: ad.creatorFollowersCount ?? null,
        ads: [],
        spend: 0,
        purchases: 0,
        purchaseValue: 0,
      });
    }
    const bucket = byCreator.get(key);
    // Every ad from the same resolved creator carries the same avatar/follower
    // data (it's a per-username lookup, not per-ad) — fill in from whichever
    // ad happens to have it first, same reasoning either way.
    if (!bucket.creatorProfilePictureUrl && ad.creatorProfilePictureUrl) bucket.creatorProfilePictureUrl = ad.creatorProfilePictureUrl;
    if (bucket.creatorFollowersCount == null && ad.creatorFollowersCount != null) bucket.creatorFollowersCount = ad.creatorFollowersCount;
    bucket.ads.push(ad);
    bucket.spend += ad.spend || 0;
    bucket.purchases += ad.purchases || 0;
    bucket.purchaseValue += ad.purchaseValue || 0;
  }
  return [...byCreator.values()].map((c) => {
    // Distinct underlying creative count — a creator's ad count can overstate
    // how many actual pieces of content they're in, since Ads Manager often
    // spins up several ads (different ad sets/campaigns, A/B variants) off
    // the exact same branded Instagram post. `instagramMediaId`
    // (lib/partnershipDetection.js) identifies that underlying post, so it's
    // a better "how many creatives" signal than ad/creative-object count. An
    // ad with no resolved media id (creatorUnresolvedReason's "no media id"
    // bucket, see pages/api/fb/partnership/mine.js) can't be deduped against
    // anything else, so each one still counts as its own distinct creative
    // rather than collapsing every unresolved ad into one shared "unknown"
    // bucket, which would undercount.
    const mediaIds = c.ads.map((ad) => ad.instagramMediaId).filter(Boolean);
    const unresolvedCount = c.ads.length - mediaIds.length;
    return {
      ...c,
      adCount: c.ads.length,
      creativeCount: new Set(mediaIds).size + unresolvedCount,
      roas: c.spend > 0 ? c.purchaseValue / c.spend : 0,
      cpr: c.purchases > 0 ? c.spend / c.purchases : null,
    };
  });
}
