import crypto from "crypto";

// The Google sign-in test flow (see PROJECT_STATUS.md) is invisible to everyone except a browser that holds the
// `gauth_test` cookie. The cookie is handed out by /api/google-test/enable only to whoever knows GOOGLE_TEST_KEY, and its
// value is a digest of that key, so it can't be forged without the key. With the key unset (or the Google client not
// configured) nothing here is active and sign-in behaves exactly as before.
export const TEST_COOKIE = "gauth_test";
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// A short key would be guessable; refuse to arm the feature with one.
function testKey() {
  const key = process.env.GOOGLE_TEST_KEY;
  return key && key.length >= 16 ? key : null;
}

export const testCookieDigest = () => (testKey() ? sha(`google-test:${testKey()}`) : null);
export const keyMatches = (candidate) => !!testKey() && typeof candidate === "string" && safeEqual(sha(candidate), sha(testKey()));
export const googleConfigured = () => !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

export function hasTestCookie(req) {
  const digest = testCookieDigest();
  const value = req.cookies?.[TEST_COOKIE];
  return !!digest && !!value && safeEqual(value, digest);
}

// True only for a browser that opted in AND when the server is configured for Google sign-in.
export const isTestRequest = (req) => hasTestCookie(req) && googleConfigured();

const csv = (value) =>
  String(value || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

// Who may sign in with Google during the test: any email on one of GOOGLE_AUTH_DOMAINS (comma-separated, e.g.
// "pickrr.com,shiprocket.in"), plus any single email listed in GOOGLE_AUTH_ALLOWLIST for exceptions. The caller has
// already required Google to say the email is verified.
export function isAllowedGoogleEmail(email) {
  const value = String(email || "").trim().toLowerCase();
  const at = value.lastIndexOf("@");
  if (at < 1) return false;
  return csv(process.env.GOOGLE_AUTH_DOMAINS).includes(value.slice(at + 1)) || csv(process.env.GOOGLE_AUTH_ALLOWLIST).includes(value);
}
