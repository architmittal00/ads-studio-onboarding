import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import { graphGet } from "@/lib/facebookGraph";

// Single-ad detail lookup for the "Duplicate this ad" flow (pages/launch.js,
// entered from Explore's RowActions "Duplicate" action on an ad-level row) —
// resolves the ancestry (ad set + campaign name) that flow shows for
// context, plus the creative id the new ad will point at. No list mode like
// campaigns-list.js/adsets-list.js have: there's no "browse every ad in the
// account" picker anywhere in this app, since duplicating a specific,
// already-on-screen ad is the only way this flow is ever entered.
export default async function handler(req, res) {
  const session = await getServerSession(req, res, authOptions);
  if (!session?.accessToken) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  const { adId } = req.query;
  if (!adId) {
    return res.status(400).json({ error: "adId is required" });
  }

  try {
    const ad = await graphGet(`/${adId}`, session.accessToken, {
      fields: "name,status,creative{id},adset{id,name,campaign{id,name}}",
    });
    if (!ad.creative?.id) {
      return res.status(400).json({ error: "This ad has no creative to duplicate." });
    }
    res.status(200).json({
      id: adId,
      name: ad.name,
      status: ad.status,
      creativeId: ad.creative.id,
      adsetId: ad.adset?.id || null,
      adsetName: ad.adset?.name || null,
      campaignId: ad.adset?.campaign?.id || null,
      campaignName: ad.adset?.campaign?.name || null,
    });
  } catch (err) {
    res.status(err.graphResponse ? 400 : 500).json({ error: err.message });
  }
}
