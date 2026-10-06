import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import { graphGet } from "@/lib/facebookGraph";

// Pages + pixels for one ad account, used by the Strategy launch panel's
// Page/pixel pickers. Separate from /api/fb/data (which fetches ALL
// accounts' data for the account switcher) since this is scoped to a single
// account and only needed when actually launching, not on every page load.
export default async function handler(req, res) {
  const session = await getServerSession(req, res, authOptions);
  if (!session?.accessToken) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  const { accountId } = req.query;
  if (!accountId) {
    return res.status(400).json({ error: "accountId is required" });
  }

  try {
    const [pagesJson, pixelsJson] = await Promise.all([
      graphGet("/me/accounts", session.accessToken, { fields: "id,name" }),
      graphGet(`/${accountId}/adspixels`, session.accessToken, { fields: "id,name" }),
    ]);
    res.status(200).json({ pages: pagesJson.data || [], pixels: pixelsJson.data || [] });
  } catch (err) {
    res.status(err.graphResponse ? 400 : 500).json({ error: err.message });
  }
}
