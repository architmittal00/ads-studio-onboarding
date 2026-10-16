import { getServerSession } from "next-auth/next";
import { authOptions } from "../../auth/[...nextauth]";
import { discoverContent } from "@/lib/partnershipAds";

// Backs the Explore Ads tab's masonry grid — one page of a Business's
// partner-eligible Instagram content at a time (the client drives its own
// "load more" via `after`, see lib/partnershipAds.js's discoverContent for
// why this doesn't just follow every page itself like graphGetAllPages
// does). `partnership_info.permission_status` on each returned item is what
// drives the grid's own permission-state ring directly — no separate merge
// with /api/fb/partnership/permissions.js needed here.
export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session?.accessToken) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  const { businessId, igUserId, after, postTypes, adEligibilities, adUsages, startDate, endDate, searchKey, limit } = req.query;
  if (!businessId || !igUserId) {
    return res.status(400).json({ error: "businessId and igUserId are required" });
  }

  function parseListParam(raw) {
    if (!raw) return undefined;
    return String(raw)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  try {
    const result = await discoverContent(session.accessToken, businessId, {
      igUserId,
      after: after || undefined,
      postTypes: parseListParam(postTypes),
      adEligibilities: parseListParam(adEligibilities),
      adUsages: parseListParam(adUsages),
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      searchKey: searchKey || undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
    res.status(200).json(result);
  } catch (err) {
    // A 4xx here most plausibly means the Business's pa_content_discovery_api
    // gatekeeper flag isn't enabled — surface Facebook's own message
    // verbatim rather than a generic one, since that's the actual signal a
    // user would need to go act on (contact Meta support), not a bug in this
    // app to fix.
    res.status(err.graphResponse ? 400 : 500).json({ error: err.message });
  }
}
