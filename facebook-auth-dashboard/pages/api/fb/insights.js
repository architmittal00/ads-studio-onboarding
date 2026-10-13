import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import { graphGetInsights } from "@/lib/facebookGraph";
import { pickPurchaseCount, roasFromRow } from "@/lib/metrics";
import { lastNDaysRange } from "@/lib/adCreativeDetails";

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
    // Facebook's own `date_preset: "last_30d"` shortcut can silently drift
    // from what "Last 30 Days" means everywhere else in this app (it also
    // includes today, an incomplete day) — an explicit time_range instead,
    // same as pages/report.js and pages/explore.js.
    const json = await graphGetInsights(`/${accountId}/insights`, session.accessToken, {
      fields: "spend,impressions,inline_link_clicks,action_values,purchase_roas,actions",
      time_range: lastNDaysRange(30, new Date()),
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

    // Link CTR (impressions that actually led to a click to the advertiser's
    // site), not Facebook's own `ctr` field — that counts every click
    // (reactions, shares, comments included), not just a real link click.
    const impressions = parseFloat(row.impressions || 0);
    const linkClicks = parseFloat(row.inline_link_clicks || 0);
    const ctr = impressions > 0 ? (linkClicks / impressions) * 100 : 0;
    const conversions = pickPurchaseCount(row.actions);

    res.status(200).json({ spend, revenue, roas, ctr, conversions, hasData: true });
  } catch (err) {
    res.status(err.graphResponse ? 400 : 500).json({ error: err.message });
  }
}
