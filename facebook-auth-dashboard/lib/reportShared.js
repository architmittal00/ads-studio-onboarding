import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";

// Shared by every pages/api/fb/report/*.js endpoint — the Handover Report
// used to be one big handler computing everything in one response; it's now
// split into several independent, section-sized endpoints (so the page can
// show each section as soon as *its own* data is ready, instead of one
// all-or-nothing spinner) that all still need the exact same request
// validation, date-range resolution, and pure aggregation helpers the
// original single file used. Centralized here rather than duplicated six
// times.

const VALID_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function toDateStr(d) {
  return d.toISOString().slice(0, 10);
}

// Resolves the report's main date window from query params: a preset
// (today/last_7d/last_30d) or an explicit custom since/until. Falls back to
// last_30d for anything missing/invalid — the previous fixed default.
// `lastNDaysRange` is passed in (from lib/adCreativeDetails.js) rather than
// imported here, purely to avoid a second import of the same function at
// every call site — every endpoint already needs it directly too (for its
// own fixed-lookback or last-7-days calls).
export function resolveRange(query, today, lastNDaysRange) {
  const preset = query.rangePreset || "last_30d";

  if (preset === "today") {
    const d = toDateStr(today);
    return { since: d, until: d, label: "Today", preset };
  }
  if (preset === "last_7d") {
    return { ...lastNDaysRange(7, today), label: "Last 7 Days", preset };
  }
  if (preset === "custom" && VALID_DATE.test(query.since) && VALID_DATE.test(query.until) && query.since <= query.until) {
    return { since: query.since, until: query.until, label: `${query.since} → ${query.until}`, preset };
  }
  return { ...lastNDaysRange(30, today), label: "Last 30 Days", preset: "last_30d" };
}

export function daysBetween(since, until) {
  const ms = new Date(`${until}T00:00:00Z`) - new Date(`${since}T00:00:00Z`);
  return Math.round(ms / 86400000) + 1;
}

export function settled(result, fallback) {
  return result.status === "fulfilled" ? result.value : fallback;
}

// Groups `items` (each with spend/revenue/purchases) by `keyFn`, sums each
// group, and — unless `applyCutoff` is false — keeps only the highest-ranked
// groups needed to reach 80% of the total for whichever `metric` is passed
// ("revenue", the default, for the usual "where does 80% of purchase
// revenue come from" framing; "spend" for dimensions — like region, where
// Facebook doesn't return purchase data at all — where spend concentration
// is the only thing there's data for).
export function groupAndPareto(items, keyFn, { applyCutoff = true, metric = "revenue" } = {}) {
  const groups = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, { label: key, spend: 0, revenue: 0, purchases: 0 });
    const g = groups.get(key);
    g.spend += item.spend;
    g.revenue += item.revenue;
    g.purchases += item.purchases;
  }

  const allGroups = [...groups.values()].map((g) => ({
    ...g,
    roas: g.spend > 0 ? g.revenue / g.spend : 0,
  }));
  const totalRevenue = allGroups.reduce((sum, g) => sum + g.revenue, 0);
  const totalSpend = allGroups.reduce((sum, g) => sum + g.spend, 0);
  const total = metric === "spend" ? totalSpend : totalRevenue;
  const sorted = [...allGroups].sort((a, b) => b[metric] - a[metric]);

  let cumRevenue = 0;
  let cumSpend = 0;
  const contributors = [];
  for (const g of sorted) {
    if (applyCutoff && g[metric] <= 0) break;
    cumRevenue += g.revenue;
    cumSpend += g.spend;
    const cum = metric === "spend" ? cumSpend : cumRevenue;
    contributors.push({
      ...g,
      revenueSharePct: totalRevenue > 0 ? (g.revenue / totalRevenue) * 100 : 0,
      spendSharePct: totalSpend > 0 ? (g.spend / totalSpend) * 100 : 0,
    });
    if (applyCutoff && total > 0 && cum / total >= 0.8) break;
  }

  return {
    totalGroupCount: allGroups.length,
    contributorCount: contributors.length,
    revenueSharePct: totalRevenue > 0 ? (cumRevenue / totalRevenue) * 100 : 0,
    spendSharePct: totalSpend > 0 ? (cumSpend / totalSpend) * 100 : 0,
    contributors,
  };
}

export function bestBucket(rows, roasFromRow) {
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
export function toMajorUnits(value) {
  return value ? parseFloat(value) / 100 : null;
}

export function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

export function titleCaseSnake(s) {
  return s
    ? s
        .split("_")
        .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w))
        .join(" ")
    : s;
}

// Facebook's `platform_position` values are often already prefixed with the
// platform name (e.g. "instagram_reels", "facebook_reels") — strip that
// redundant prefix before combining with the platform label, so placements
// read "Instagram · Reels" / "Facebook · Reels" rather than
// "Instagram · Instagram Reels".
export function placementLabel(platform, position) {
  if (!platform || !position) return null;
  const prefix = `${platform}_`;
  const trimmed = position.startsWith(prefix) ? position.slice(prefix.length) : position;
  return `${titleCaseSnake(platform)} · ${titleCaseSnake(trimmed)}`;
}

// Auth + request validation + date-range resolution shared by every report
// section endpoint. Sends the appropriate error response and returns `null`
// on any failure — callers must check for that and return immediately
// without doing anything further. On success, returns everything a section
// handler needs to run its own Graph calls and cache its own result:
// `cacheKeyBase` has no section name in it yet — each endpoint appends its
// own (`` `${cacheKeyBase}:headline` ``, etc.) so every section gets an
// independent cache entry instead of one shared one.
export async function requireReportRequest(req, res, lastNDaysRange) {
  const session = await getServerSession(req, res, authOptions);
  if (!session?.accessToken) {
    res.status(401).json({ error: "Not authenticated" });
    return null;
  }

  const { accountId } = req.query;
  if (!accountId) {
    res.status(400).json({ error: "accountId is required" });
    return null;
  }

  const today = new Date();
  const range = resolveRange(req.query, today, lastNDaysRange);
  // Facebook's `time_range` param rejects any keys beyond since/until — strip
  // the label/preset we attach to `range` for our own response/cache-key use.
  const graphTimeRange = { since: range.since, until: range.until };
  const force = req.query.force === "true" || req.query.force === "1";
  const cacheKeyBase = `${session.user?.email || "unknown"}:${accountId}:${range.since}:${range.until}`;

  return { token: session.accessToken, accountId, today, range, graphTimeRange, force, cacheKeyBase };
}
