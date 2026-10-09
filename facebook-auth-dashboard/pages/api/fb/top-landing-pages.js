import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import { graphGetInsights } from "@/lib/facebookGraph";
import { pickPurchaseCount, roasFromRow } from "@/lib/metrics";
import { lastNDaysRange, fetchAdDetails, fetchPostLandingUrls, extractLandingPageLabel } from "@/lib/adCreativeDetails";

const WINDOW_DAYS = 30;
const TOP_LANDING_PAGES_LIMIT = 15;

// Lightweight, single-purpose endpoint for the Strategy 8 AI-recommendation
// step: top landing pages by revenue, always a fixed last-30-days window
// (independent of whatever range the user has selected on /report) — see
// lib/adCreativeDetails.js's lastNDaysRange(). Grouped by the actual raw URL
// (unlike /api/fb/report/core's purchasesByProduct, which only keeps a derived
// label) since the AI needs real links, not just display labels.
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
  const { since, until } = lastNDaysRange(WINDOW_DAYS, new Date());
  const warnings = [];

  try {
    const adLevelJson = await graphGetInsights(`/${accountId}/insights`, token, {
      level: "ad",
      fields: "ad_id,ad_name,spend,action_values,actions",
      time_range: { since, until },
      limit: 500,
    });

    const adRows = (adLevelJson.data || []).map((row) => {
      const { spend, revenue } = roasFromRow(row);
      return { id: row.ad_id, spend, revenue, purchases: pickPurchaseCount(row.actions) };
    });

    let adDetailsById = {};
    try {
      adDetailsById = await fetchAdDetails(
        adRows.map((r) => r.id),
        token
      );
    } catch (err) {
      warnings.push(`Ad details unavailable: ${err.message}`);
    }

    const postIdsNeedingLink = [
      ...new Set(Object.values(adDetailsById).map((d) => d.postId).filter(Boolean)),
    ];
    let postLandingUrlByPostId = {};
    try {
      postLandingUrlByPostId = await fetchPostLandingUrls(postIdsNeedingLink, token);
    } catch (err) {
      warnings.push(`Some landing pages (linked via a Page post) could not be resolved: ${err.message}`);
    }

    const byUrl = new Map();
    let resolvedCount = 0;
    for (const r of adRows) {
      const details = adDetailsById[r.id];
      if (details?.creativeType === "Catalog") continue; // no single fixed URL to group by
      const url = details?.landingUrl || (details?.postId ? postLandingUrlByPostId[details.postId] : null) || null;
      if (!url) continue;
      resolvedCount += 1;
      if (!byUrl.has(url)) byUrl.set(url, { url, label: extractLandingPageLabel(url), spend: 0, revenue: 0, purchases: 0 });
      const g = byUrl.get(url);
      g.spend += r.spend;
      g.revenue += r.revenue;
      g.purchases += r.purchases;
    }

    const landingPages = [...byUrl.values()]
      .filter((g) => g.revenue > 0)
      .map((g) => ({ ...g, roas: g.spend > 0 ? g.revenue / g.spend : 0 }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, TOP_LANDING_PAGES_LIMIT);

    res.status(200).json({
      windowSince: since,
      windowUntil: until,
      landingPages,
      totalAdsConsidered: adRows.length,
      resolvedCount,
      warnings,
    });
  } catch (err) {
    res.status(err.graphResponse ? 400 : 500).json({ error: err.message });
  }
}
