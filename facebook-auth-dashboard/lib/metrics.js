export const PURCHASE_ACTION_TYPES = [
  "omni_purchase",
  "purchase",
  "offsite_conversion.fb_pixel_purchase",
];

export function pickPurchaseValue(entries) {
  if (!entries) return 0;
  const match = entries.find((entry) => PURCHASE_ACTION_TYPES.includes(entry.action_type));
  return match ? parseFloat(match.value) : 0;
}

export function pickPurchaseCount(entries) {
  if (!entries) return 0;
  const match = entries.find((entry) => PURCHASE_ACTION_TYPES.includes(entry.action_type));
  return match ? parseFloat(match.value) : 0;
}

// Derives spend/revenue/ROAS from a single Graph API insights row.
// Prefers Facebook's own purchase_roas field; falls back to revenue / spend.
export function roasFromRow(row) {
  const spend = parseFloat(row.spend || 0);
  const revenue = pickPurchaseValue(row.action_values);

  const fbRoasEntry = row.purchase_roas?.find((entry) =>
    PURCHASE_ACTION_TYPES.includes(entry.action_type)
  );

  const roas = fbRoasEntry ? parseFloat(fbRoasEntry.value) : spend > 0 ? revenue / spend : 0;

  return { spend, revenue, roas };
}
