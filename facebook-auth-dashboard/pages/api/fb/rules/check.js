import { getServerSession } from "next-auth/next";
import { authOptions } from "../../auth/[...nextauth]";
import { graphGet, graphGetAllPages, graphGetInsights } from "@/lib/facebookGraph";
import { todayInTimeZone } from "@/lib/dateRanges";
import { lastNDaysRange } from "@/lib/adCreativeDetails";
import { WINDOWS } from "@/lib/rules/metrics";
import { evaluateAccount } from "@/lib/rules/engine";

// Validates one ad account against the rules sheet (lib/rules/definitions.js).
// One ad-level insights pull per window (3/7/14/30 days ending yesterday) plus the account's
// ACTIVE campaigns / ad sets / ads; everything else (account, campaign and ad set totals) is
// summed from those rows, so the cost is 4 insights jobs + 3 list calls, all in parallel.
const VALID_ID = /^act_\d+$/;
const ACTIVE_FILTER = [{ field: "effective_status", operator: "IN", value: ["ACTIVE", "IN_PROCESS"] }];

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const session = await getServerSession(req, res, authOptions);
  if (!session?.accessToken) return res.status(401).json({ error: "Not authenticated" });
  const { accountId } = req.query;
  if (!VALID_ID.test(String(accountId || ""))) return res.status(400).json({ error: "accountId must be an ad account id like act_123" });
  const token = session.accessToken;

  try {
    const account = await graphGet(`/${accountId}`, token, { fields: "name,currency,timezone_name" });
    const today = todayInTimeZone(account.timezone_name);

    const insightsFor = (days) => {
      const range = lastNDaysRange(days, today);
      return graphGetInsights(
        `/${accountId}/insights`,
        token,
        {
          level: "ad",
          fields: "ad_id,adset_id,campaign_id,spend,impressions,clicks,actions,action_values",
          time_range: { since: range.since, until: range.until },
          limit: 500,
        },
        { timeoutMs: 60000 }
      ).then((r) => r.data || []);
    };

    const [campaigns, adsets, ads, ...windowRows] = await Promise.all([
      graphGetAllPages(`/${accountId}/campaigns`, token, { fields: "id,name,daily_budget,lifetime_budget", filtering: ACTIVE_FILTER, limit: 500 }),
      graphGetAllPages(`/${accountId}/adsets`, token, { fields: "id,name,campaign_id,daily_budget,lifetime_budget", filtering: ACTIVE_FILTER, limit: 500 }),
      graphGetAllPages(`/${accountId}/ads`, token, { fields: "id,name,adset_id,campaign_id", filtering: ACTIVE_FILTER, limit: 500 }),
      ...WINDOWS.map(insightsFor),
    ]);
    const insightsByWindow = Object.fromEntries(WINDOWS.map((w, i) => [w, windowRows[i]]));

    let currencySymbol = "₹";
    try {
      currencySymbol = new Intl.NumberFormat("en-IN", { style: "currency", currency: account.currency || "INR" }).formatToParts(0).find((p) => p.type === "currency")?.value || "₹";
    } catch {}

    const result = evaluateAccount({
      structure: { campaigns: campaigns.data || [], adsets: adsets.data || [], ads: ads.data || [] },
      insightsByWindow,
      currency: account.currency,
      currencySymbol,
    });
    res.status(200).json({
      accountId,
      accountName: account.name,
      currency: account.currency,
      currencySymbol,
      generatedAt: Date.now(),
      windowEnd: lastNDaysRange(1, today).until,
      ...result,
    });
  } catch (err) {
    res.status(err.graphResponse ? 400 : 500).json({ error: err.message || "Request failed" });
  }
}
