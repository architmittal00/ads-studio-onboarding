import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import { graphGet } from "@/lib/facebookGraph";

// Existing creatives on an ad account — the "Change creative" picker in the ad
// details drawer lists these with their thumbnails. Newest first, capped.
export default async function handler(req, res) {
  const session = await getServerSession(req, res, authOptions);
  if (!session?.accessToken) return res.status(401).json({ error: "Not authenticated" });
  const accountId = String(req.query.accountId || "").replace(/^act_/, "");
  if (!/^\d+$/.test(accountId)) return res.status(400).json({ error: "accountId is required" });
  try {
    const json = await graphGet(`/act_${accountId}/adcreatives`, session.accessToken, {
      fields: "id,name,thumbnail_url,object_type,video_id",
      limit: 60,
    });
    res.status(200).json({
      creatives: (json.data || []).map((c) => ({ id: c.id, name: c.name || null, thumbnailUrl: c.thumbnail_url || null, isVideo: !!c.video_id || c.object_type === "VIDEO" })),
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}
