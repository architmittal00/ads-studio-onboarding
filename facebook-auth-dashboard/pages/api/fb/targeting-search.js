import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import { searchTargeting } from "@/lib/metaInterestSearch";

// Backs the Launch tab's Location and Language search pickers — the same
// generic Meta `/search` endpoint as /api/fb/interest-search, just for a
// different `type`. Location search additionally needs `location_types` so
// results cover countries/states/cities rather than only one granularity.
const SUPPORTED_TYPES = {
  adgeolocation: { location_types: ["country", "region", "city"] },
  adlocale: {},
};

export default async function handler(req, res) {
  const session = await getServerSession(req, res, authOptions);
  if (!session?.accessToken) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  const { q, type, limit } = req.query;
  if (!q || !q.trim()) {
    return res.status(400).json({ error: "q is required" });
  }
  if (!SUPPORTED_TYPES[type]) {
    return res.status(400).json({ error: `type must be one of: ${Object.keys(SUPPORTED_TYPES).join(", ")}` });
  }

  try {
    const results = await searchTargeting(session.accessToken, type, q.trim(), {
      limit: limit ? parseInt(limit, 10) : 10,
      ...SUPPORTED_TYPES[type],
    });
    // Per-user data that rarely changes: let the browser reuse it briefly (private, never shared).
    res.setHeader("Cache-Control", "private, max-age=60, stale-while-revalidate=300");
    res.status(200).json({
      results: results.map((r) => ({
        key: r.key,
        name: r.name,
        type: r.type,
        countryCode: r.country_code || null,
        region: r.region || null,
      })),
    });
  } catch (err) {
    res.status(err.graphResponse ? 400 : 500).json({ error: err.message });
  }
}
