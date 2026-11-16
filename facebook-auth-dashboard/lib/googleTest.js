import crypto from "crypto";

// Google sign-in settings (see PROJECT_STATUS.md). The rollout mode, who may sign in and the optional test cookie all live
// here. The test cookie (`gauth_test`) is only used when GOOGLE_AUTH_MODE=test: it is handed out by
// /api/google-test/enable to whoever knows GOOGLE_TEST_KEY, and its value is a digest of that key, so it can't be forged.
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

const csv = (value) =>
  String(value || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

// Google sign-in rollout, from GOOGLE_AUTH_MODE:
//   "on" (default)  everyone signs in with Google first, then connects Facebook
//   "test"          only browsers holding the test cookie (see enable route) — everyone else signs in as before
//   "off"           the old Facebook-only sign-in for everyone (the kill switch)
// It only takes effect when the Google client is configured AND someone is allowed to sign in (domains or emails);
// otherwise the old sign-in stays, so a missing setting can never lock the whole team out.
export function googleAuthMode() {
  const mode = String(process.env.GOOGLE_AUTH_MODE || "on").trim().toLowerCase();
  return mode === "off" || mode === "test" ? mode : "on";
}
const hasPeopleRule = () => csv(process.env.GOOGLE_AUTH_DOMAINS).length > 0 || csv(process.env.GOOGLE_AUTH_ALLOWLIST).length > 0;
const googleReady = () => googleConfigured() && hasPeopleRule();

// True when Google sign-in is required for everyone (not just test browsers).
export const googleAuthEverywhere = () => googleAuthMode() === "on" && googleReady();

// True when THIS request goes through the Google flow.
export function googleAuthActive(req) {
  const mode = googleAuthMode();
  if (mode === "off" || !googleReady()) return false;
  return mode === "on" ? true : hasTestCookie(req);
}

// Who may open /identity-links (who is mapped to which Facebook login): GOOGLE_AUTH_ADMINS, else the exception list.
export function isGoogleAdmin(email) {
  const admins = csv(process.env.GOOGLE_AUTH_ADMINS);
  return !!email && (admins.length ? admins : csv(process.env.GOOGLE_AUTH_ALLOWLIST)).includes(String(email).toLowerCase());
}

// Who may sign in with Google: any email on one of GOOGLE_AUTH_DOMAINS (comma-separated, e.g.
// "pickrr.com,shiprocket.in"), plus any single email listed in GOOGLE_AUTH_ALLOWLIST for exceptions. The caller has
// already required Google to say the email is verified.
export function isAllowedGoogleEmail(email) {
  const value = String(email || "").trim().toLowerCase();
  const at = value.lastIndexOf("@");
  if (at < 1) return false;
  return csv(process.env.GOOGLE_AUTH_DOMAINS).includes(value.slice(at + 1)) || csv(process.env.GOOGLE_AUTH_ALLOWLIST).includes(value);
}

// Why a Google sign-in would be refused, for the message on the sign-in page; null means it is allowed.
export function googleDenialReason(profile) {
  if (!profile?.email) return "no_email";
  if (!profile.email_verified) return "unverified";
  if (!csv(process.env.GOOGLE_AUTH_DOMAINS).length && !csv(process.env.GOOGLE_AUTH_ALLOWLIST).length) return "not_configured";
  return isAllowedGoogleEmail(profile.email) ? null : "domain";
}
