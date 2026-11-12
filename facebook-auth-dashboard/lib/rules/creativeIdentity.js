// Which ads are "the same creative". Meta gives a duplicated ad a NEW creative id, so grouping by creative id alone
// treats copies as different creatives. What survives a duplicate is the asset underneath, so an ad's identity is the
// first of these it has: partnership code → video → image → Instagram post / permalink → Page post. An ad with none of
// them (carousels, catalog) falls back to its name with the " – Copy N" Ads Manager appends removed — but only when
// that name is shared with a copy, so two unrelated ads are never merged on a plain name.

// Fields to read from `creative{…}` (the partnership code is requested separately, see creative-pool.js).
export const IDENTITY_FIELDS =
  "id,video_id,image_hash,effective_object_story_id,instagram_permalink_url,effective_instagram_media_id,object_story_spec{link_data{image_hash},video_data{video_id}},asset_feed_spec{images{hash},videos{video_id}}";

const joined = (list) => [...new Set((list || []).filter(Boolean))].sort().join(",");

// The ad's strongest identity ("v:123", "i:abc", …) or null.
export function hardIdentity(creative, partnershipCode) {
  if (!creative) return null;
  const spec = creative.object_story_spec || {};
  const feed = creative.asset_feed_spec || {};
  const video = creative.video_id || spec.video_data?.video_id || joined((feed.videos || []).map((v) => v.video_id));
  const image = creative.image_hash || spec.link_data?.image_hash || joined((feed.images || []).map((i) => i.hash));
  if (partnershipCode) return `pc:${partnershipCode}`;
  if (video) return `v:${video}`;
  if (image) return `i:${image}`;
  if (creative.effective_instagram_media_id) return `ig:${creative.effective_instagram_media_id}`;
  if (creative.instagram_permalink_url) return `ig:${creative.instagram_permalink_url.split("?")[0].replace(/\/$/, "")}`;
  if (creative.effective_object_story_id) return `s:${creative.effective_object_story_id}`;
  return null;
}

const COPY_SUFFIX = /\s*[–—-]\s*copy(\s*\d+)?\s*$/i;

export const hasCopySuffix = (name) => COPY_SUFFIX.test(String(name || ""));

// "Day&Night – Copy 3" → "day&night"
export function copyBaseName(name) {
  let n = String(name || "").trim();
  while (COPY_SUFFIX.test(n)) n = n.replace(COPY_SUFFIX, "");
  return n.trim().toLowerCase();
}

// infos: Map adId → { creativeId, hard, name }. Returns Map adId → the id the ad is grouped under.
export function groupKeys(infos) {
  const copied = new Set();
  for (const i of infos.values()) if (!i.hard && hasCopySuffix(i.name)) copied.add(copyBaseName(i.name));
  const out = new Map();
  for (const [adId, i] of infos) {
    const base = !i.hard && i.name ? copyBaseName(i.name) : null;
    out.set(adId, i.hard || (base && copied.has(base) ? `n:${base}` : i.creativeId));
  }
  return out;
}
