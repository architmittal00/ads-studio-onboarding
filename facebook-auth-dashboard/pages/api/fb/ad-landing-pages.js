import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import { resolveLandingUrls } from "@/lib/adCreativeDetails";

const MAX_AD_IDS = 1000;

// Landing-page-URL lookup for an exact list of ad ids, split out of
// /api/fb/explore-insights the same way /api/fb/ad-thumbnails already is —
// so a top-level Ad-level Explore query with the "Landing Page" metric
// selected can render its table the moment Insights data is back, instead of
// also waiting on this (slower, one-Graph-call-per-50-ads, plus a
// post-fallback round trip) creative lookup. See pages/explore.js's own
// fetchAdLandingPages()/loadLandingPagesForView() for how the client fires
// this in the background and merges the result in once it arrives.
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session?.accessToken) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  const { adIds } = req.body || {};
  if (!Array.isArray(adIds) || adIds.length === 0) {
    return res.status(400).json({ error: "adIds is required" });
  }
  const cleanIds = [...new Set(adIds.map(String).map((id) => id.trim()).filter(Boolean))].slice(0, MAX_AD_IDS);

  try {
    const landingPages = await resolveLandingUrls(cleanIds, session.accessToken);
    res.status(200).json({ landingPages });
  } catch (err) {
    res.status(err.graphResponse ? 400 : 500).json({ error: err.message });
  }
}
