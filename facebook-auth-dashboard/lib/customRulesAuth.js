import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { customRulesConfigured } from "@/lib/customRulesDb";

// Custom rules belong to a Google email (like saved views), and reading Meta needs the Facebook token: both must be there.
// Sends the error response itself and returns null when the request can't continue.
export async function requireRuleOwner(req, res, { write = false, needToken = false } = {}) {
  const session = await getServerSession(req, res, authOptions);
  const email = session?.googleEmail ? String(session.googleEmail).toLowerCase() : null;
  if (!email) {
    res.status(401).json({ error: "Sign in with Google to use custom rules" });
    return null;
  }
  if (needToken && !session.accessToken) {
    res.status(401).json({ error: "Connect Facebook first" });
    return null;
  }
  if (!customRulesConfigured()) {
    res.status(503).json({ error: "Database is not configured" });
    return null;
  }
  if (write) {
    const origin = req.headers.origin;
    if (origin && new URL(origin).host !== req.headers.host) {
      res.status(403).json({ error: "Cross-site request" });
      return null;
    }
  }
  res.setHeader("Cache-Control", "no-store");
  return { email, token: session.accessToken || null };
}

export const VALID_ACCOUNT_ID = /^act_\d+$/;
