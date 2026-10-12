import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import { graphGetAllPages, graphGetInsights } from "@/lib/facebookGraph";
import { lastNDaysRange } from "@/lib/adCreativeDetails";
import { roasFromRow, pickPurchaseCount } from "@/lib/metrics";

// Lists an ad account's campaigns for the Launch tab's "existing campaign"
// picker (searched client-side — Meta exposes no live "search my campaigns"
// endpoint, unlike interests/locations/languages). `objective` is returned
// so the ad set form can constrain/default its Performance Goal options to
// whatever's actually compatible with the chosen campaign. Also attaches
// each campaign's last-30-day spend/purchases/ROAS — picking which existing
// campaign to attach a new ad set to needs more than just a name to go on,
// same reasoning as pages/api/fb/adsets-list.js's own addition below. A
// failed insights call degrades to showing the list without performance
// data rather than failing the whole request (Promise.allSettled).
export default async function handler(req, res) {
  const session = await getServerSession(req, res, authOptions);
  if (!session?.accessToken) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  const { accountId } = req.query;
  if (!accountId) {
    return res.status(400).json({ error: "accountId is required" });
  }

  const token = session.accessToken;
  try {
    const [listResult, insightsResult] = await Promise.allSettled([
      graphGetAllPages(`/${accountId}/campaigns`, token, {
        fields: "id,name,effective_status,objective,daily_budget,lifetime_budget",
        limit: 200,
      }),
      graphGetInsights(`/${accountId}/insights`, token, {
        level: "campaign",
        fields: "campaign_id,spend,actions,action_values,purchase_roas",
        time_range: lastNDaysRange(30, new Date()),
        limit: 500,
      }),
    ]);

    if (listResult.status !== "fulfilled") throw listResult.reason;

    const performanceByCampaignId = new Map();
    if (insightsResult.status === "fulfilled") {
      for (const row of insightsResult.value.data || []) {
        const { spend, roas } = roasFromRow(row);
        performanceByCampaignId.set(row.campaign_id, { spend, purchases: pickPurchaseCount(row.actions), roas });
      }
    }

    const campaigns = (listResult.value.data || []).map((c) => ({
      ...c,
      performance: performanceByCampaignId.get(c.id) || null,
    }));
    res.status(200).json({ campaigns });
  } catch (err) {
    res.status(err.graphResponse ? 400 : 500).json({ error: err.message });
  }
}
