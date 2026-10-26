// Shared (client + server) Meta Marketing API option maps.

export interface Option { key: string; label: string }

export const OBJECTIVES: Option[] = [
  { key: 'OUTCOME_SALES', label: 'Sales' },
  { key: 'OUTCOME_LEADS', label: 'Leads' },
  { key: 'OUTCOME_TRAFFIC', label: 'Traffic' },
  { key: 'OUTCOME_ENGAGEMENT', label: 'Engagement' },
  { key: 'OUTCOME_AWARENESS', label: 'Awareness' },
];

const LEGACY_OBJECTIVES: Record<string, string> = {
  CONVERSIONS: 'OUTCOME_SALES',
  PRODUCT_CATALOG_SALES: 'OUTCOME_SALES',
  LEAD_GENERATION: 'OUTCOME_LEADS',
  LINK_CLICKS: 'OUTCOME_TRAFFIC',
  POST_ENGAGEMENT: 'OUTCOME_ENGAGEMENT',
  VIDEO_VIEWS: 'OUTCOME_ENGAGEMENT',
  PAGE_LIKES: 'OUTCOME_ENGAGEMENT',
  REACH: 'OUTCOME_AWARENESS',
  BRAND_AWARENESS: 'OUTCOME_AWARENESS',
};

export function normalizeObjective(objective?: string): string {
  if (!objective) return 'OUTCOME_SALES';
  return LEGACY_OBJECTIVES[objective] || objective;
}

export function objectiveLabel(objective?: string): string {
  const key = normalizeObjective(objective);
  const found = OBJECTIVES.find((o) => o.key === key);
  if (found) return found.label;
  return (objective || '').replace('OUTCOME_', '').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}

export interface GoalDef {
  key: string;
  label: string;
  optimization: string;
  /** Needs a pixel + conversion event */
  pixel?: boolean;
  /** Conversion event forced by the goal (e.g. Value → Purchase) */
  fixedEvent?: string;
  destination?: string;
  /** attribution_spec is only valid for conversion goals */
  attribution?: boolean;
}

const CONVERSIONS: GoalDef = { key: 'CONVERSIONS', label: 'Maximize number of conversions', optimization: 'OFFSITE_CONVERSIONS', pixel: true, destination: 'WEBSITE', attribution: true };
const VALUE: GoalDef = { key: 'VALUE', label: 'Maximize value of conversions', optimization: 'VALUE', pixel: true, fixedEvent: 'PURCHASE', destination: 'WEBSITE', attribution: true };
const LANDING_PAGE_VIEWS: GoalDef = { key: 'LANDING_PAGE_VIEWS', label: 'Maximize number of landing page views', optimization: 'LANDING_PAGE_VIEWS', destination: 'WEBSITE' };
const LINK_CLICKS: GoalDef = { key: 'LINK_CLICKS', label: 'Maximize number of link clicks', optimization: 'LINK_CLICKS', destination: 'WEBSITE' };
const REACH: GoalDef = { key: 'REACH', label: 'Maximize daily unique reach', optimization: 'REACH' };
const IMPRESSIONS: GoalDef = { key: 'IMPRESSIONS', label: 'Maximize number of impressions', optimization: 'IMPRESSIONS' };
const POST_ENGAGEMENT: GoalDef = { key: 'POST_ENGAGEMENT', label: 'Maximize engagement with a post', optimization: 'POST_ENGAGEMENT', destination: 'ON_POST' };
const THRUPLAY: GoalDef = { key: 'THRUPLAY', label: 'Maximize ThruPlay views', optimization: 'THRUPLAY', destination: 'ON_VIDEO' };

const GOALS: Record<string, GoalDef[]> = {
  OUTCOME_SALES: [CONVERSIONS, VALUE, LANDING_PAGE_VIEWS, LINK_CLICKS],
  OUTCOME_LEADS: [CONVERSIONS, LANDING_PAGE_VIEWS, LINK_CLICKS],
  OUTCOME_TRAFFIC: [LANDING_PAGE_VIEWS, LINK_CLICKS, REACH, IMPRESSIONS],
  OUTCOME_ENGAGEMENT: [POST_ENGAGEMENT, THRUPLAY, CONVERSIONS],
  OUTCOME_AWARENESS: [REACH, IMPRESSIONS],
};

/** Catalog ad sets: products come from the catalog, the pixel comes from the catalog link. */
const CATALOG_GOALS: GoalDef[] = [
  { ...CONVERSIONS, destination: undefined },
  { ...VALUE, destination: undefined },
  { ...LINK_CLICKS, destination: undefined },
];

export function goalsFor(objective: string | undefined, catalog: boolean): GoalDef[] {
  if (catalog) return CATALOG_GOALS;
  return GOALS[normalizeObjective(objective)] || GOALS.OUTCOME_SALES;
}

export function goalDef(objective: string | undefined, catalog: boolean, key: string): GoalDef | undefined {
  return goalsFor(objective, catalog).find((g) => g.key === key);
}

export const CONVERSION_EVENTS: Option[] = [
  { key: 'PURCHASE', label: 'Purchase' },
  { key: 'ADD_TO_CART', label: 'Add to cart' },
  { key: 'INITIATED_CHECKOUT', label: 'Initiate checkout' },
  { key: 'ADD_PAYMENT_INFO', label: 'Add payment info' },
  { key: 'CONTENT_VIEW', label: 'View content' },
  { key: 'ADD_TO_WISHLIST', label: 'Add to wishlist' },
  { key: 'LEAD', label: 'Lead' },
  { key: 'COMPLETE_REGISTRATION', label: 'Complete registration' },
  { key: 'SEARCH', label: 'Search' },
];

export interface BidDef extends Option { needs?: 'bid' | 'roas'; valueOnly?: boolean }

export const BID_STRATEGIES: BidDef[] = [
  { key: 'LOWEST_COST_WITHOUT_CAP', label: 'Highest volume (recommended)' },
  { key: 'COST_CAP', label: 'Cost per result goal', needs: 'bid' },
  { key: 'LOWEST_COST_WITH_BID_CAP', label: 'Bid cap', needs: 'bid' },
  { key: 'LOWEST_COST_WITH_MIN_ROAS', label: 'ROAS goal', needs: 'roas', valueOnly: true },
];

export const ATTRIBUTION: (Option & { spec: { event_type: string; window_days: number }[] })[] = [
  { key: '7C1V', label: '7-day click or 1-day view', spec: [{ event_type: 'CLICK_THROUGH', window_days: 7 }, { event_type: 'VIEW_THROUGH', window_days: 1 }] },
  { key: '1C', label: '1-day click only', spec: [{ event_type: 'CLICK_THROUGH', window_days: 1 }] },
  { key: '7C', label: '7-day click only', spec: [{ event_type: 'CLICK_THROUGH', window_days: 7 }] },
  { key: '1C1V', label: '1-day click or 1-day view', spec: [{ event_type: 'CLICK_THROUGH', window_days: 1 }, { event_type: 'VIEW_THROUGH', window_days: 1 }] },
];

export const PLATFORMS: Option[] = [
  { key: 'facebook', label: 'Facebook' },
  { key: 'instagram', label: 'Instagram' },
  { key: 'messenger', label: 'Messenger' },
  { key: 'audience_network', label: 'Audience Network' },
];

export const CTAS: Option[] = [
  { key: 'SHOP_NOW', label: 'Shop now' },
  { key: 'BUY_NOW', label: 'Buy now' },
  { key: 'ORDER_NOW', label: 'Order now' },
  { key: 'GET_OFFER', label: 'Get offer' },
  { key: 'LEARN_MORE', label: 'Learn more' },
];

/** Meta's catalog retargeting presets (Ads Manager wording). */
export const RETARGET_PRESETS: Option[] = [
  { key: 'VIEWED_OR_ATC', label: 'Viewed or added to cart but not purchased' },
  { key: 'ATC', label: 'Added to cart but not purchased' },
  { key: 'UPSELL', label: 'Upsell products' },
  { key: 'CROSS_SELL', label: 'Cross-sell products' },
  { key: 'CUSTOM', label: 'Custom combination' },
];

/** Events usable in a custom combination. */
export const CATALOG_EVENTS: Option[] = [
  { key: 'ViewContent', label: 'Viewed' },
  { key: 'AddToCart', label: 'Added to cart' },
  { key: 'Purchase', label: 'Purchased' },
];

/** Resolve a retargeting preset into the events, exclusion and product set Meta's audience spec needs. */
export function catalogAudienceSpec(a: {
  retargetPreset: string; retargetEvents: string[]; retargetDays: number;
  excludePurchasers: boolean; excludeDays: number; productSetId: string; crossSellSourceSetId: string;
}): { events: string[]; exclude: boolean; excludeDays: number; sourceSetId: string } {
  switch (a.retargetPreset) {
    case 'VIEWED_OR_ATC': return { events: ['ViewContent', 'AddToCart'], exclude: true, excludeDays: a.retargetDays, sourceSetId: a.productSetId };
    case 'ATC': return { events: ['AddToCart'], exclude: true, excludeDays: a.retargetDays, sourceSetId: a.productSetId };
    // Upsell: viewed or added to cart in one set, shown products from the ad set's product set.
    case 'UPSELL': return { events: ['ViewContent', 'AddToCart'], exclude: false, excludeDays: 0, sourceSetId: a.crossSellSourceSetId };
    // Cross-sell: purchased from one set, shown products from the ad set's product set.
    case 'CROSS_SELL': return { events: ['Purchase'], exclude: false, excludeDays: 0, sourceSetId: a.crossSellSourceSetId };
    default: return { events: a.retargetEvents, exclude: a.excludePurchasers, excludeDays: a.excludeDays, sourceSetId: a.productSetId };
  }
}

/** Catalog text tokens Meta fills per product. */
export const PRODUCT_TOKENS: { token: string; label: string }[] = [
  { token: '{{product.name}}', label: 'Product name' },
  { token: '{{product.price}}', label: 'Price' },
  { token: '{{product.current_price}}', label: 'Current price' },
  { token: '{{product.brand}}', label: 'Brand' },
  { token: '{{product.description}}', label: 'Description' },
];

/** Ads Manager's "Build a URL parameter" fields. */
export const UTM_FIELDS: { key: 'source' | 'medium' | 'campaign' | 'content' | 'term'; param: string; label: string; placeholder: string }[] = [
  { key: 'source', param: 'utm_source', label: 'Campaign source', placeholder: 'e.g. facebook' },
  { key: 'medium', param: 'utm_medium', label: 'Campaign medium', placeholder: 'e.g. paid_social' },
  { key: 'campaign', param: 'utm_campaign', label: 'Campaign name', placeholder: 'e.g. {{campaign.name}}' },
  { key: 'content', param: 'utm_content', label: 'Campaign content', placeholder: 'e.g. {{ad.name}}' },
  { key: 'term', param: 'utm_term', label: 'Campaign term', placeholder: 'Optional' },
];

/** Meta dynamic URL parameters, filled per ad at delivery. */
export const URL_DYNAMIC_PARAMS = ['{{campaign.name}}', '{{campaign.id}}', '{{adset.name}}', '{{adset.id}}', '{{ad.name}}', '{{ad.id}}', '{{placement}}', '{{site_source_name}}'];

/** Build the url_tags string: values are URL-encoded, {{dynamic}} parameters kept as-is. */
export function buildUrlTags(u: Partial<Record<'source' | 'medium' | 'campaign' | 'content' | 'term', string>>): string {
  const enc = (v: string) => v.split(/(\{\{[^}]+\}\})/).map((part) => (/^\{\{[^}]+\}\}$/.test(part) ? part : encodeURIComponent(part))).join('');
  return UTM_FIELDS
    .filter((f) => (u[f.key] || '').trim())
    .map((f) => `${f.param}=${enc((u[f.key] || '').trim())}`)
    .join('&');
}

export const AGES = Array.from({ length: 48 }, (_, i) => i + 18); // 18..65

export const ZERO_DECIMAL_CURRENCIES = ['JPY', 'KRW', 'CLP', 'VND', 'ISK', 'HUF', 'TWD', 'IDR', 'COP', 'PYG', 'CRC'];

export function currencySymbol(currency?: string): string {
  const map: Record<string, string> = { INR: '₹', USD: '$', EUR: '€', GBP: '£', AED: 'AED ', SGD: 'S$', AUD: 'A$', CAD: 'C$' };
  return map[currency || 'INR'] ?? `${currency} `;
}

export function toMinorUnits(amount: string | number, currency?: string): number {
  const n = typeof amount === 'number' ? amount : parseFloat(amount);
  if (!isFinite(n)) return 0;
  return Math.round(ZERO_DECIMAL_CURRENCIES.includes(currency || '') ? n : n * 100);
}

export function fromMinorUnits(amount: string | number | undefined, currency?: string): string {
  if (amount === undefined || amount === null || amount === '') return '';
  const n = typeof amount === 'number' ? amount : parseFloat(amount);
  if (!isFinite(n)) return '';
  return String(ZERO_DECIMAL_CURRENCIES.includes(currency || '') ? n : n / 100);
}
