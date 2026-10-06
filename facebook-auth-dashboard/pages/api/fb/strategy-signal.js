import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import { graphGetInsights } from "@/lib/facebookGraph";
import { pickActionCount, pickPurchaseCount } from "@/lib/metrics";

// Decides whether an ad account has "enough history" to justify a
// retargeting-led strategy (vs. one built around prospecting), instead of
// just trusting that any connected account qualifies. The test: simulate
// spending the user's proposed daily budget entirely on Top-of-Funnel
// traffic for a month, at half the account's trailing-30-day average CPM
// (TOF/reach-optimized placements typically buy cheaper than the account's
// blended CPM), convert that to visitors using the account's own trailing
// impression-to-link-click ratio, and compare against the actual link
// clicks the account already generated in the last 30 days. If prospecting
// at full budget couldn't even match what the account already gets
// organically, the existing pool is big enough to be worth building around.
export default async function handler(req, res) {
  const session = await getServerSession(req, res, authOptions);

  if (!session?.accessToken) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  const { accountId, dailyBudget } = req.query;
  if (!accountId) {
    return res.status(400).json({ error: "accountId is required" });
  }
  const budget = parseFloat(dailyBudget);
  if (!budget || budget <= 0) {
    return res.status(400).json({ error: "dailyBudget must be a positive number" });
  }

  try {
    const json = await graphGetInsights(`/${accountId}/insights`, session.accessToken, {
      fields: "impressions,spend,cpm,actions",
      date_preset: "last_30d",
    });

    const row = json.data?.[0];
    const impressions = parseFloat(row?.impressions || 0);
    const spend = parseFloat(row?.spend || 0);
    const cpm = parseFloat(row?.cpm || 0) || (impressions > 0 ? (spend / impressions) * 1000 : 0);
    const linkClicks = pickActionCount(row?.actions, "link_click");
    const purchases = pickPurchaseCount(row?.actions);

    // Gate: without real link-click and purchase activity in the window,
    // there isn't enough signal to run the projection meaningfully (and
    // likely no real retargeting pool worth building around yet either).
    if (!row || linkClicks <= 0 || purchases <= 0) {
      return res.status(200).json({
        hasEnoughHistory: false,
        insufficientData: true,
        reason:
          "No link clicks or purchases on this account in the last 30 days — not enough activity to evaluate a retargeting pool.",
        details: { impressions, spend, cpm, linkClicks, purchases },
      });
    }

    const assumedTofCpm = cpm * 0.5;
    const projectedImpressions = assumedTofCpm > 0 ? ((budget * 30) / assumedTofCpm) * 1000 : 0;
    const linkClickRatio = impressions > 0 ? linkClicks / impressions : 0;
    const projectedVisitors = projectedImpressions * linkClickRatio;
    const actualVisitors = linkClicks;

    const hasEnoughHistory = projectedVisitors < actualVisitors;
    const fmt = (n) => Math.round(n).toLocaleString("en-US");

    res.status(200).json({
      hasEnoughHistory,
      insufficientData: false,
      reason: hasEnoughHistory
        ? `A full month of prospecting at this budget would bring an estimated ${fmt(projectedVisitors)} new visitors — fewer than the ${fmt(actualVisitors)} link clicks this account already got in the last 30 days, so there's a meaningful existing audience worth retargeting.`
        : `A full month of prospecting at this budget would bring an estimated ${fmt(projectedVisitors)} new visitors — more than the ${fmt(actualVisitors)} link clicks from the last 30 days, so the existing pool isn't large enough yet to prioritize over prospecting.`,
      details: {
        impressions,
        spend,
        cpm,
        linkClicks,
        purchases,
        assumedTofCpm,
        projectedImpressions,
        linkClickRatio,
        projectedVisitors,
        actualVisitors,
      },
    });
  } catch (err) {
    res.status(err.graphResponse ? 400 : 500).json({ error: err.message });
  }
}
