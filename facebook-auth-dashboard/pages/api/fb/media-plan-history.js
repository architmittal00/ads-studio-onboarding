import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import { graphGetInsights } from "@/lib/facebookGraph";
import { pickPurchaseCount, pickPurchaseValue } from "@/lib/metrics";
import { ADD_TO_CART_TYPES, INITIATE_CHECKOUT_TYPES, pickAnyActionValue } from "@/lib/insightsMetrics";
import { lastFullMonths } from "@/lib/mediaPlan";
import { mapWithConcurrency } from "@/lib/metaInterestSearch";

const MAX_ACCOUNTS = 20;
const VALID_ACCOUNT = /^act_\d+$/;

// What each account actually did in the last three full calendar months, month by month: the raw totals the Media Plan
// page turns into its assumptions (CTR, CPC, click -> landing page view, -> add to cart, -> checkout, -> purchase, AOV).
// Link clicks and landing page views are used, not "all clicks", so the funnel starts where the website visit starts.
// Reading only; nothing is written to Meta.
export default async function handler(req, res) {
  const session = await getServerSession(req, res, authOptions);
  if (!session?.accessToken) return res.status(401).json({ error: "Not authenticated" });

  const ids = [...new Set(String(req.query.accountIds || "").split(",").map((s) => s.trim()).filter(Boolean))];
  if (ids.length === 0) return res.status(400).json({ error: "accountIds is required" });
  if (ids.length > MAX_ACCOUNTS) return res.status(400).json({ error: `Pick at most ${MAX_ACCOUNTS} accounts.` });
  if (!ids.every((id) => VALID_ACCOUNT.test(id))) return res.status(400).json({ error: "accountIds must be ad account ids like act_123" });

  const months = lastFullMonths(new Date(), 3);
  const range = { since: months[0].since, until: months[months.length - 1].until };

  const accounts = await mapWithConcurrency(ids, 3, async (accountId) => {
    try {
      const json = await graphGetInsights(`/${accountId}/insights`, session.accessToken, {
        fields: "spend,impressions,inline_link_clicks,actions,action_values",
        time_range: range,
        time_increment: "monthly",
      });
      const byMonth = new Map((json.data || []).map((r) => [String(r.date_start).slice(0, 7), r]));
      return {
        accountId,
        months: months.map((m) => {
          const r = byMonth.get(m.key);
          return {
            month: m.key,
            spend: parseFloat(r?.spend || 0),
            impressions: parseFloat(r?.impressions || 0),
            linkClicks: parseFloat(r?.inline_link_clicks || 0),
            lpv: pickAnyActionValue(r?.actions, ["landing_page_view"]),
            atc: pickAnyActionValue(r?.actions, ADD_TO_CART_TYPES),
            ic: pickAnyActionValue(r?.actions, INITIATE_CHECKOUT_TYPES),
            purchases: pickPurchaseCount(r?.actions),
            revenue: pickPurchaseValue(r?.action_values),
          };
        }),
      };
    } catch (err) {
      return { accountId, error: err.message || "Request failed" };
    }
  });

  res.status(200).json({ range, months: months.map((m) => m.key), accounts });
}
