import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import { graphGetAllPages } from "@/lib/facebookGraph";

// Money state per ad account for the Raw Data tab, in a call of its own so a
// field Meta won't return for some account (or a missing permission) can
// never break the account list itself.
//  - balance / amount_spent / spend_cap: minor units (strings).
//  - funding_source_details.display_string: Meta's own wording of the payment
//    source, e.g. "Available balance (₹1,234.00)" for prepaid accounts, which
//    is where a prepaid account's remaining funds are reported.
const FULL_FIELDS = "id,currency,balance,amount_spent,spend_cap,funding_source_details{type,display_string}";
const BASIC_FIELDS = "id,currency,balance,amount_spent,spend_cap";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const session = await getServerSession(req, res, authOptions);
  if (!session?.accessToken) return res.status(401).json({ error: "Not authenticated" });

  async function load(fields) {
    return graphGetAllPages("/me/adaccounts", session.accessToken, { fields });
  }
  try {
    let result;
    try {
      result = await load(FULL_FIELDS);
    } catch {
      result = await load(BASIC_FIELDS);
    }
    const balances = {};
    for (const a of result.data || []) {
      const spendCap = a.spend_cap && a.spend_cap !== "0" ? parseFloat(a.spend_cap) / 100 : null;
      const spent = a.amount_spent ? parseFloat(a.amount_spent) / 100 : 0;
      balances[a.id] = {
        currency: a.currency || null,
        // What Meta says is owed/outstanding on a postpaid account.
        owed: a.balance != null ? parseFloat(a.balance) / 100 : null,
        fundingText: a.funding_source_details?.display_string || null,
        fundingType: a.funding_source_details?.type ?? null,
        spendCap,
        amountSpent: spent,
        spendCapRemaining: spendCap != null ? Math.max(spendCap - spent, 0) : null,
      };
    }
    res.setHeader("Cache-Control", "private, max-age=60");
    res.status(200).json({ balances });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
