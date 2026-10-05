import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import { graphGet } from "@/lib/facebookGraph";
import { pickPurchaseCount, roasFromRow } from "@/lib/metrics";
import { getCachedReport, setCachedReport } from "@/lib/reportCache";

const RTG_PATTERN = /rtg|retarget/i;

function toDateStr(d) {
  return d.toISOString().slice(0, 10);
}

// Facebook's `date_preset` shortcuts can silently drift from what Ads
// Manager's own date picker shows for "Last N days" (e.g. by one day, or by
// timezone cutoff). Reach-based metrics like frequency are NOT additive
// across days, so even a one-day difference in the window can visibly shift
// them — unlike spend/clicks, which just sum. Using an explicit, fixed
// window (last N full days, not including today) and surfacing the exact
// dates in the UI makes that comparable and debuggable against Ads Manager.
function lastNDaysRange(n, today) {
  const until = new Date(today);
  until.setDate(until.getDate() - 1);
  const since = new Date(until);
  since.setDate(since.getDate() - (n - 1));
  return { since: toDateStr(since), until: toDateStr(until) };
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

function emptyAgg() {
  return { spend: 0, revenue: 0, creativeIds: new Set() };
}

function addToAgg(agg, ad) {
  agg.spend += ad.spend;
  agg.revenue += ad.revenue;
  if (ad.spend > 0) agg.creativeIds.add(ad.id);
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

  const force = req.query.force === "true" || req.query.force === "1";
  const cacheKey = `${session.user?.email || "unknown"}:${accountId}`;

  if (!force) {
    const cached = getCachedReport(cacheKey);
    if (cached) {
      return res.status(200).json({ ...cached.data, cachedAt: cached.fetchedAt, fromCache: true });
    }
  }

  const token = session.accessToken;
  const today = new Date();
  const range30d = lastNDaysRange(30, today);
  const range7d = lastNDaysRange(7, today);
  const since90 = new Date(today);
  since90.setDate(today.getDate() - 90);
  const since6mo = new Date(today);
  since6mo.setMonth(today.getMonth() - 6);

  const warnings = [];

  const [
    overviewResult,
    weeklyResult,
    monthlyResult,
    adLevelResult,
    structureResult,
    pixelsResult,
    last7CampaignResult,
    last7AdsetResult,
  ] = await Promise.allSettled([
    graphGet(`/${accountId}/insights`, token, {
      fields: "spend,clicks,ctr,actions,action_values,purchase_roas",
      time_range: range30d,
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
      level: "ad",
      fields:
        "ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,spend,impressions,clicks,frequency,actions,action_values",
      time_range: range30d,
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
      time_range: range7d,
      limit: 500,
    }),
    graphGet(`/${accountId}/insights`, token, {
      level: "adset",
      fields: "adset_id,spend",
      time_range: range7d,
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

  // ── Ad-level data: the single source of truth for campaign/adset aggregation ──
  const adLevelJson = settled(adLevelResult, null);
  if (adLevelResult.status === "rejected")
    warnings.push(`Creative-level performance unavailable: ${adLevelResult.reason.message}`);

  const adRows = (adLevelJson?.data || []).map((row) => {
    const { spend, revenue, roas } = roasFromRow(row);
    return {
      id: row.ad_id,
      name: row.ad_name,
      adsetId: row.adset_id,
      adsetName: row.adset_name,
      campaignId: row.campaign_id,
      campaignName: row.campaign_name,
      spend,
      revenue,
      roas,
      purchases: pickPurchaseCount(row.actions),
      frequency: parseFloat(row.frequency || 0),
    };
  });

  // Account-wide benchmark: average spend per active creative over the last
  // 30 days. Used (instead of an arbitrary fixed number) as the reference
  // point for "is this campaign/ad set spending too much per creative".
  const totalAccountSpend = adRows.reduce((sum, r) => sum + r.spend, 0);
  const totalActiveCreatives = new Set(adRows.filter((r) => r.spend > 0).map((r) => r.id)).size;
  const accountAvgSpendPerCreative = totalActiveCreatives > 0 ? totalAccountSpend / totalActiveCreatives : 0;

  function creativeRecommendation(agg) {
    const creativeCount = agg.creativeIds.size;
    if (accountAvgSpendPerCreative <= 0) {
      return { creativeCount, recommendedCreatives: null, additionalNeeded: null };
    }
    const recommendedCreatives = Math.max(1, Math.ceil(agg.spend / accountAvgSpendPerCreative));
    return {
      creativeCount,
      recommendedCreatives,
      additionalNeeded: Math.max(0, recommendedCreatives - creativeCount),
    };
  }

  // ── Account structure: campaigns → ad sets → ads, budget-type aware ──
  const structureJson = settled(structureResult, null);
  if (structureResult.status === "rejected")
    warnings.push(`Account structure unavailable: ${structureResult.reason.message}`);

  const last7CampaignJson = settled(last7CampaignResult, null);
  if (last7CampaignResult.status === "rejected")
    warnings.push(`Campaign budget utilization unavailable: ${last7CampaignResult.reason.message}`);
  const last7AdsetJson = settled(last7AdsetResult, null);
  if (last7AdsetResult.status === "rejected")
    warnings.push(`Ad set budget utilization unavailable: ${last7AdsetResult.reason.message}`);

  const last7SpendByCampaign = {};
  for (const row of last7CampaignJson?.data || []) {
    last7SpendByCampaign[row.campaign_id] = parseFloat(row.spend || 0);
  }
  const last7SpendByAdset = {};
  for (const row of last7AdsetJson?.data || []) {
    last7SpendByAdset[row.adset_id] = parseFloat(row.spend || 0);
  }

  const campaignsRaw = structureJson?.data || [];

  const campaigns = campaignsRaw.map((c) => {
    const adsetsRaw = c.adsets?.data || [];

    const campaignDailyBudget = toMajorUnits(c.daily_budget);
    const campaignLifetimeBudget = toMajorUnits(c.lifetime_budget);
    const isCbo = campaignDailyBudget != null || campaignLifetimeBudget != null;
    const hasAdsetBudgets = adsetsRaw.some((a) => a.daily_budget != null || a.lifetime_budget != null);
    const budgetType = isCbo ? "CBO" : hasAdsetBudgets ? "ABO" : "NONE";

    const campAgg = emptyAgg();
    const adsets = adsetsRaw.map((a) => {
      const adsetAgg = emptyAgg();
      const ads = adRows
        .filter((r) => r.adsetId === a.id)
        .map((r) => {
          addToAgg(adsetAgg, r);
          addToAgg(campAgg, r);
          return {
            id: r.id,
            name: r.name,
            spend: r.spend,
            revenue: r.revenue,
            roas: r.roas,
            purchases: r.purchases,
            frequency: r.frequency,
          };
        })
        .sort((x, y) => y.spend - x.spend);

      const adsetDailyBudget = toMajorUnits(a.daily_budget);
      const adsetLifetimeBudget = toMajorUnits(a.lifetime_budget);
      const avgDailySpend7d = (last7SpendByAdset[a.id] || 0) / 7;
      const utilizationPct =
        budgetType === "ABO" && adsetDailyBudget ? (avgDailySpend7d / adsetDailyBudget) * 100 : null;

      return {
        id: a.id,
        name: a.name,
        status: a.effective_status,
        dailyBudget: adsetDailyBudget,
        lifetimeBudget: adsetLifetimeBudget,
        spend30d: adsetAgg.spend,
        revenue30d: adsetAgg.revenue,
        roas30d: adsetAgg.spend > 0 ? adsetAgg.revenue / adsetAgg.spend : 0,
        avgDailySpend7d,
        utilizationPct,
        ...creativeRecommendation(adsetAgg),
        ads,
      };
    });

    const avgDailySpend7dCampaign = (last7SpendByCampaign[c.id] || 0) / 7;
    const campaignUtilizationPct =
      budgetType === "CBO" && campaignDailyBudget ? (avgDailySpend7dCampaign / campaignDailyBudget) * 100 : null;

    return {
      id: c.id,
      name: c.name,
      status: c.effective_status,
      objective: c.objective,
      budgetType,
      dailyBudget: campaignDailyBudget,
      lifetimeBudget: campaignLifetimeBudget,
      spend30d: campAgg.spend,
      revenue30d: campAgg.revenue,
      roas30d: campAgg.spend > 0 ? campAgg.revenue / campAgg.spend : 0,
      avgDailySpend7d: avgDailySpend7dCampaign,
      utilizationPct: campaignUtilizationPct,
      ...creativeRecommendation(campAgg),
      adsets,
    };
  });

  // ── Top spending campaigns (derived from the structure tree) ──
  const topCampaigns = [...campaigns]
    .map((c) => ({ id: c.id, name: c.name, spend: c.spend30d, revenue: c.revenue30d, roas: c.roas30d }))
    .sort((a, b) => b.spend - a.spend)
    .slice(0, 10);

  // ── 80% purchase-revenue pareto, at the creative level ──
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
      id: c.id,
      name: c.name,
      campaignName: c.campaignName,
      spend: c.spend,
      revenue: c.revenue,
      roas: c.roas,
      purchases: c.purchases,
    })),
  };

  // ── High-frequency ads, excluding retargeting campaigns/ad sets ──
  const highFrequencyAds = adRows
    .filter(
      (r) =>
        r.frequency > 3 && !RTG_PATTERN.test(r.campaignName || "") && !RTG_PATTERN.test(r.adsetName || "")
    )
    .map((r) => ({
      id: r.id,
      name: r.name,
      campaignName: r.campaignName,
      adsetName: r.adsetName,
      frequency: r.frequency,
    }))
    .sort((a, b) => b.frequency - a.frequency);

  // ── Underutilized budgets, split by who actually owns the budget ──
  const underutilized = {
    cboCampaigns: campaigns
      .filter((c) => c.status === "ACTIVE" && c.budgetType === "CBO" && c.utilizationPct !== null && c.utilizationPct < 100)
      .map((c) => ({
        id: c.id,
        name: c.name,
        dailyBudget: c.dailyBudget,
        avgDailySpend7d: c.avgDailySpend7d,
        utilizationPct: c.utilizationPct,
      }))
      .sort((a, b) => a.utilizationPct - b.utilizationPct),
    aboAdsets: campaigns
      .filter((c) => c.budgetType === "ABO")
      .flatMap((c) =>
        c.adsets
          .filter((a) => a.status === "ACTIVE" && a.utilizationPct !== null && a.utilizationPct < 100)
          .map((a) => ({
            id: a.id,
            name: a.name,
            campaignName: c.name,
            dailyBudget: a.dailyBudget,
            avgDailySpend7d: a.avgDailySpend7d,
            utilizationPct: a.utilizationPct,
          }))
      )
      .sort((a, b) => a.utilizationPct - b.utilizationPct),
  };

  // ── Creative count recommendations, same CBO/ABO split ──
  const creativeRecommendations = {
    accountAvgSpendPerCreative,
    cboCampaigns: campaigns
      .filter((c) => c.budgetType === "CBO" && c.additionalNeeded > 0)
      .map((c) => ({
        id: c.id,
        name: c.name,
        spend30d: c.spend30d,
        creativeCount: c.creativeCount,
        recommendedCreatives: c.recommendedCreatives,
        additionalNeeded: c.additionalNeeded,
      }))
      .sort((a, b) => b.additionalNeeded - a.additionalNeeded),
    aboAdsets: campaigns
      .filter((c) => c.budgetType === "ABO")
      .flatMap((c) =>
        c.adsets
          .filter((a) => a.additionalNeeded > 0)
          .map((a) => ({
            id: a.id,
            name: a.name,
            campaignName: c.name,
            spend30d: a.spend30d,
            creativeCount: a.creativeCount,
            recommendedCreatives: a.recommendedCreatives,
            additionalNeeded: a.additionalNeeded,
          }))
      )
      .sort((a, b) => b.additionalNeeded - a.additionalNeeded),
  };

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

  // Account Structure only shows campaigns/ad sets that actually spent in
  // the last 30 days — the "what's live and running" view. Underutilized and
  // creative-recommendation sections above deliberately use the unfiltered
  // `campaigns` tree instead, since a zero-spend active campaign is exactly
  // the kind of thing those sections should be able to flag.
  const structureCampaigns = campaigns
    .filter((c) => c.spend30d > 0)
    .map((c) => ({ ...c, adsets: c.adsets.filter((a) => a.spend30d > 0) }));
  const structureAdsetCount = structureCampaigns.reduce((sum, c) => sum + c.adsets.length, 0);

  const payload = {
    dateRange30d: range30d,
    overview,
    bestWeek,
    bestMonth,
    topCampaigns,
    pareto,
    highFrequencyAds,
    structure: {
      campaignCount: structureCampaigns.length,
      adsetCount: structureAdsetCount,
      campaigns: structureCampaigns,
    },
    pixelHealth: { pixels, concerns: pixelConcerns },
    underutilized,
    creativeRecommendations,
    warnings,
  };

  setCachedReport(cacheKey, payload);
  res.status(200).json({ ...payload, cachedAt: Date.now(), fromCache: false });
}
