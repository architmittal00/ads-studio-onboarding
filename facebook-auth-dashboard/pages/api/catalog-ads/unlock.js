import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import { checkPin, cookieName, unlockToken } from "@/lib/catalogAds/requirePin";

const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days — long-lived since this isn't a real auth boundary, just friction

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    return res.status(401).json({ error: "Not signed in" });
  }

  const { pin } = req.body || {};
  if (!checkPin(pin)) {
    return res.status(403).json({ error: "Incorrect PIN" });
  }

  res.setHeader(
    "Set-Cookie",
    `${cookieName()}=${unlockToken()}; Path=/; Max-Age=${COOKIE_MAX_AGE_SECONDS}; HttpOnly; SameSite=Lax`
  );
  return res.status(200).json({ ok: true });
}
