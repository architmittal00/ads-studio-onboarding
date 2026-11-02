import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import { graphGetAllPages } from "@/lib/facebookGraph";

// Lists the pixels attached to an ad account, with the time each last fired.
const VALID_ID = /^act_\d+$/;

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const session = await getServerSession(req, res, authOptions);
  if (!session?.accessToken) return res.status(401).json({ error: "Not authenticated" });
  const { accountId } = req.query;
  if (!VALID_ID.test(String(accountId || ""))) return res.status(400).json({ error: "accountId must be an ad account id like act_123" });

  try {
    const json = await graphGetAllPages(`/${accountId}/adspixels`, session.accessToken, {
      fields: "id,name,last_fired_time,is_unavailable",
      limit: 100,
    });
    const pixels = (json.data || []).map((p) => ({
      id: p.id,
      name: p.name,
      lastFiredTime: p.last_fired_time || null,
      unavailable: !!p.is_unavailable,
    }));
    res.status(200).json({ pixels });
  } catch (err) {
    res.status(err.graphResponse ? 400 : 500).json({ error: err.message || "Request failed" });
  }
}
