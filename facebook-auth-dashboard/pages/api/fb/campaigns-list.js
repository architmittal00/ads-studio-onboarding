import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import { graphGetAllPages } from "@/lib/facebookGraph";

// Lists an ad account's campaigns for the Launch tab's "existing campaign"
// picker (searched client-side — Meta exposes no live "search my campaigns"
// endpoint, unlike interests/locations/languages). `objective` is returned
// so the ad set form can constrain/default its Performance Goal options to
// whatever's actually compatible with the chosen campaign.
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
    const json = await graphGetAllPages(`/${accountId}/campaigns`, session.accessToken, {
      fields: "id,name,effective_status,objective,daily_budget,lifetime_budget",
      limit: 200,
    });
    res.status(200).json({ campaigns: json.data || [] });
  } catch (err) {
    res.status(err.graphResponse ? 400 : 500).json({ error: err.message });
  }
}
