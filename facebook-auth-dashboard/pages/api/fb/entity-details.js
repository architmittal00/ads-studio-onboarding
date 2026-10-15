import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import { fetchCampaignDetails, fetchAdSetDetails, fetchAdCopyDetails } from "@/lib/entityDetails";

const FETCHERS = { campaign: fetchCampaignDetails, adset: fetchAdSetDetails, ad: fetchAdCopyDetails };

// Backs Explore's "View Details" row action — a read-only look at how one
// campaign/ad set/ad is actually set up (objective / targeting / ad copy),
// not its performance. `level` picks which shape comes back; see
// lib/entityDetails.js for what each one fetches and resolves.
export default async function handler(req, res) {
  const session = await getServerSession(req, res, authOptions);
  if (!session?.accessToken) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  const { level, id } = req.query;
  const fetcher = FETCHERS[level];
  if (!fetcher || !id) {
    return res.status(400).json({ error: "level (campaign, adset, or ad) and id are required" });
  }

  try {
    const data = await fetcher(id, session.accessToken);
    res.status(200).json(data);
  } catch (err) {
    res.status(err.graphResponse ? 400 : 500).json({ error: err.message });
  }
}
