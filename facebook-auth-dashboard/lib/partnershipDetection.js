import { graphGetAllPages } from "./facebookGraph";

// Finds which of an ad account's existing ads are Partnership (branded
// content) ads — this is what lets "My Partnership Ads" show ads created
// manually in Ads Manager, not just ones launched through this app.
//
// The mechanism: facebook_branded_content / instagram_branded_content /
// branded_content are the exact params pages/api/fb/partnership/launch.js
// (and Meta's own Ads Manager, presumably) sets when creating a branded-
// content creative — see lib/partnershipAds.js's createBrandedCreative. Most
// Graph API object fields are readable back with the same name they're
// written with, so asking for them here should, in principle, surface every
// ad whose creative has them set, regardless of who created it. This has
// NOT been confirmed against a real account yet (the Python reference this
// app's other Partnership Ads calls are modeled on only ever writes these
// fields, never reads them back) — if they come back empty/absent here
// against a real creative that's known to be a partnership ad, that's a
// sign this detection mechanism doesn't work and a locally-tracked "ads
// created here" fallback is needed instead (same shape, same consumers,
// see this function's own return shape below so that swap stays contained).
export async function fetchPartnershipAds(token, adAccountId) {
  const result = await graphGetAllPages(`/${adAccountId}/ads`, token, {
    fields:
      "id,name,status,effective_status,adset{id,name},campaign{id,name}," +
      "creative{id,facebook_branded_content,instagram_branded_content,branded_content,effective_object_story_id,instagram_permalink_url}",
    limit: 500,
  });

  return (result.data || [])
    .filter((ad) => {
      const c = ad.creative;
      return !!c && (c.facebook_branded_content || c.instagram_branded_content || c.branded_content);
    })
    .map((ad) => ({
      adId: ad.id,
      name: ad.name,
      status: ad.effective_status || ad.status,
      campaignId: ad.campaign?.id || null,
      campaignName: ad.campaign?.name || null,
      adsetId: ad.adset?.id || null,
      adsetName: ad.adset?.name || null,
      creativeId: ad.creative?.id || null,
      instagramPermalinkUrl: ad.creative?.instagram_permalink_url || null,
    }));
}
