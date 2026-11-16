import { TEST_COOKIE } from "@/lib/googleTest";

// Drops the test cookie: this browser is back on the normal sign-in flow.
export default function handler(req, res) {
  const secure = String(process.env.NEXTAUTH_URL || "").startsWith("https://") ? "; Secure" : "";
  res.setHeader("Set-Cookie", `${TEST_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`);
  res.setHeader("Cache-Control", "no-store");
  res.redirect(302, "/");
}
