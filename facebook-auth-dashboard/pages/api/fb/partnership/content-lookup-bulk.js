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

// Confirmed against a real failing lookup: Graph's own `ad_codes` filter
// param matches on the bare code a creator actually shares (what a user
// pastes into this upload), but the `ad_code` field it returns on a matched
// item's `partnership_info` entry comes back with an `adcode-` prefix
// ("adcode-Q9jTBB…" for an input of "Q9jTBB…") — undocumented anywhere this
// app's reference material covers. Matching the response's `ad_code`
// directly against the row's own (unprefixed) value, as this endpoint always
// has, means the map key and the lookup key never equal each other, so every
// real ad-code row came back "not found" even though Graph found and
// returned the right item. Normalizing both sides makes the match work
// whichever form either one happens to be in.
function normalizeAdCode(code) {
  return code ? code.replace(/^adcode-/i, "") : code;
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
    let adCodeError = null;
    if (adCodeRows.length > 0) {
      try {
        const results = await lookupContent(token, businessId, { igUserId, adCodes: adCodeRows.map((row) => row.value) });
        // A real piece of content can carry more than one tagged partner —
        // keying only by the FIRST partnership_info entry's ad_code would
        // silently miss a match whenever the row's ad_code belongs to a
        // later entry. Checking every entry is what the single-item lookup
        // effectively gets "for free" (there's only ever one candidate item
        // to inspect there); bulk needs to do it explicitly since it's
        // matching many candidate items back to many codes at once.
        for (const item of results) {
          for (const info of item.partnership_info || []) {
            if (info.ad_code) byAdCode.set(normalizeAdCode(info.ad_code), item);
          }
        }
      } catch (err) {
        // Captured and surfaced per-row below instead of swallowed —
        // reported by the user as ad-code rows failing with no indication
        // why, unlike every other Graph call in this app (which shows the
        // real error_user_msg/code/subcode). A whole-call failure still
        // means every ad-code row in it comes back "not found," but now with
        // the actual reason attached.
        adCodeError = err.message;
      }
    }

    const byShortcode = new Map();
    let permalinkError = null;
    const resolvablePermalinks = permalinkRows.filter((row) => row.shortcode);
    if (resolvablePermalinks.length > 0) {
      try {
        const results = await lookupContent(token, businessId, { igUserId, permalinks: resolvablePermalinks.map((row) => row.value) });
        for (const item of results) {
          const resultShortcode = tryExtractShortcode(item.permalink);
          if (resultShortcode) byShortcode.set(resultShortcode, item);
        }
      } catch (err) {
        // Same reasoning as the ad-code batch above.
        permalinkError = err.message;
      }
    }

    for (const row of adCodeRows) {
      const item = byAdCode.get(normalizeAdCode(row.value));
      res.write(`${JSON.stringify({ type: "row", value: row.value, found: !!item, item: item || null, error: item ? null : adCodeError })}\n`);
    }
    for (const row of permalinkRows) {
      const item = row.shortcode ? byShortcode.get(row.shortcode) : null;
      const error = item
        ? null
        : !row.shortcode
          ? "Not a usable Instagram permalink (Stories links aren't supported for Partnership Ads)."
          : permalinkError;
      res.write(`${JSON.stringify({ type: "row", value: row.value, found: !!item, item: item || null, error })}\n`);
    }
  }

  res.write(`${JSON.stringify({ type: "done" })}\n`);
  res.end();
}
