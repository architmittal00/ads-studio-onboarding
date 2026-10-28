import { getServerSession } from "next-auth/next";
import { authOptions } from "../../auth/[...nextauth]";
import { requestPermission } from "@/lib/partnershipAds";
import { mapWithConcurrency } from "@/lib/metaInterestSearch";

// Bulk "Request Permission (n)" from the Explore grid's floating selection
// bar — one request per unique CREATOR, not per selected card (several
// selected cards can belong to the same creator; Graph would just reject the
// second request for the same creator as redundant, so this de-dupes before
// ever calling out). Streams newline-delimited JSON, same convention as
// pages/api/fb/launch-campaign.js, so the UI can show live progress through
// a list that might be dozens of creators long.
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session?.accessToken) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  const { igUserId, creators } = req.body || {};
  if (!igUserId || !Array.isArray(creators) || creators.length === 0) {
    return res.status(400).json({ error: "igUserId and a non-empty creators array are required" });
  }

  const byKey = new Map();
  for (const c of creators) {
    const key = c.creatorIgId || c.creatorUsername;
    if (key && !byKey.has(key)) byKey.set(key, c);
  }
  const uniqueCreators = [...byKey.values()];

  res.writeHead(200, { "Content-Type": "application/x-ndjson", "Cache-Control": "no-cache" });
  function progress(message) {
    res.write(`${JSON.stringify({ type: "progress", message })}\n`);
  }
  function finish(body) {
    res.write(`${JSON.stringify({ type: "done", ...body })}\n`);
    res.end();
  }

  const token = session.accessToken;
  // A few requests at a time (these are writes, so kept modest); results stay in the
  // original creator order.
  let requested = 0;
  const results = await mapWithConcurrency(uniqueCreators, 4, async (c) => {
    const label = c.creatorUsername ? `@${c.creatorUsername}` : c.creatorIgId;
    progress(`Requesting permission from ${label} (${++requested} of ${uniqueCreators.length})…`);
    try {
      await requestPermission(token, igUserId, { creatorInstagramAccount: c.creatorIgId, creatorInstagramUsername: c.creatorIgId ? undefined : c.creatorUsername });
      return { ...c, success: true };
    } catch (err) {
      return { ...c, success: false, error: err.message };
    }
  });

  finish({ success: results.every((r) => r.success), results });
}
