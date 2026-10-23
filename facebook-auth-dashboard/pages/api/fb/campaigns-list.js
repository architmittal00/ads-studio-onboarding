import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import { graphGet, graphGetAllPages, graphGetInsights } from "@/lib/facebookGraph";
import { lastNDaysRange } from "@/lib/adCreativeDetails";
import { roasFromRow, pickPurchaseCount } from "@/lib/metrics";
import { campaignFormFieldsFromSource } from "@/lib/campaignLaunch";

// Full Graph fields needed to clone a source campaign's own settings — see
// lib/campaignLaunch.js's campaignFormFieldsFromSource, the `?campaignId=`
// mode's own converter below.
const CAMPAIGN_DETAIL_FIELDS = "name,objective,bid_strategy,daily_budget,lifetime_budget,special_ad_categories,smart_promotion_type,status";

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
//
// Two modes, mirroring pages/api/fb/adsets-list.js exactly: `?accountId=`
// (above) lists an account's campaigns; `?campaignId=` (new, for Copy Ads'
// campaign-level cross-account copy) fetches one campaign's own full detail,
// pre-converted to the Launch form's field shape via campaignFormFieldsFromSource.
export default async function handler(req, res) {
  const session = await getServerSession(req, res, authOptions);
  if (!session?.accessToken) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  const { accountId, campaignId } = req.query;
  if (!accountId && !campaignId) {
    return res.status(400).json({ error: "accountId or campaignId is required" });
  }

  const token = session.accessToken;
  try {
    if (campaignId) {
      const campaign = await graphGet(`/${campaignId}`, token, { fields: CAMPAIGN_DETAIL_FIELDS });
      res.status(200).json({ name: campaign.name, fields: campaignFormFieldsFromSource(campaign) });
      return;
    }
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
