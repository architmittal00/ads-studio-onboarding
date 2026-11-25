import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import { graphGet } from "@/lib/facebookGraph";

// GET /api/fb/ad-creative-raw?adId=… — the ad's creative exactly as Meta returns it, for working out why an ad copies
// the way it does (Copy Ads reads a subset of these fields). Read-only, and only what the signed-in person's own token
// can already read. Each field group is fetched on its own so one field Meta refuses doesn't hide the rest.
const FIELD_GROUPS = {
  basics: "id,name,status,effective_status,adset_id,campaign_id,creative{id,name,object_type,object_story_id,effective_object_story_id,image_hash,image_url,video_id,thumbnail_url,body,title,link_url,call_to_action_type,url_tags}",
  objectStorySpec: "creative{object_story_spec}",
  assetFeedSpec: "creative{asset_feed_spec}",
  platformCustomizations: "creative{platform_customizations}",
  degreesOfFreedom: "creative{degrees_of_freedom_spec}",
  other: "creative{contextual_multi_ads,creative_sourcing_spec,authorization_category,dynamic_ad_voice,interactive_components_spec}",
};

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const session = await getServerSession(req, res, authOptions);
  if (!session?.accessToken) return res.status(401).json({ error: "Not authenticated" });
  const adId = String(req.query.adId || "");
  if (!/^\d+$/.test(adId)) return res.status(400).json({ error: "adId must be numeric" });
  const out = {};
  await Promise.all(
    Object.entries(FIELD_GROUPS).map(async ([name, fields]) => {
      try {
        out[name] = await graphGet(`/${adId}`, session.accessToken, { fields });
      } catch (err) {
        out[name] = { error: err.message };
      }
    })
  );
  res.status(200).json(out);
}
