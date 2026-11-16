import { getServerSession } from "next-auth/next";
import { authOptions } from "./auth/[...nextauth]";
import { VIEW_KIND_NAMES, sanitizeViewDoc } from "@/lib/userViewsKinds";
import { readUserViews, writeUserView, userViewsConfigured } from "@/lib/userViewsDb";

// GET  /api/user-views            -> { views: { <kind>: { doc, version, updatedAt } } }
// PUT  /api/user-views {kind,doc} -> { ok, version }
// A person's open tabs and their settings (see lib/userViewsKinds.js), saved so they follow the person to any browser.
// The owner is always the Google email of the signed-in session: nothing the browser sends can pick another owner.
export default async function handler(req, res) {
  const session = await getServerSession(req, res, authOptions);
  const email = session?.googleEmail ? String(session.googleEmail).toLowerCase() : null;
  if (!email) return res.status(401).json({ error: "Sign in with Google to save views" });
  res.setHeader("Cache-Control", "no-store");
  if (!userViewsConfigured()) return res.status(503).json({ error: "Views database is not configured" });

  try {
    if (req.method === "GET") return res.status(200).json({ views: await readUserViews(email) });

    if (req.method === "PUT") {
      const origin = req.headers.origin;
      if (origin && new URL(origin).host !== req.headers.host) return res.status(403).json({ error: "Cross-site request" });
      const { kind, doc } = req.body || {};
      if (!VIEW_KIND_NAMES.includes(kind)) return res.status(400).json({ error: "Unknown view kind" });
      let clean;
      try {
        clean = sanitizeViewDoc(kind, doc);
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }
      return res.status(200).json({ ok: true, version: await writeUserView(email, kind, clean) });
    }

    res.setHeader("Allow", "GET, PUT");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("user-views failed:", err?.message);
    return res.status(500).json({ error: "Could not reach the views database" });
  }
}
