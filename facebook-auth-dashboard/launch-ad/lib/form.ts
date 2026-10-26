import { normalizeObjective } from './constants';
import { ALL_FB_POSITIONS, ALL_IG_POSITIONS } from './positions';
import type { CampaignLite, FlowContext, FormState, GeoItem, Mode } from './types';

/** Default text for catalog ads; Meta fills the {{product.*}} tokens per product. Normal ads start empty. */
export const CATALOG_AD_TEXT = {
  message: 'Still thinking about it? {{product.name}} is waiting for you.',
  headline: '{{product.name}}',
  description: '{{product.current_price}}',
};

export const INDIA: GeoItem = { key: 'IN', name: 'India', type: 'country', country_code: 'IN' };

export function defaultForm(catalog = false): FormState {
  return {
    campaign: {
      name: '',
      objective: 'OUTCOME_SALES',
      setup: 'MANUAL',
      bidStrategy: 'LOWEST_COST_WITHOUT_CAP',
      bidAmount: '',
      roasFloor: '',
      catalogEnabled: catalog,
      catalogId: '',
    },
    budget: { level: 'CAMPAIGN', type: 'DAILY', amount: '', endDate: '' },
    adset: {
      name: '',
      goal: 'CONVERSIONS',
      event: 'PURCHASE',
      pixelId: '',
      audienceType: 'ADVANTAGE',
      interests: [],
      savedAudienceId: '',
      locations: [INDIA],
      ageMin: 18,
      ageMax: 65,
      gender: 'ALL',
      locales: [],
      customAudiences: [],
      excludedAudiences: [],
      expandInterests: false,
      placement: 'ADVANTAGE',
      platforms: ['facebook', 'instagram'],
      fbPositions: ALL_FB_POSITIONS,
      igPositions: ALL_IG_POSITIONS,
      devices: 'ALL',
      os: [],
      attribution: '7C1V',
      startTime: '',
      productSetId: '',
      catalogAudience: 'RETARGET',
      retargetPreset: 'VIEWED_OR_ATC',
      retargetEvents: ['ViewContent', 'AddToCart'],
      retargetDays: 14,
      excludePurchasers: true,
      excludeDays: 14,
      crossSellSourceSetId: '',
    },
    ad: {
      kind: catalog ? 'CATALOG' : 'UPLOAD',
      adFirst: false,
      imageHash: '',
      imageUrl: '',
      imageName: '',
      videoId: '',
      videoStatus: '',
      videoUrl: '',
      postSource: 'FACEBOOK',
      postId: '',
      postPreview: '',
      postMedia: [],
      name: '',
      pageId: '',
      instagramUserId: '',
      format: 'CAROUSEL',
      media: 'IMAGES',
      destination: 'WEBSITE',
      message: catalog ? CATALOG_AD_TEXT.message : '',
      headline: catalog ? CATALOG_AD_TEXT.headline : '',
      description: catalog ? CATALOG_AD_TEXT.description : '',
      cta: 'SHOP_NOW',
      link: '',
      endCard: true,
      urlTags: { source: 'facebook', medium: 'paid_social', campaign: '{{campaign.name}}', content: '{{ad.name}}', term: '' },
    },
  };
}

/** Start with an Ad: an empty ad, or a catalog ad with its catalog and product set already chosen. */
export function adFirstForm(catalog?: { catalogId: string; productSetId: string }): FormState {
  const f = defaultForm(!!catalog);
  return {
    ...f,
    campaign: catalog ? { ...f.campaign, catalogEnabled: true, catalogId: catalog.catalogId, objective: 'OUTCOME_SALES' } : f.campaign,
    adset: catalog ? { ...f.adset, productSetId: catalog.productSetId } : f.adset,
    ad: { ...f.ad, adFirst: true },
  };
}

/** After switching ad account: clear what belongs to the old account, keep the rest of the ad. */
export function clearAccountBound(f: FormState): FormState {
  return {
    ...f,
    campaign: { ...f.campaign, catalogId: '' },
    adset: { ...f.adset, productSetId: '', crossSellSourceSetId: '', pixelId: '', savedAudienceId: '', customAudiences: [], excludedAudiences: [], audienceType: f.adset.audienceType === 'SAVED' ? 'ADVANTAGE' : f.adset.audienceType },
    ad: { ...f.ad, imageHash: '', imageUrl: '', imageName: '', videoId: '', videoStatus: '', videoUrl: '' },
  };
}

/** The same ad again for another ad set: keep the ad, its catalog, product set and pixel; fresh campaign and ad set settings. */
export function repeatForm(prev: FormState): FormState {
  const f = adFirstForm();
  return {
    ...f,
    campaign: { ...f.campaign, catalogEnabled: prev.campaign.catalogEnabled, catalogId: prev.campaign.catalogId, objective: prev.campaign.catalogEnabled ? 'OUTCOME_SALES' : f.campaign.objective },
    adset: { ...f.adset, productSetId: prev.adset.productSetId, pixelId: prev.adset.pixelId },
    ad: { ...prev.ad, adFirst: true },
  };
}

export function buildContext(mode: Mode, form: FormState, campaign?: CampaignLite): FlowContext {
  const needsCampaign = mode === 'NEW';
  const objective = needsCampaign ? form.campaign.objective : normalizeObjective(campaign?.objective);
  const existingCatalog = campaign?.promoted_object?.product_catalog_id || '';
  const isCatalog = needsCampaign
    ? form.campaign.catalogEnabled && objective === 'OUTCOME_SALES'
    : !!existingCatalog;
  const catalogId = needsCampaign ? form.campaign.catalogId : existingCatalog;
  const campaignHasBudget = !needsCampaign && !!(campaign?.daily_budget || campaign?.lifetime_budget);
  const adsetBudget = needsCampaign ? form.budget.level === 'ADSET' : !campaignHasBudget;
  // Meta allows a catalog ad in a Sales campaign without a catalog: the ad carries its own product set.
  const adLevelCatalog = !isCatalog && form.ad.kind === 'CATALOG' && objective === 'OUTCOME_SALES';
  return {
    mode,
    needsCampaign,
    objective,
    isCatalog,
    catalogId,
    adsetBudget,
    campaignHasBudget,
    showBudget: needsCampaign || adsetBudget,
    needsAd: isCatalog || adLevelCatalog,
    adLevelCatalog,
    needsStandardAd: !isCatalog && (form.ad.kind === 'UPLOAD' || form.ad.kind === 'POST'),
  };
}

export interface Missing { key: string; label: string }

/** Everything required before Review & Launch is enabled. */
export function validate(form: FormState, ctx: FlowContext, opts: { goalNeedsPixel: boolean; bidNeeds?: 'bid' | 'roas'; catalogReady: boolean }): Missing[] {
  const m: Missing[] = [];
  const c = form.campaign;
  const a = form.adset;
  if (ctx.needsCampaign) {
    if (!c.name.trim()) m.push({ key: 'campaign.name', label: 'Campaign name' });
    if (ctx.isCatalog && !c.catalogId) m.push({ key: 'campaign.catalogId', label: 'Catalog' });
    if (opts.bidNeeds === 'bid' && !(parseFloat(c.bidAmount) > 0)) m.push({ key: 'campaign.bidAmount', label: 'Bid amount' });
    if (opts.bidNeeds === 'roas' && !(parseFloat(c.roasFloor) > 0)) m.push({ key: 'campaign.roasFloor', label: 'ROAS goal' });
  }
  if (ctx.needsCampaign && c.setup === 'ADVANTAGE_PLUS' && form.budget.level === 'ADSET' && form.budget.amount) {
    m.push({ key: 'budget.level', label: 'Campaign budget (Advantage+ Shopping needs one)' });
  }
  if (ctx.showBudget) {
    if (!(parseFloat(form.budget.amount) > 0)) m.push({ key: 'budget.amount', label: ctx.needsCampaign && form.budget.level === 'CAMPAIGN' ? 'Campaign budget' : 'Ad set budget' });
    if (form.budget.type === 'LIFETIME' && !form.budget.endDate) m.push({ key: 'budget.endDate', label: 'End date (lifetime budgets need one)' });
  }
  // Schedule
  const start = a.startTime ? new Date(a.startTime).getTime() : Date.now();
  if (form.budget.endDate) {
    const end = new Date(form.budget.endDate).getTime();
    if (end < Math.max(start, Date.now()) + 3600_000) m.push({ key: 'budget.endDate', label: 'End date at least 1 hour after the start' });
  }
  if (!a.name.trim()) m.push({ key: 'adset.name', label: 'Ad set name' });
  if (ctx.isCatalog) {
    if (!a.productSetId) m.push({ key: 'adset.productSetId', label: 'Product set' });
    if (!a.pixelId) m.push({ key: 'adset.pixelId', label: 'Dataset' });
    if (a.catalogAudience === 'RETARGET' && a.retargetPreset === 'CUSTOM' && !a.retargetEvents.length) m.push({ key: 'adset.retargetEvents', label: 'At least one event to include' });
    if (a.catalogAudience === 'RETARGET' && (a.retargetPreset === 'UPSELL' || a.retargetPreset === 'CROSS_SELL') && !a.crossSellSourceSetId) m.push({ key: 'adset.crossSellSourceSetId', label: 'Product set people interacted with' });
    if (!opts.catalogReady) m.push({ key: 'catalog.ready', label: 'Catalog readiness checks' });
  } else if (opts.goalNeedsPixel) {
    if (!a.pixelId) m.push({ key: 'adset.pixelId', label: 'Dataset' });
  }
  const usesAudience = !ctx.isCatalog || a.catalogAudience === 'BROAD';
  if (usesAudience && a.audienceType === 'SAVED' && !a.savedAudienceId) m.push({ key: 'adset.savedAudienceId', label: 'Saved audience' });
  if (!(usesAudience && a.audienceType === 'SAVED') && !a.locations.length) m.push({ key: 'adset.locations', label: 'Location' });
  if (a.ageMin > a.ageMax) m.push({ key: 'adset.age', label: 'Min age below max age' });
  if (a.placement === 'MANUAL' && !a.platforms.length) m.push({ key: 'adset.platforms', label: 'At least one placement' });
  if (a.placement === 'MANUAL') m.push(...validatePositions(a));
  if (ctx.needsAd) m.push(...validateAd(form, true, ctx.adLevelCatalog));
  if (ctx.needsStandardAd) m.push(...validateAd(form, false));
  return m;
}

/** Manual placements: every ticked platform needs a position, and Meta's own rules about Stories. */
export function validatePositions(a: FormState['adset']): Missing[] {
  const m: Missing[] = [];
  const fb = a.platforms.includes('facebook');
  const ig = a.platforms.includes('instagram');
  if (fb && !a.fbPositions.length) m.push({ key: 'adset.fbPositions', label: 'Facebook placements (pick at least one)' });
  if (ig && !a.igPositions.length) m.push({ key: 'adset.igPositions', label: 'Instagram placements (pick at least one)' });
  // Only an explicit pick matters: all ticked sends nothing and Meta chooses.
  const fbPicked = fb && a.fbPositions.length < ALL_FB_POSITIONS.length;
  const igPicked = ig && a.igPositions.length < ALL_IG_POSITIONS.length;
  const fbStory = fbPicked && a.fbPositions.includes('story');
  if (fbStory && !(a.fbPositions.includes('feed') || (ig && a.igPositions.includes('story')))) m.push({ key: 'adset.fbPositions', label: 'Facebook placements (Stories needs Facebook Feed or Instagram Stories)' });
  if (a.devices === 'DESKTOP' && (fbStory || (igPicked && a.igPositions.includes('story')))) m.push({ key: 'adset.devices', label: 'Devices (Stories are mobile only)' });
  return m;
}

/** What a catalog or normal ad still needs. `withCatalog` also checks catalog + product set (reverse journey). */
export function validateAd(form: FormState, isCatalog: boolean, withCatalog = false): Missing[] {
  const m: Missing[] = [];
  const ad = form.ad;
  // Every ad the launcher creates is named by the person, as campaigns and ad sets are.
  if (!ad.name.trim()) m.push({ key: 'ad.name', label: 'Ad name' });
  const validUrl = /^https?:\/\/\S+\.\S+/.test(ad.link.trim());
  if (isCatalog) {
    if (withCatalog && !form.campaign.catalogId) m.push({ key: 'campaign.catalogId', label: 'Catalog' });
    if (withCatalog && !form.adset.productSetId) m.push({ key: 'adset.productSetId', label: 'Product set' });
    if (!ad.pageId) m.push({ key: 'ad.pageId', label: 'Facebook Page' });
    if (!ad.message.trim()) m.push({ key: 'ad.message', label: 'Primary text' });
    if (!ad.headline.trim()) m.push({ key: 'ad.headline', label: 'Headline' });
    if (!validUrl) m.push({ key: 'ad.link', label: 'See more URL' });
    return m;
  }
  if (!ad.pageId) m.push({ key: 'ad.pageId', label: 'Facebook Page' });
  if (ad.kind === 'UPLOAD') {
    if (ad.videoId || ad.videoStatus) {
      if (ad.videoStatus === 'uploading') m.push({ key: 'ad.video', label: 'Video still uploading' });
      else if (ad.videoStatus === 'processing') m.push({ key: 'ad.video', label: 'Video still processing on Meta' });
      else if (ad.videoStatus === 'error') m.push({ key: 'ad.video', label: 'Video failed on Meta: upload another' });
      if (!ad.imageHash) m.push({ key: 'ad.imageHash', label: 'Video thumbnail' });
    } else if (!ad.imageHash) m.push({ key: 'ad.imageHash', label: 'Image or video' });
    if (!ad.message.trim()) m.push({ key: 'ad.message', label: 'Primary text' });
    if (!validUrl) m.push({ key: 'ad.link', label: 'Website URL' });
  }
  if (ad.kind === 'POST' && !ad.postId) m.push({ key: 'ad.postId', label: 'Post' });
  return m;
}
