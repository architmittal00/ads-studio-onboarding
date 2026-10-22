import { getServerSession } from "next-auth/next";
import { authOptions } from "../../auth/[...nextauth]";
import { lookupContent, extractInstagramShortcode } from "@/lib/partnershipAds";
import { firstPartnershipInfo } from "@/lib/partnershipContent";
import { chunk } from "@/lib/adCreativeDetails";

// The Partnership Code tab's bulk CSV upload — resolves every pasted row in
// as few Graph calls as possible (one per chunk of 50 per type, the API's own
// cap on how many `ad_codes`/`permalinks` one lookup call accepts — see
// lib/partnershipAds.js's lookupContent), not one call per row, then streams
// a result per row so the UI can show the mockup's own live
// "validating → valid/invalid" per-row animation without actually waiting
// one network round trip per row.
//
// Each `item` is `{ value, type: "adCode"|"permalink" }` — CsvUploadCard.js
// auto-detects `type` per CSV line (see its own detectInputType), since a
// batch can freely mix both kinds. `lookupContent` only accepts ONE of
// `adCodes`/`permalinks` per call (never mixed), so each chunk is split by
// type and resolved with up to two separate calls instead of one.
const CHUNK_SIZE = 50;

// `extractInstagramShortcode` rejects an Instagram Stories URL outright
// (Partnership Ads has no concept of a Stories shortcode) — caught here, per
// row, so one bad link in an otherwise-valid batch surfaces as that one row
// failing instead of throwing and silently failing the whole chunk (ad-code
// rows in the same chunk included).
function tryExtractShortcode(permalink) {
  try {
    return extractInstagramShortcode(permalink);
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session?.accessToken) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  const { businessId, igUserId, items } = req.body || {};
  if (!businessId || !igUserId || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "businessId, igUserId, and a non-empty items array are required" });
  }

  res.writeHead(200, { "Content-Type": "application/x-ndjson", "Cache-Control": "no-cache" });

  const token = session.accessToken;
  const chunks = chunk(items, CHUNK_SIZE);
  for (const batch of chunks) {
    const adCodeRows = batch.filter((row) => row.type !== "permalink");
    // Pre-extracted once per row so a Stories link (or anything else
    // extractInstagramShortcode rejects) is excluded from the actual Graph
    // call and immediately reported "not found", rather than throwing and
    // losing every permalink row in this chunk.
    const permalinkRows = batch
      .filter((row) => row.type === "permalink")
      .map((row) => ({ ...row, shortcode: tryExtractShortcode(row.value) }));

    const byAdCode = new Map();
    if (adCodeRows.length > 0) {
      try {
        const results = await lookupContent(token, businessId, { igUserId, adCodes: adCodeRows.map((row) => row.value) });
        for (const item of results) byAdCode.set(firstPartnershipInfo(item).ad_code, item);
      } catch {
        // A whole-call failure means every ad-code row in it comes back "not
        // found" below — still a real, actionable result for the user
        // (retry), not a request that silently drops those rows.
      }
    }

    const byShortcode = new Map();
    const resolvablePermalinks = permalinkRows.filter((row) => row.shortcode);
    if (resolvablePermalinks.length > 0) {
      try {
        const results = await lookupContent(token, businessId, { igUserId, permalinks: resolvablePermalinks.map((row) => row.value) });
        for (const item of results) {
          const resultShortcode = tryExtractShortcode(item.permalink);
          if (resultShortcode) byShortcode.set(resultShortcode, item);
        }
      } catch {
        // Same reasoning as the ad-code batch above.
      }
    }

    for (const row of adCodeRows) {
      const item = byAdCode.get(row.value);
      res.write(`${JSON.stringify({ type: "row", value: row.value, found: !!item, item: item || null })}\n`);
    }
    for (const row of permalinkRows) {
      const item = row.shortcode ? byShortcode.get(row.shortcode) : null;
      res.write(`${JSON.stringify({ type: "row", value: row.value, found: !!item, item: item || null })}\n`);
    }
  }

  res.write(`${JSON.stringify({ type: "done" })}\n`);
  res.end();
}
