import { getServerSession } from "next-auth/next";
import { authOptions } from "../../auth/[...nextauth]";
import { lookupContent } from "@/lib/partnershipAds";
import { firstPartnershipInfo } from "@/lib/partnershipContent";
import { chunk } from "@/lib/adCreativeDetails";

// The Partnership Code tab's bulk CSV upload — resolves every pasted code in
// as few Graph calls as possible (one per chunk of 50, the API's own cap on
// how many `ad_codes` one lookup call accepts — see lib/partnershipAds.js's
// lookupContent), not one call per code, then streams a result per code so
// the UI can show the mockup's own live "validating → valid/invalid"
// per-row animation without actually waiting one network round trip per row.
const CHUNK_SIZE = 50;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session?.accessToken) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  const { businessId, igUserId, codes } = req.body || {};
  if (!businessId || !igUserId || !Array.isArray(codes) || codes.length === 0) {
    return res.status(400).json({ error: "businessId, igUserId, and a non-empty codes array are required" });
  }

  res.writeHead(200, { "Content-Type": "application/x-ndjson", "Cache-Control": "no-cache" });

  const token = session.accessToken;
  const chunks = chunk(codes, CHUNK_SIZE);
  for (const batch of chunks) {
    let byCode = new Map();
    try {
      const items = await lookupContent(token, businessId, { igUserId, adCodes: batch });
      byCode = new Map(items.map((item) => [firstPartnershipInfo(item).ad_code, item]));
    } catch {
      // A whole-batch failure means every code in it comes back "not found"
      // below — still a real, actionable result for the user (retry), not a
      // request that silently drops those rows.
    }
    for (const code of batch) {
      const item = byCode.get(code);
      res.write(`${JSON.stringify({ type: "row", code, found: !!item, item: item || null })}\n`);
    }
  }

  res.write(`${JSON.stringify({ type: "done" })}\n`);
  res.end();
}
