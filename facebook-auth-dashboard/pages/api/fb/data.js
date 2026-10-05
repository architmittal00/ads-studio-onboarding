import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";

const GRAPH_API_VERSION = "v21.0";

async function graphGet(path, accessToken) {
  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}${path}${
    path.includes("?") ? "&" : "?"
  }access_token=${accessToken}`;
  const res = await fetch(url);
  const json = await res.json();
  if (json.error) {
    throw new Error(json.error.message);
  }
  return json;
}

export default async function handler(req, res) {
  const session = await getServerSession(req, res, authOptions);

  if (!session?.accessToken) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  try {
    const [profile, pages, adAccounts] = await Promise.all([
      graphGet("/me?fields=id,name,email,picture", session.accessToken),
      graphGet(
        "/me/accounts?fields=id,name,category",
        session.accessToken
      ).catch(() => ({ data: [] })),
      graphGet(
        "/me/adaccounts?fields=id,name,account_status,currency",
        session.accessToken
      ).catch(() => ({ data: [] })),
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
