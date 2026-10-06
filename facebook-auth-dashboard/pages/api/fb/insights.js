import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import { graphGetInsights } from "@/lib/facebookGraph";
import { pickPurchaseCount, roasFromRow } from "@/lib/metrics";

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
    const json = await graphGetInsights(`/${accountId}/insights`, session.accessToken, {
      fields: "spend,impressions,clicks,ctr,action_values,purchase_roas,actions",
      date_preset: "last_30d",
    });

    const row = json.data?.[0];

    if (!row) {
      return res.status(200).json({
        spend: 0,
        revenue: 0,
        roas: 0,
        ctr: 0,
        conversions: 0,
        hasData: false,
      });
    }

    const { spend, revenue, roas } = roasFromRow(row);

    // Facebook's "ctr" field is already a percentage (e.g. "1.23" = 1.23%)
    const ctr = parseFloat(row.ctr || 0);
    const conversions = pickPurchaseCount(row.actions);

    res.status(200).json({ spend, revenue, roas, ctr, conversions, hasData: true });
  } catch (err) {
    res.status(err.graphResponse ? 400 : 500).json({ error: err.message });
  }
}
