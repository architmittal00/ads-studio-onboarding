import { TEST_COOKIE, keyMatches, testCookieDigest } from "@/lib/googleTest";

// GET /api/google-test/enable?key=<GOOGLE_TEST_KEY> — opts this browser into the Google sign-in test flow. A wrong or
// missing key looks like a missing page, so the route reveals nothing.
export default function handler(req, res) {
  if (req.method !== "GET" || !keyMatches(String(req.query.key || ""))) return res.status(404).json({ error: "Not found" });
  const secure = String(process.env.NEXTAUTH_URL || "").startsWith("https://") ? "; Secure" : "";
  res.setHeader("Set-Cookie", `${TEST_COOKIE}=${testCookieDigest()}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}${secure}`);
  res.setHeader("Cache-Control", "no-store");
  res.redirect(302, "/");
}
