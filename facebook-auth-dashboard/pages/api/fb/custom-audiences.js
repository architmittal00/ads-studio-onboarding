import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import { graphGetAllPages } from "@/lib/facebookGraph";

// Lists an ad account's existing Custom Audiences (customer lists, website-
// visitor rules, lookalikes — Meta returns lookalikes as just another
// `subtype` here, so this one list backs the Launch tab's "Saved Audience"
// picker without a separate lookalike-specific endpoint) for the Launch
// tab's audience-inclusion picker. Searched client-side like campaigns-list.js
// and adsets-list.js — Meta exposes no live search for a user's own saved
// audiences, unlike interests/locations/languages. Distinct from
// lib/audienceManager.js, which only knows the 3 fixed-name audiences the
// Strategy flow auto-creates for itself, not a user's full audience list.
export default async function handler(req, res) {
  const session = await getServerSession(req, res, authOptions);
  if (!session?.accessToken) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  const { accountId } = req.query;
  if (!accountId) {
    return res.status(400).json({ error: "accountId is required" });
  }

  try {
    const json = await graphGetAllPages(`/${accountId}/customaudiences`, session.accessToken, {
      fields: "id,name,subtype,approximate_count_lower_bound,approximate_count_upper_bound",
      limit: 200,
    });
    // Per-user data that rarely changes: let the browser reuse it briefly (private, never shared).
    res.setHeader("Cache-Control", "private, max-age=60, stale-while-revalidate=300");
    res.status(200).json({ audiences: json.data || [] });
  } catch (err) {
    res.status(err.graphResponse ? 400 : 500).json({ error: err.message });
  }
}
