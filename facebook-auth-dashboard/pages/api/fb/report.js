import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import { graphGet } from "@/lib/facebookGraph";
import { pickPurchaseCount, roasFromRow } from "@/lib/metrics";

const RTG_PATTERN = /rtg|retarget/i;

function toDateStr(d) {
  return d.toISOString().slice(0, 10);
}

function settled(result, fallback) {
  return result.status === "fulfilled" ? result.value : fallback;
}

function bestBucket(rows) {
  if (!rows || !rows.length) return null;
  let best = null;
  for (const row of rows) {
    const { spend, revenue, roas } = roasFromRow(row);
    if (spend <= 0) continue;
    if (!best || roas > best.roas) {
      best = { roas, spend, revenue, since: row.date_start, until: row.date_stop };
    }
  }
  return best;
}

// Facebook returns daily_budget/lifetime_budget in the account currency's
// minor unit (e.g. cents). This doesn't hold for zero-decimal currencies
// (JPY, KRW, etc.) — acceptable simplification for now.
function toMajorUnits(value) {
  return value ? parseFloat(value) / 100 : null;
}

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
  const today = new Date();
  const since90 = new Date(today);
  since90.setDate(today.getDate() - 90);
  const since6mo = new Date(today);
  since6mo.setMonth(today.getMonth() - 6);

  const warnings = [];

  const [
    overviewResult,
    weeklyResult,
    monthlyResult,
    campaignSpendResult,
    adLevelResult,
    structureResult,
    pixelsResult,
    last7CampaignResult,
  ] = await Promise.allSettled([
    graphGet(`/${accountId}/insights`, token, {
      fields: "spend,clicks,ctr,actions,action_values,purchase_roas",
      date_preset: "last_30d",
    }),
    graphGet(`/${accountId}/insights`, token, {
      fields: "spend,actions,action_values,purchase_roas",
      time_range: { since: toDateStr(since90), until: toDateStr(today) },
      time_increment: 7,
    }),
    graphGet(`/${accountId}/insights`, token, {
      fields: "spend,actions,action_values,purchase_roas",
      time_range: { since: toDateStr(since6mo), until: toDateStr(today) },
      time_increment: "monthly",
    }),
    graphGet(`/${accountId}/insights`, token, {
      level: "campaign",
      fields: "campaign_id,campaign_name,spend,actions,action_values,purchase_roas",
      date_preset: "last_30d",
      limit: 500,
    }),
    graphGet(`/${accountId}/insights`, token, {
      level: "ad",
      fields:
        "ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,spend,impressions,clicks,frequency,actions,action_values",
      date_preset: "last_30d",
      limit: 500,
    }),
    graphGet(`/${accountId}/campaigns`, token, {
      fields:
        "id,name,effective_status,objective,daily_budget,lifetime_budget,adsets.limit(200){id,name,effective_status,daily_budget,lifetime_budget}",
      limit: 200,
    }),
    graphGet(`/${accountId}/adspixels`, token, {
      fields: "id,name,last_fired_time,creation_time",
    }),
    graphGet(`/${accountId}/insights`, token, {
      level: "campaign",
      fields: "campaign_id,spend",
      date_preset: "last_7d",
      limit: 500,
    }),
  ]);

  // ── Overview (last 30 days) ──
  const overviewJson = settled(overviewResult, null);
  if (overviewResult.status === "rejected") warnings.push(`Overview metrics unavailable: ${overviewResult.reason.message}`);
  const overviewRow = overviewJson?.data?.[0];
  const overview = overviewRow
    ? (() => {
        const { spend, revenue, roas } = roasFromRow(overviewRow);
        const clicks = parseFloat(overviewRow.clicks || 0);
        const ctr = parseFloat(overviewRow.ctr || 0);
        const purchases = pickPurchaseCount(overviewRow.actions);
        const cvr = clicks > 0 ? (purchases / clicks) * 100 : 0;
        return { spend, revenue, roas, ctr, purchases, cvr };
      })()
    : { spend: 0, revenue: 0, roas: 0, ctr: 0, purchases: 0, cvr: 0 };

  // ── Best week / best month by ROAS ──
  const weeklyJson = settled(weeklyResult, null);
  if (weeklyResult.status === "rejected") warnings.push(`Weekly trend unavailable: ${weeklyResult.reason.message}`);
  const monthlyJson = settled(monthlyResult, null);
  if (monthlyResult.status === "rejected") warnings.push(`Monthly trend unavailable: ${monthlyResult.reason.message}`);

  const bestWeek = bestBucket(weeklyJson?.data);
  const bestMonth = bestBucket(monthlyJson?.data);

  // ── Top spending campaigns ──
  const campaignSpendJson = settled(campaignSpendResult, null);
  if (campaignSpendResult.status === "rejected")
    warnings.push(`Campaign spend ranking unavailable: ${campaignSpendResult.reason.message}`);

  const topCampaigns = (campaignSpendJson?.data || [])
    .map((row) => {
      const { spend, revenue, roas } = roasFromRow(row);
      return { id: row.campaign_id, name: row.campaign_name, spend, revenue, roas };
    })
    .sort((a, b) => b.spend - a.spend)
    .slice(0, 10);

  // ── Ad-level data: powers the 80% pareto analysis and high-frequency list ──
  const adLevelJson = settled(adLevelResult, null);
  if (adLevelResult.status === "rejected")
    warnings.push(`Creative-level performance unavailable: ${adLevelResult.reason.message}`);

  const adRows = (adLevelJson?.data || []).map((row) => {
    const { spend, revenue, roas } = roasFromRow(row);
    return {
      id: row.ad_id,
      name: row.ad_name,
      adsetName: row.adset_name,
      campaignName: row.campaign_name,
      spend,
      revenue,
      roas,
      purchases: pickPurchaseCount(row.actions),
      frequency: parseFloat(row.frequency || 0),
    };
  });

  const totalRevenue = adRows.reduce((sum, r) => sum + r.revenue, 0);
  const totalSpendAll = adRows.reduce((sum, r) => sum + r.spend, 0);
  const sortedByRevenue = [...adRows].sort((a, b) => b.revenue - a.revenue);

  let cumRevenue = 0;
  let cumSpend = 0;
  const contributors = [];
  for (const r of sortedByRevenue) {
    if (r.revenue <= 0) break;
    cumRevenue += r.revenue;
    cumSpend += r.spend;
    contributors.push(r);
    if (totalRevenue > 0 && cumRevenue / totalRevenue >= 0.8) break;
  }

  const pareto = {
    contributorCount: contributors.length,
    totalAdCount: adRows.length,
    revenueSharePct: totalRevenue > 0 ? (cumRevenue / totalRevenue) * 100 : 0,
    spendSharePct: totalSpendAll > 0 ? (cumSpend / totalSpendAll) * 100 : 0,
    contributors: contributors.map((c) => ({
      name: c.name,
      campaignName: c.campaignName,
      spend: c.spend,
      revenue: c.revenue,
      roas: c.roas,
      purchases: c.purchases,
    })),
  };

  // ── High-frequency ads, excluding retargeting campaigns/adsets ──
  const highFrequencyAds = adRows
    .filter(
      (r) =>
        r.frequency > 3 && !RTG_PATTERN.test(r.campaignName || "") && !RTG_PATTERN.test(r.adsetName || "")
    )
    .sort((a, b) => b.frequency - a.frequency);

  // ── Account structure: campaigns + adsets ──
  const structureJson = settled(structureResult, null);
  if (structureResult.status === "rejected")
    warnings.push(`Account structure unavailable: ${structureResult.reason.message}`);

  const campaignsRaw = structureJson?.data || [];
  let adsetCount = 0;
  const campaignSummaries = campaignsRaw.map((c) => {
    const adsets = c.adsets?.data || [];
    adsetCount += adsets.length;
    return {
      id: c.id,
      name: c.name,
      status: c.effective_status,
      objective: c.objective,
      dailyBudget: toMajorUnits(c.daily_budget),
      lifetimeBudget: toMajorUnits(c.lifetime_budget),
      adsets: adsets.map((a) => ({
        id: a.id,
        name: a.name,
        status: a.effective_status,
        dailyBudget: toMajorUnits(a.daily_budget),
        lifetimeBudget: toMajorUnits(a.lifetime_budget),
      })),
    };
  });

  // ── Underutilized campaigns: any active campaign spending below its daily budget ──
  const last7CampaignJson = settled(last7CampaignResult, null);
  if (last7CampaignResult.status === "rejected")
    warnings.push(`Budget utilization unavailable: ${last7CampaignResult.reason.message}`);

  const last7SpendByCampaign = {};
  for (const row of last7CampaignJson?.data || []) {
    last7SpendByCampaign[row.campaign_id] = parseFloat(row.spend || 0);
  }

  const underutilized = campaignSummaries
    .filter((c) => c.status === "ACTIVE")
    .map((c) => {
      const effectiveBudget = c.dailyBudget ?? c.adsets.reduce((sum, a) => sum + (a.dailyBudget || 0), 0);
      const avgDailySpend = (last7SpendByCampaign[c.id] || 0) / 7;
      const utilizationPct = effectiveBudget > 0 ? (avgDailySpend / effectiveBudget) * 100 : null;
      return { id: c.id, name: c.name, effectiveBudget, avgDailySpend, utilizationPct };
    })
    .filter((c) => c.utilizationPct !== null && c.utilizationPct < 100)
    .sort((a, b) => a.utilizationPct - b.utilizationPct);

  // ── Pixel health (best-effort: existence + staleness only) ──
  const pixelsJson = settled(pixelsResult, null);
  if (pixelsResult.status === "rejected")
    warnings.push(`Pixel health unavailable: ${pixelsResult.reason.message}`);

  const pixels = (pixelsJson?.data || []).map((p) => {
    const lastFired = p.last_fired_time ? new Date(p.last_fired_time) : null;
    const daysSinceFired = lastFired ? (Date.now() - lastFired.getTime()) / 86400000 : null;
    return {
      id: p.id,
      name: p.name,
      lastFiredTime: p.last_fired_time || null,
      daysSinceFired,
      status: !lastFired ? "never_fired" : daysSinceFired > 3 ? "stale" : "healthy",
    };
  });

  const pixelConcerns = pixels.filter((p) => p.status !== "healthy");
  if (pixelsJson && pixels.length === 0) {
    pixelConcerns.push({ name: "No pixel connected to this ad account", status: "missing" });
  }

  res.status(200).json({
    overview,
    bestWeek,
    bestMonth,
    topCampaigns,
    pareto,
    highFrequencyAds,
    structure: { campaignCount: campaignsRaw.length, adsetCount, campaigns: campaignSummaries },
    pixelHealth: { pixels, concerns: pixelConcerns },
    underutilized,
    warnings,
  });
}
