import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { isCatalogAdsUnlocked } from "./requirePin";

// Shared by every pages/api/fb/catalog-ads/*.js route: the same
// session-then-PIN check pages/catalog-ads.js's own getServerSideProps
// applies to the page itself, so the API can't be reached directly by
// someone who knows the URL but not the PIN. Returns the session on
// success; on failure it has already written the response and the caller
// should just return.
export async function requireCatalogAdsRequest(req, res) {
  const session = await getServerSession(req, res, authOptions);
  if (!session?.accessToken) {
    res.status(401).json({ error: "Not authenticated" });
    return null;
  }
  if (!isCatalogAdsUnlocked(req)) {
    res.status(403).json({ error: "Catalog Ads is locked" });
    return null;
  }
  return session;
}
