import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import { graphGetAllPages } from "@/lib/facebookGraph";

const MAX_ACCOUNTS = 10;

// Meta's documented action_type for reading a saved custom conversion's
// count/value out of an Insights row's actions/action_values array — not
// verified against a live account in this environment (no Facebook account
// available this session), same caveat as this app's other unverified
// action-type strings (see lib/insightsMetrics.js's Hook Rate/Initiate
// Checkout comments). Spot-check against a real account before relying on
// this operationally.
function customConversionActionType(id) {
  return `offsite_conversion.custom.${id}`;
}

// Per-account discovery of Events-Manager "Custom Conversions" — formalized
// CAPI/pixel custom events, not in lib/insightsMetrics.js's static catalog
// since they're account-specific and unknown ahead of time. One connection
// per account (graphGetAllPages, same shape as /api/fb/targeting-data.js's
// pixel/Page lookups), not the batched `?ids=` shape used by
// pages/api/fb/explore-insights.js's fetchEntityStatuses/fetchEntityBudgets
// — this is a list-per-account, not a flat id lookup.
export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session?.accessToken) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  const accountIds = String(req.query.accountIds || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (accountIds.length === 0) {
    return res.status(400).json({ error: "At least one accountId is required" });
  }
  if (accountIds.length > MAX_ACCOUNTS) {
    return res.status(400).json({ error: `Cannot query more than ${MAX_ACCOUNTS} accounts at once (got ${accountIds.length})` });
  }

  const token = session.accessToken;
  const results = await Promise.allSettled(
    accountIds.map((accountId) => graphGetAllPages(`/${accountId}/customconversions`, token, { fields: "id,name,is_archived" }))
  );

  const customEvents = [];
  const errors = [];
  let firstFailure = null;
  results.forEach((result, i) => {
    const accountId = accountIds[i];
    if (result.status !== "fulfilled") {
      if (!firstFailure) firstFailure = result.reason;
      errors.push({ accountId, message: result.reason?.message || "Request failed" });
      return;
    }
    for (const cc of result.value.data || []) {
      if (cc.is_archived) continue;
      customEvents.push({
        id: `ccv:${accountId}:${cc.id}`,
        name: cc.name,
        accountId,
        actionType: customConversionActionType(cc.id),
      });
    }
  });

  // Soft-fail per account (one revoked/erroring account shouldn't block the
  // others), but a total failure is a real error, not a quiet empty list.
  if (errors.length === accountIds.length) {
    return res.status(firstFailure?.graphResponse ? 400 : 500).json({ error: firstFailure?.message || "Request failed" });
  }

  res.status(200).json({ customEvents, errors });
}
