import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";

const GRAPH_API_VERSION = "v21.0";

const PURCHASE_ACTION_TYPES = ["omni_purchase", "purchase", "offsite_conversion.fb_pixel_purchase"];

function pickPurchaseValue(entries) {
  if (!entries) return 0;
  const match = entries.find((entry) => PURCHASE_ACTION_TYPES.includes(entry.action_type));
  return match ? parseFloat(match.value) : 0;
}

function pickPurchaseCount(entries) {
  if (!entries) return 0;
  const match = entries.find((entry) => PURCHASE_ACTION_TYPES.includes(entry.action_type));
  return match ? parseFloat(match.value) : 0;
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

  const url =
    `https://graph.facebook.com/${GRAPH_API_VERSION}/${accountId}/insights` +
    `?fields=spend,impressions,clicks,ctr,action_values,purchase_roas,actions` +
    `&date_preset=last_30d` +
    `&access_token=${session.accessToken}`;

  try {
    const fbRes = await fetch(url);
    const json = await fbRes.json();

    if (json.error) {
      return res.status(400).json({ error: json.error.message });
    }

    const row = json.data?.[0];

    if (!row) {
      return res.status(200).json({
        spend: 0,
        revenue: 0,
        roas: 0,
        ctr: 0,
        conversions: 0,
        hasData: false,
      });
    }

    const spend = parseFloat(row.spend || 0);

    // Prefer Facebook's own purchase_roas field; fall back to deriving it
    // from action_values / spend if that field isn't populated.
    let roas = 0;
    let revenue = pickPurchaseValue(row.action_values);

    const fbRoasEntry = row.purchase_roas?.find((entry) =>
      PURCHASE_ACTION_TYPES.includes(entry.action_type)
    );

    if (fbRoasEntry) {
      roas = parseFloat(fbRoasEntry.value);
    } else if (spend > 0) {
      roas = revenue / spend;
    }

    // Facebook's "ctr" field is already a percentage (e.g. "1.23" = 1.23%)
    const ctr = parseFloat(row.ctr || 0);
    const conversions = pickPurchaseCount(row.actions);

    res.status(200).json({ spend, revenue, roas, ctr, conversions, hasData: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
