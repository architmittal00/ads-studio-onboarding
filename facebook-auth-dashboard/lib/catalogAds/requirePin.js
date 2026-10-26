import { createHmac, timingSafeEqual } from "crypto";

// The whole Catalog Ads section is still being finalized (see PROJECT_STATUS.md)
// and sits behind a shared PIN rather than a per-user permission — anyone who
// can already sign in to this dashboard is trusted, this just keeps the
// half-built flow from being stumbled into before it's ready. Not a real
// security boundary: the PIN is shared and the cookie isn't rotated per user.
const COOKIE_NAME = "catalogAdsUnlocked";
const DEFAULT_PIN = "392164";

function getPin() {
  return process.env.CATALOG_ADS_PIN || DEFAULT_PIN;
}

// Signed with NEXTAUTH_SECRET (already required by this app) rather than
// storing the PIN itself in the cookie, and rederived from the *current* PIN
// on every check — so rotating CATALOG_ADS_PIN instantly invalidates every
// previously-unlocked cookie with no separate invalidation step.
function expectedToken() {
  const secret = process.env.NEXTAUTH_SECRET || "";
  return createHmac("sha256", secret).update(getPin()).digest("hex");
}

export function checkPin(candidate) {
  return typeof candidate === "string" && candidate.trim() === getPin();
}

export function unlockToken() {
  return expectedToken();
}

export function cookieName() {
  return COOKIE_NAME;
}

function parseCookie(req, name) {
  const header = req.headers?.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}

export function isCatalogAdsUnlocked(req) {
  const cookieValue = parseCookie(req, COOKIE_NAME);
  if (!cookieValue) return false;
  const expected = expectedToken();
  const a = Buffer.from(cookieValue);
  const b = Buffer.from(expected);
  // Lengths almost always match (both are hex SHA-256 digests) except right
  // after a PIN rotation, where an old cookie's value won't even be the same
  // length as the newly-derived expected token — timingSafeEqual throws
  // rather than returning false on a length mismatch, so that case has to be
  // ruled out first instead of letting it crash the request.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
