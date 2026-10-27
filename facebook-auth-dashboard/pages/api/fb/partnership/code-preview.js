import { getServerSession } from "next-auth/next";
import { authOptions } from "../../auth/[...nextauth]";
import { graphGet } from "@/lib/facebookGraph";

// Renders a partnership ad straight from its code, without Content Discovery
// (which does not list every code). Uses Meta's own preview generator with the
// same creative spec the launch would create: the brand's Page as primary and
// the code as the branded-content token, brand Page/Instagram as sponsor.
const FORMATS = new Set(["INSTAGRAM_STANDARD", "DESKTOP_FEED_STANDARD", "MOBILE_FEED_STANDARD"]);

export default async function handler(req, res) {
  const session = await getServerSession(req, res, authOptions);
  if (!session?.accessToken) return res.status(401).json({ error: "Not authenticated" });

  const { accountId, pageId, igUserId, adCode, format } = req.query;
  if (!accountId || !pageId || !adCode) {
    return res.status(400).json({ error: "accountId, pageId and adCode are required" });
  }
  const adFormat = FORMATS.has(format) ? format : "INSTAGRAM_STANDARD";

  const creative = {
    object_id: pageId,
    branded_content: { instagram_boost_post_access_token: adCode },
    facebook_branded_content: { sponsor_page_id: pageId },
  };
  if (igUserId) creative.instagram_branded_content = { sponsor_id: igUserId };

  try {
    const json = await graphGet(`/${accountId}/generatepreviews`, session.accessToken, { ad_format: adFormat, creative });
    const body = json.data?.[0]?.body || "";
    const srcMatch = body.match(/src="([^"]+)"/);
    if (!srcMatch) return res.status(200).json({ previewUrl: null, warning: "Meta returned no preview for this code." });
    const width = Number(body.match(/width="(\d+)"/)?.[1]) || null;
    const height = Number(body.match(/height="(\d+)"/)?.[1]) || null;
    res.status(200).json({ previewUrl: srcMatch[1].replace(/&amp;/g, "&"), width, height });
  } catch (err) {
    res.status(err.graphResponse ? 400 : 500).json({ error: err.message });
  }
}
