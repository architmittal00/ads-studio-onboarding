import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import { graphGet, graphGetAllPages } from "@/lib/facebookGraph";

export default async function handler(req, res) {
  const session = await getServerSession(req, res, authOptions);

  if (!session?.accessToken) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  try {
    // Paginated to completion — an agency token managing more Pages/ad
    // accounts than fit on one page would otherwise silently lose the rest
    // from every picker in the app.
    const [profile, pages, adAccounts] = await Promise.all([
      graphGet("/me", session.accessToken, { fields: "id,name,email,picture" }),
      graphGetAllPages("/me/accounts", session.accessToken, { fields: "id,name,category" }).catch(() => ({
        data: [],
      })),
      graphGetAllPages("/me/adaccounts", session.accessToken, {
        fields: "id,name,account_status,currency",
      }).catch(() => ({ data: [] })),
    ]);

    res.status(200).json({
      profile,
      pages: pages.data || [],
      adAccounts: adAccounts.data || [],
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
