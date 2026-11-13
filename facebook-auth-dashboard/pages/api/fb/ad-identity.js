import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import { graphGet } from "@/lib/facebookGraph";
import { IDENTITY_FIELDS, hardIdentity } from "@/lib/rules/creativeIdentity";

// GET /api/fb/ad-identity?adIds=1,2,3 — what Meta says identifies each ad's creative (video, image hash, posts, partnership
// code) and the identity the Recommendations push list would group it under. A read-only diagnostic for "why are these
// two ads not grouped" — the same fields lib/rules/creativeIdentity.js reads, nothing else.
const VALID_ID = /^\d+$/;

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const session = await getServerSession(req, res, authOptions);
  if (!session?.accessToken) return res.status(401).json({ error: "Not authenticated" });
  const ids = String(req.query.adIds || "").split(",").map((s) => s.trim()).filter((s) => VALID_ID.test(s)).slice(0, 20);
  if (ids.length === 0) return res.status(400).json({ error: "adIds is required (comma-separated ad ids)" });
  const token = session.accessToken;
  try {
    const [rich, codes] = await Promise.allSettled([
      graphGet("", token, { ids: ids.join(","), fields: `name,account_id,adset_id,effective_status,creative{${IDENTITY_FIELDS}}` }),
      graphGet("", token, { ids: ids.join(","), fields: "creative{partnership_ad_ad_code}" }),
    ]);
    if (rich.status !== "fulfilled") return res.status(400).json({ error: rich.reason?.message || "Meta refused the identity fields", richFieldsFailed: true });
    const out = {};
    for (const id of ids) {
      const ad = rich.value?.[id];
      if (!ad) continue;
      const code = codes.status === "fulfilled" ? codes.value?.[id]?.creative?.partnership_ad_ad_code : null;
      out[id] = {
        name: ad.name,
        accountId: ad.account_id ? `act_${ad.account_id}` : null,
        adsetId: ad.adset_id,
        status: ad.effective_status,
        creativeId: ad.creative?.id,
        videoId: ad.creative?.video_id || ad.creative?.object_story_spec?.video_data?.video_id || null,
        imageHash: ad.creative?.image_hash || ad.creative?.object_story_spec?.link_data?.image_hash || null,
        feedVideos: (ad.creative?.asset_feed_spec?.videos || []).map((v) => v.video_id),
        feedImages: (ad.creative?.asset_feed_spec?.images || []).map((i) => i.hash),
        storyId: ad.creative?.effective_object_story_id || null,
        igMediaId: ad.creative?.effective_instagram_media_id || null,
        igPermalink: (ad.creative?.instagram_permalink_url || "").split("?")[0] || null,
        partnershipCode: code || null,
        groupedUnder: hardIdentity(ad.creative, code),
      };
    }
    res.status(200).json({ ads: out, partnershipFieldFailed: codes.status !== "fulfilled" });
  } catch (err) {
    res.status(err.graphResponse ? 400 : 500).json({ error: err.message || "Request failed" });
  }
}
