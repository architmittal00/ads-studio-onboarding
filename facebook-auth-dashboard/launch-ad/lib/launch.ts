import 'server-only';
import { ATTRIBUTION, BID_STRATEGIES, buildUrlTags, catalogAudienceSpec, goalDef, toMinorUnits } from './constants';
import { ALL_FB_POSITIONS, ALL_IG_POSITIONS } from './positions';
import { buildContext } from './form';
import { graph, GraphError } from './graph';
import type { FlowContext, FormState, LaunchRequest, LaunchResult } from './types';

/* eslint-disable @typescript-eslint/no-explicit-any */

const uniqueById = <T extends { id: string | number }>(list: T[]): T[] => list.filter((x, i) => list.findIndex((y) => String(y.id) === String(x.id)) === i);

/** Custom audiences, their exclusions and Advantage detailed targeting from the form. `merge` adds to a saved audience's own. */
function addAudienceOptions(t: any, a: FormState['adset'], merge: boolean) {
  const ids = (list: { id: string }[]) => list.map((x) => ({ id: x.id }));
  if (a.customAudiences.length) t.custom_audiences = uniqueById([...(merge ? t.custom_audiences || [] : []), ...ids(a.customAudiences)]);
  if (a.excludedAudiences.length) t.excluded_custom_audiences = uniqueById([...(merge ? t.excluded_custom_audiences || [] : []), ...ids(a.excludedAudiences)]);
  // Meta already applies it for the Value and Landing page views goals, and may reject it there.
  if (a.expandInterests && a.goal !== 'VALUE' && a.goal !== 'LANDING_PAGE_VIEWS') t.targeting_optimization = 'expansion_all';
}

function geo(form: FormState) {
  const g: any = {};
  const countries = form.adset.locations.filter((l) => l.type === 'country').map((l) => l.key);
  const regions = form.adset.locations.filter((l) => l.type === 'region').map((l) => ({ key: l.key }));
  const cities = form.adset.locations.filter((l) => l.type === 'city').map((l) => ({ key: l.key }));
  if (countries.length) g.countries = countries;
  if (regions.length) g.regions = regions;
  if (cities.length) g.cities = cities;
  return g;
}

export function buildTargeting(form: FormState, ctx: FlowContext, saved?: any): any {
  const a = form.adset;
  let t: any;

  if (ctx.isCatalog && a.catalogAudience !== 'BROAD') {
    const day = 86400;
    const ca = catalogAudienceSpec(a);
    const spec: any = {
      product_set_id: ca.sourceSetId,
      inclusions: ca.events.map((e) => ({ retention_seconds: a.retargetDays * day, rule: { event: { eq: e } } })),
    };
    if (ca.exclude) {
      spec.exclusions = [{ retention_seconds: ca.excludeDays * day, rule: { event: { eq: 'Purchase' } } }];
    }
    t = { geo_locations: geo(form), age_min: a.ageMin, age_max: a.ageMax, product_audience_specs: [spec], targeting_automation: { advantage_audience: 0 } };
    if (a.gender !== 'ALL') t.genders = [a.gender === 'MALE' ? 1 : 2];
    if (a.locales.length) t.locales = a.locales.map((l) => l.key);
  } else if (a.audienceType === 'SAVED' && saved) {
    t = { ...saved };
    if (!t.targeting_automation) t.targeting_automation = { advantage_audience: 0 };
    // What was added next to the saved audience joins it: custom audiences, and interests into its first detailed targeting group.
    addAudienceOptions(t, a, true);
    if (a.interests.length) {
      const groups = Array.isArray(t.flexible_spec) && t.flexible_spec.length ? t.flexible_spec.map((g: any) => ({ ...g })) : [{}];
      groups[0].interests = uniqueById([...(groups[0].interests || []), ...a.interests.map((i) => ({ id: i.id, name: i.name }))]);
      t.flexible_spec = groups;
    }
  } else {
    t = {};
    t.geo_locations = geo(form);
    t.age_min = a.ageMin;
    if (a.audienceType === 'ADVANTAGE') {
      // Advantage+ audience. Controls: location, minimum age, languages.
      // Audience suggestion (optional): age range, gender, detailed targeting.
      t.targeting_automation = { advantage_audience: 1 };
      if (a.ageMax < 65) t.age_range = [a.ageMin, a.ageMax];
      if (a.gender !== 'ALL') t.genders = [a.gender === 'MALE' ? 1 : 2];
      if (a.interests.length) t.flexible_spec = [{ interests: a.interests.map((i) => ({ id: i.id, name: i.name })) }];
      addAudienceOptions(t, a, false);
    } else {
      t.age_max = a.ageMax;
      if (a.gender !== 'ALL') t.genders = [a.gender === 'MALE' ? 1 : 2];
      if (a.audienceType === 'INTEREST') {
        if (a.interests.length) t.flexible_spec = [{ interests: a.interests.map((i) => ({ id: i.id, name: i.name })) }];
        t.targeting_automation = { advantage_audience: 0 };
        addAudienceOptions(t, a, false);
      }
    }
    if (a.locales.length) t.locales = a.locales.map((l) => l.key);
  }

  if (a.placement === 'MANUAL') {
    t.publisher_platforms = a.platforms;
    // Every position ticked = Meta's default of all of them, so nothing is sent.
    if (a.platforms.includes('facebook') && a.fbPositions.length && a.fbPositions.length < ALL_FB_POSITIONS.length) t.facebook_positions = a.fbPositions;
    if (a.platforms.includes('instagram') && a.igPositions.length && a.igPositions.length < ALL_IG_POSITIONS.length) t.instagram_positions = a.igPositions;
  }
  if (a.devices === 'MOBILE') {
    t.device_platforms = ['mobile'];
    if (a.os.length) t.user_os = a.os;
  } else if (a.devices === 'DESKTOP') {
    t.device_platforms = ['desktop'];
  }
  return t;
}

export function campaignParams(form: FormState, ctx: FlowContext, currency: string) {
  const c = form.campaign;
  const p: any = {
    name: c.name.trim(),
    objective: ctx.objective,
    status: 'PAUSED',
    special_ad_categories: [],
  };
  if (ctx.adsetBudget) {
    // Ad set budgets: Meta requires this flag on campaigns without a campaign budget.
    p.is_adset_budget_sharing_enabled = false;
  } else {
    // Advantage+ campaign budget
    p.bid_strategy = c.bidStrategy;
    const amount = toMinorUnits(form.budget.amount, currency);
    if (form.budget.type === 'DAILY') p.daily_budget = amount; else p.lifetime_budget = amount;
  }
  if (ctx.isCatalog) p.promoted_object = { product_catalog_id: c.catalogId };
  return p;
}

export function adsetParams(form: FormState, ctx: FlowContext, currency: string, campaignId: string, targeting: any) {
  const a = form.adset;
  const goal = goalDef(ctx.objective, ctx.isCatalog, a.goal);
  if (!goal) throw new GraphError({ message: `Performance goal "${a.goal}" isn't available for this campaign objective.` });
  const p: any = {
    name: a.name.trim(),
    campaign_id: campaignId,
    status: 'PAUSED',
    billing_event: 'IMPRESSIONS',
    optimization_goal: goal.optimization,
    targeting,
    start_time: a.startTime ? new Date(a.startTime).toISOString() : new Date(Date.now() + 60_000).toISOString(),
  };

  if (ctx.isCatalog) {
    p.promoted_object = { product_set_id: a.productSetId };
    if (goal.optimization !== 'LINK_CLICKS') p.promoted_object.custom_event_type = goal.fixedEvent || a.event || 'PURCHASE';
  } else if (goal.pixel) {
    p.promoted_object = { pixel_id: a.pixelId, custom_event_type: goal.fixedEvent || a.event };
  }
  // Catalog ad sets send people to the website explicitly; left empty, Meta may default to the app.
  if (ctx.isCatalog) p.destination_type = 'WEBSITE';
  else if (goal.destination) p.destination_type = goal.destination;
  if (goal.attribution) p.attribution_spec = (ATTRIBUTION.find((x) => x.key === a.attribution) || ATTRIBUTION[0]).spec;

  if (ctx.adsetBudget) {
    const amount = toMinorUnits(form.budget.amount, currency);
    if (form.budget.type === 'DAILY') p.daily_budget = amount; else p.lifetime_budget = amount;
    p.bid_strategy = ctx.needsCampaign ? form.campaign.bidStrategy : 'LOWEST_COST_WITHOUT_CAP';
  }
  if (form.budget.endDate) p.end_time = new Date(form.budget.endDate).toISOString();

  if (ctx.needsCampaign) {
    const bid = BID_STRATEGIES.find((b) => b.key === form.campaign.bidStrategy);
    if (bid?.needs === 'bid') p.bid_amount = toMinorUnits(form.campaign.bidAmount, currency);
    if (bid?.needs === 'roas') p.bid_constraints = { roas_average_floor: Math.round(parseFloat(form.campaign.roasFloor) * 10000) };
  }
  return p;
}

export function creativeParams(form: FormState) {
  const ad = form.ad;
  const template: any = {
    message: ad.message,
    name: ad.headline,
    description: ad.description || undefined,
    link: ad.link.trim(),
    call_to_action: { type: ad.cta },
  };
  if (ad.format === 'SINGLE') template.force_single_link = true;
  else template.multi_share_end_card = ad.endCard;
  // Multiple images per product, animated inside each carousel card.
  if (ad.format === 'CAROUSEL' && ad.media === 'SLIDESHOW') template.format_option = 'carousel_slideshows';
  const story: any = { page_id: ad.pageId, template_data: template };
  if (ad.instagramUserId) story.instagram_user_id = ad.instagramUserId;
  const urlTags = buildUrlTags(ad.urlTags || {});
  return {
    name: `${ad.name.trim() || form.adset.name.trim()} - Catalog creative`,
    product_set_id: form.adset.productSetId,
    object_story_spec: story,
    // Destination: website only, or the app via the catalog's deep links with the website as backup.
    applink_treatment: ad.destination === 'APP_WEB' ? 'deeplink_with_web_fallback' : 'web_only',
    ...(urlTags ? { url_tags: urlTags } : {}),
    // Show product videos from the catalog where products have them.
    ...(ad.media === 'VIDEO' ? { degrees_of_freedom_spec: { creative_features_spec: { media_type_automation: { enroll_status: 'OPT_IN' } } } } : {}),
  };
}

/** Normal (non-catalog) ad creative: uploaded image, or an existing Facebook / Instagram post. */
export function standardCreativeParams(form: FormState) {
  const ad = form.ad;
  const urlTags = buildUrlTags(ad.urlTags || {});
  const name = `${ad.name.trim() || form.adset.name.trim()} - Creative`;
  if (ad.kind === 'POST' && ad.postSource === 'FACEBOOK') {
    return { name, object_story_id: ad.postId, ...(urlTags ? { url_tags: urlTags } : {}) };
  }
  if (ad.kind === 'POST') {
    return {
      name,
      object_id: ad.pageId,
      instagram_user_id: ad.instagramUserId,
      source_instagram_media_id: ad.postId,
      ...(urlTags ? { url_tags: urlTags } : {}),
    };
  }
  if (ad.videoId) {
    // Video ad: Meta needs a thumbnail (taken from a frame of the video and uploaded as an image).
    const video: any = {
      video_id: ad.videoId,
      image_hash: ad.imageHash,
      message: ad.message,
      call_to_action: { type: ad.cta, value: { link: ad.link.trim() } },
    };
    if (ad.headline.trim()) video.title = ad.headline;
    if (ad.description.trim()) video.link_description = ad.description;
    const story: any = { page_id: ad.pageId, video_data: video };
    if (ad.instagramUserId) story.instagram_user_id = ad.instagramUserId;
    return { name, object_story_spec: story, ...(urlTags ? { url_tags: urlTags } : {}) };
  }
  const link: any = {
    image_hash: ad.imageHash,
    link: ad.link.trim(),
    message: ad.message,
    call_to_action: { type: ad.cta, value: { link: ad.link.trim() } },
  };
  if (ad.headline.trim()) link.name = ad.headline;
  if (ad.description.trim()) link.description = ad.description;
  const story: any = { page_id: ad.pageId, link_data: link };
  if (ad.instagramUserId) story.instagram_user_id = ad.instagramUserId;
  return { name, object_story_spec: story, ...(urlTags ? { url_tags: urlTags } : {}) };
}

/** Ad-level website-event tracking (Ads Manager: Tracking → Website events) for the dataset (pixel). */
function tracking(pixelId?: string) {
  return pixelId ? { tracking_specs: [{ 'action.type': ['offsite_conversion'], fb_pixel: [pixelId] }] } : {};
}

export async function launch(req: LaunchRequest, token: string): Promise<LaunchResult> {
  const { accountId, currency, mode, form } = req;
  const act = accountId.startsWith('act_') ? accountId : `act_${accountId}`;
  const ctx = buildContext(mode, form, req.existingCampaign);
  const result: LaunchResult = { ok: false, created: { ads: [] }, activated: false };
  let step = 'campaign';

  // Reverse journey: add the ad built first to an existing ad set.
  if (mode === 'AD_ONLY') {
    try {
      const target = req.targetAdset;
      if (!target) throw new GraphError({ message: 'No ad set selected.' });
      const targetSet = target.promoted_object?.product_set_id;
      const isCatalogAd = form.ad.kind === 'CATALOG';
      step = 'creative';
      // Catalog ad: the ad set's product set if it has one, else the product set chosen for the ad.
      const params = isCatalogAd
        ? creativeParams({ ...form, adset: { ...form.adset, productSetId: targetSet || form.adset.productSetId } })
        : standardCreativeParams(form);
      const creative = await graph.post<{ id: string }>(`${act}/adcreatives`, token, params);
      result.created.creative = { id: creative.id };
      step = 'ad';
      const adName = form.ad.name.trim() || `${target.name} - ${isCatalogAd ? 'Catalog ad' : 'Ad'}`;
      const ad = await graph.post<{ id: string }>(`${act}/ads`, token, { name: adName, adset_id: target.id, creative: { creative_id: creative.id }, status: 'PAUSED', ...tracking(form.adset.pixelId || target.promoted_object?.pixel_id) });
      result.created.ads.push({ id: ad.id, name: adName });
      result.created.adset = { id: target.id, name: target.name };
      if (req.status === 'ACTIVE') {
        step = 'activate';
        await graph.post(ad.id, token, { status: 'ACTIVE' });
        result.activated = true;
      }
      result.ok = true;
    } catch (e) {
      result.step = step;
      result.error = e instanceof GraphError ? e.meta : { message: (e as Error).message };
    }
    return result;
  }

  try {
    // 1. Campaign (always created paused; activated at the end so nothing spends on a half-built launch)
    let campaignId = req.existingCampaign?.id || '';
    if (ctx.needsCampaign) {
      const res = await graph.post<{ id: string }>(`${act}/campaigns`, token, campaignParams(form, ctx, currency));
      campaignId = res.id;
      result.created.campaign = { id: res.id, name: form.campaign.name.trim() };
    }
    if (!campaignId) throw new GraphError({ message: 'No campaign selected.' });

    // 2. Ad set
    step = 'adset';
    let saved: any;
    const usesAudience = !ctx.isCatalog || form.adset.catalogAudience === 'BROAD';
    if (usesAudience && form.adset.audienceType === 'SAVED') {
      const s = await graph.get<{ targeting: any }>(form.adset.savedAudienceId, token, { fields: 'targeting' });
      saved = s.targeting;
    }
    const targeting = buildTargeting(form, ctx, saved);
    const adset = await graph.post<{ id: string }>(`${act}/adsets`, token, adsetParams(form, ctx, currency, campaignId, targeting));
    result.created.adset = { id: adset.id, name: form.adset.name.trim() };

    // 3. The ad: a catalog template, or a normal ad from an uploaded image / video or an existing post
    if (ctx.needsAd || ctx.needsStandardAd) {
      step = 'creative';
      const creative = await graph.post<{ id: string }>(`${act}/adcreatives`, token, ctx.needsAd ? creativeParams(form) : standardCreativeParams(form));
      result.created.creative = { id: creative.id };
      step = 'ad';
      const adName = form.ad.name.trim() || `${form.adset.name.trim()} - ${ctx.needsAd ? 'Catalog ad' : 'Ad'}`;
      const ad = await graph.post<{ id: string }>(`${act}/ads`, token, {
        name: adName,
        adset_id: adset.id,
        creative: { creative_id: creative.id },
        status: 'PAUSED',
        ...tracking(form.adset.pixelId),
      });
      result.created.ads.push({ id: ad.id, name: adName });
    }

    // 4. Activate everything we created
    if (req.status === 'ACTIVE') {
      step = 'activate';
      if (result.created.campaign) await graph.post(result.created.campaign.id, token, { status: 'ACTIVE' });
      await graph.post(adset.id, token, { status: 'ACTIVE' });
      for (const ad of result.created.ads) if (ad.id) await graph.post(ad.id, token, { status: 'ACTIVE' });
      result.activated = true;
    }

    result.ok = true;
    return result;
  } catch (e) {
    result.step = step;
    result.error = e instanceof GraphError ? e.meta : { message: (e as Error).message };
    return result;
  }
}
