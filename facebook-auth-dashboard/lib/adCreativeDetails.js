import { graphGet } from "./facebookGraph";
import { titleCaseSnake } from "./reportShared";

function toDateStr(d) {
  return d.toISOString().slice(0, 10);
}

// Facebook's `date_preset` shortcuts can silently drift from what Ads
// Manager's own date picker shows for "Last N days" (e.g. by one day, or by
// timezone cutoff). Reach-based metrics like frequency are NOT additive
// across days, so even a one-day difference in the window can visibly shift
// them — unlike spend/clicks, which just sum. Using an explicit, fixed
// window (last N full days, not including today) and surfacing the exact
// dates in the UI makes that comparable and debuggable against Ads Manager.
export function lastNDaysRange(n, today) {
  const until = new Date(today);
  until.setDate(until.getDate() - 1);
  const since = new Date(until);
  since.setDate(since.getDate() - (n - 1));
  return { since: toDateStr(since), until: toDateStr(until) };
}

export function chunk(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

// Fetches per-ad details (status, thumbnail, video id) for an exact list of
// ad IDs, via the Graph API's `?ids=a,b,c` batch-by-ID endpoint (chunked —
// large ID lists can hit URL/response-size limits). This matters because
// `/act_x/ads` with no filter returns Facebook's default-ordered first N
// ads (oldest-created first) — for any account with real history that's a
// completely different set of ads than the ones with spend in our report
// window, so fetching this way silently returns the wrong (or no) creative
// for most rows. Fetching by the exact IDs we're displaying avoids that.
export async function fetchAdDetails(adIds, token) {
  const detailsByAdId = {};
  if (adIds.length === 0) return detailsByAdId;

  const batches = chunk(adIds, 50);
  const results = await Promise.allSettled(
    batches.map((batch) =>
      graphGet("", token, {
        ids: batch.join(","),
        fields:
          "effective_status,creative{thumbnail_url,image_url,video_id,object_type,product_set_id,effective_object_story_id,body,call_to_action,object_story_spec{link_data{link,message},video_data{video_id,message,call_to_action{type,value{link}}}},asset_feed_spec{link_urls{website_url},bodies{text}}}",
      })
    )
  );

  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    for (const [id, obj] of Object.entries(result.value || {})) {
      const creative = obj.creative || {};
      const videoId = creative.video_id || creative.object_story_spec?.video_data?.video_id || null;
      // A product_set_id means this ad pulls from a catalog (Dynamic Product
      // Ads / Advantage+ catalog ads) rather than being a single fixed
      // image or video creative.
      const creativeType = creative.product_set_id ? "Catalog" : videoId ? "Video" : "Static";
      // The ad's destination URL, checked across the shapes it can show up
      // in. `creative.call_to_action` (top-level, separate from the one
      // nested under object_story_spec.video_data) turned out to be the big
      // one — verified against a real account's "Unknown landing page" ads:
      // 10 of 10 video ads with no object_story_spec/asset_feed_spec at all
      // still carried their destination here. Catalog ads have no single
      // fixed URL — their real destination is generated per-product by
      // Facebook at serve time — so this stays null for them.
      const landingUrl =
        creative.object_story_spec?.link_data?.link ||
        creative.object_story_spec?.video_data?.call_to_action?.value?.link ||
        creative.call_to_action?.value?.link ||
        creative.asset_feed_spec?.link_urls?.[0]?.website_url ||
        null;
      // Primary ad text, checked across the shapes it can show up in — plain
      // image/video ads carry it on `body`, link/video-post ads carry it on
      // their object_story_spec instead, and Advantage+/dynamic-creative ads
      // (no single fixed body) carry it as the first of several candidate
      // texts under asset_feed_spec.
      const caption =
        creative.body ||
        creative.object_story_spec?.link_data?.message ||
        creative.object_story_spec?.video_data?.message ||
        creative.asset_feed_spec?.bodies?.[0]?.text ||
        null;
      const ctaType = creative.call_to_action?.type || creative.object_story_spec?.video_data?.call_to_action?.type || null;
      detailsByAdId[id] = {
        status: obj.effective_status || null,
        thumbnailUrl: creative.thumbnail_url || creative.image_url || null,
        videoId,
        creativeType,
        landingUrl,
        caption,
        ctaLabel: ctaType ? titleCaseSnake(ctaType.toLowerCase()) : null,
        // Set only when none of the structured creative fields above had a
        // link (rare now that call_to_action is checked) — resolved as a
        // last resort from the ad's underlying Page post, in a follow-up
        // batch by fetchPostLandingUrls().
        postId: !landingUrl ? creative.effective_object_story_id || null : null,
      };
    }
  }

  return detailsByAdId;
}

// Fallback landing-URL resolution for ads with no link anywhere in their own
// creative fields (object_story_spec / asset_feed_spec) — these are ads
// built by boosting an existing Page post rather than creating a new link
// ad, extremely common for video/Reels creative. The destination lives on
// the post itself instead: its own `link` field for a link-share post, a
// link-out call-to-action button, or an attachment's URL. Requires
// pages_read_engagement for Pages the token's user doesn't manage directly —
// failures are expected for some posts and handled per-ID (Facebook returns
// an {error} object for just that ID rather than failing the whole batch),
// so those ads simply stay unresolved rather than breaking the request.
export async function fetchPostLandingUrls(postIds, token) {
  const urlByPostId = {};
  if (postIds.length === 0) return urlByPostId;

  const batches = chunk(postIds, 50);
  const results = await Promise.allSettled(
    batches.map((batch) =>
      graphGet("", token, {
        ids: batch.join(","),
        fields: "link,call_to_action,attachments{url,unshimmed_url}",
      })
    )
  );

  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    for (const [id, obj] of Object.entries(result.value || {})) {
      const attachment = obj.attachments?.data?.[0];
      const url = obj.link || obj.call_to_action?.value?.link || attachment?.unshimmed_url || attachment?.url || null;
      if (url) urlByPostId[id] = url;
    }
  }

  return urlByPostId;
}

// Best-effort "what product is this ad pointing at" derived from its landing
// page URL — Facebook's insights API has no native per-product revenue
// breakdown outside of catalog/DPA reporting, so this reverse-engineers it
// from the destination URL instead. Recognizes the common Shopify-style
// `/products/<handle>` path and turns the handle into a readable label;
// anything else falls back to the raw path, which is still a valid (if less
// pretty) grouping key.
export function extractLandingPageLabel(url) {
  if (!url) return null;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const path = parsed.pathname.replace(/\/+$/, "");
  if (!path) return "Homepage";
  const match = path.match(/\/products\/([^/]+)/i);
  if (match) {
    return decodeURIComponent(match[1])
      .replace(/[-_]+/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return path;
}
