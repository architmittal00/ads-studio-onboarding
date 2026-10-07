import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import { searchAdInterests } from "@/lib/metaInterestSearch";

// Backs the live, search-as-you-type interest picker (components/
// InterestPicker.js) — deliberately thin and fast since it fires on every
// keystroke, unlike the AI-driven /api/fb/interest-recommendations.
export default async function handler(req, res) {
  const session = await getServerSession(req, res, authOptions);
  if (!session?.accessToken) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  const { q, limit } = req.query;
  if (!q || !q.trim()) {
    return res.status(400).json({ error: "q is required" });
  }

  try {
    const results = await searchAdInterests(session.accessToken, q.trim(), {
      limit: limit ? parseInt(limit, 10) : 10,
    });
    res.status(200).json({
      results: results.map((r) => ({
        id: r.id,
        name: r.name,
        audienceSizeLowerBound: r.audience_size_lower_bound ?? null,
        audienceSizeUpperBound: r.audience_size_upper_bound ?? null,
        path: r.path || null,
      })),
    });
  } catch (err) {
    res.status(err.graphResponse ? 400 : 500).json({ error: err.message });
  }
}
