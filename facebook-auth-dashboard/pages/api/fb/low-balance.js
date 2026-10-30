import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import { graphGet } from "@/lib/facebookGraph";
import { mapWithConcurrency } from "@/lib/metaInterestSearch";
import { todayInTimeZone } from "@/lib/dateRanges";
import { lastNDaysRange } from "@/lib/adCreativeDetails";

// "Low balance" for the Custom Views badge. Balance here is the spend cap left
// (spend_cap - amount_spent), the figure the Raw Data tab shows. An account is low when
//  - it spent something in the last 3 full days (not including today, in the account's own
//    time zone, same window as the app's "Last 3 Days"), and
//  - its remaining cap is below yesterday's spend AND below the 3-day daily average.
// An account with no spend cap has no balance to run out of, so is never flagged.
const VALID_ID = /^act_\d+$/;
const MAX_ACCOUNTS = 25;

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const session = await getServerSession(req, res, authOptions);
  if (!session?.accessToken) return res.status(401).json({ error: "Not authenticated" });

  const ids = [...new Set(String(req.query.accountIds || "").split(",").map((s) => s.trim()).filter(Boolean))];
  if (ids.length === 0 || ids.length > MAX_ACCOUNTS || ids.some((id) => !VALID_ID.test(id))) {
    return res.status(400).json({ error: `accountIds must be 1–${MAX_ACCOUNTS} ad account ids` });
  }
  const token = session.accessToken;

  const rows = await mapWithConcurrency(ids, 5, async (id) => {
    try {
      const account = await graphGet(`/${id}`, token, { fields: "name,currency,timezone_name,spend_cap,amount_spent" });
      const range = lastNDaysRange(3, todayInTimeZone(account.timezone_name));
      const insights = await graphGet(`/${id}/insights`, token, {
        fields: "spend",
        level: "account",
        time_increment: 1,
        time_range: { since: range.since, until: range.until },
        limit: 10,
      });
      const byDay = new Map((insights.data || []).map((d) => [d.date_start, parseFloat(d.spend || 0) || 0]));
      const days = [];
      for (let d = new Date(`${range.since}T00:00:00Z`); d <= new Date(`${range.until}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
        days.push(byDay.get(d.toISOString().slice(0, 10)) || 0);
      }
      const total = days.reduce((a, b) => a + b, 0);
      const avg = total / 3;
      const yesterday = days[days.length - 1];
      const cap = account.spend_cap && account.spend_cap !== "0" ? parseFloat(account.spend_cap) / 100 : null;
      const remaining = cap != null ? Math.max(cap - (parseFloat(account.amount_spent || 0) / 100 || 0), 0) : null;
      return {
        id,
        name: account.name,
        currency: account.currency,
        remaining,
        avgSpend3d: avg,
        yesterdaySpend: yesterday,
        range,
        low: remaining != null && total > 0 && remaining < yesterday && remaining < avg,
      };
    } catch (err) {
      return { id, error: err.message, low: false };
    }
  });

  // Never reused by the browser: the client decides when to refresh (Hard Refresh must really refetch).
  res.setHeader("Cache-Control", "private, no-store");
  res.status(200).json({ accounts: rows });
}
