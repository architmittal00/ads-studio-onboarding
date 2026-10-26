/** Where the ad goes: NEW = a new campaign with its first ad set, EXISTING = a new ad set in an existing campaign, AD_ONLY = an existing ad set */
export type Mode = 'NEW' | 'EXISTING' | 'AD_ONLY';

export interface GeoItem { key: string; name: string; type: string; country_code?: string }
export interface LocaleItem { key: number; name: string }
export interface InterestItem { id: string; name: string }
/** A custom audience or lookalike of the ad account */
export interface AudienceItem { id: string; name: string; subtype?: string }

export interface AdAccount { id: string; account_id: string; name: string; currency: string; account_status?: number; business?: { id: string; name: string } }

export interface CampaignLite {
  id: string;
  name: string;
  objective: string;
  status?: string;
  effective_status?: string;
  daily_budget?: string;
  lifetime_budget?: string;
  bid_strategy?: string;
  promoted_object?: { product_catalog_id?: string };
  adsets?: { summary?: { total_count?: number } };
  updated_time?: string;
  /** Last 7 days */
  insights?: { data?: Insight[] };
}

/** Meta insights row (last 7 days): spend is in currency units, not minor units. */
export interface Insight { spend?: string; actions?: { action_type: string; value: string }[]; purchase_roas?: { action_type: string; value: string }[] }

export interface AdsetLite {
  id: string;
  name: string;
  status?: string;
  effective_status?: string;
  campaign?: CampaignLite;
  optimization_goal?: string;
  billing_event?: string;
  destination_type?: string;
  promoted_object?: { pixel_id?: string; custom_event_type?: string; product_set_id?: string; product_catalog_id?: string };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  targeting?: any;
  attribution_spec?: { event_type: string; window_days: number }[];
  daily_budget?: string;
  lifetime_budget?: string;
  bid_strategy?: string;
  bid_amount?: number;
  start_time?: string;
  end_time?: string;
  updated_time?: string;
  insights?: { data?: Insight[] };
  ads?: { summary?: { total_count?: number } };
}

export interface FormState {
  campaign: {
    name: string;
    objective: string;
    setup: 'MANUAL' | 'ADVANTAGE_PLUS';
    bidStrategy: string;
    bidAmount: string;
    roasFloor: string;
    catalogEnabled: boolean;
    catalogId: string;
  };
  /** level = where the budget lives; entering an amount at one level disables the other */
  budget: { level: 'CAMPAIGN' | 'ADSET'; type: 'DAILY' | 'LIFETIME'; amount: string; endDate: string };
  adset: {
    name: string;
    goal: string;
    event: string;
    pixelId: string;
    audienceType: 'ADVANTAGE' | 'INTEREST' | 'SAVED';
    interests: InterestItem[];
    savedAudienceId: string;
    locations: GeoItem[];
    ageMin: number;
    ageMax: number;
    gender: 'ALL' | 'MALE' | 'FEMALE';
    locales: LocaleItem[];
    /** Custom audiences and lookalikes to include / exclude (they belong to the ad account) */
    customAudiences: AudienceItem[];
    excludedAudiences: AudienceItem[];
    /** Advantage detailed targeting: Meta may go beyond the chosen interests when it expects better results */
    expandInterests: boolean;
    placement: 'ADVANTAGE' | 'MANUAL';
    platforms: string[];
    /** Manual placements: the positions ticked for Facebook and Instagram (all ticked = Meta's default, nothing is sent) */
    fbPositions: string[];
    igPositions: string[];
    devices: 'ALL' | 'MOBILE' | 'DESKTOP';
    os: ('iOS' | 'Android')[];
    attribution: string;
    /** Schedule: empty = start as soon as published (datetime-local value) */
    startTime: string;
    // catalog only
    productSetId: string;
    catalogAudience: 'RETARGET' | 'BROAD';
    /** Meta's retargeting presets; UPSELL / CROSS_SELL target people from crossSellSourceSetId */
    retargetPreset: 'VIEWED_OR_ATC' | 'ATC' | 'UPSELL' | 'CROSS_SELL' | 'CUSTOM';
    retargetEvents: string[];
    retargetDays: number;
    excludePurchasers: boolean;
    excludeDays: number;
    crossSellSourceSetId: string;
  };
  ad: {
    /** CATALOG = catalog template ad; UPLOAD = new ad from an uploaded image or video; POST = existing FB/IG post */
    kind: 'CATALOG' | 'UPLOAD' | 'POST';
    /** The ad is built before choosing where it goes (always true: every flow starts with the ad) */
    adFirst: boolean;
    imageHash: string;
    imageUrl: string;
    imageName: string;
    /** Uploaded video (image/video ad): its Meta id, processing status and a local preview URL; imageHash is its thumbnail */
    videoId: string;
    videoStatus: '' | 'uploading' | 'processing' | 'ready' | 'error';
    videoUrl: string;
    postSource: 'FACEBOOK' | 'INSTAGRAM';
    postId: string;
    postPreview: string;
    /** The chosen post's media, for a playable preview (videos, carousel items) */
    postMedia: PostMedia[];
    name: string;
    pageId: string;
    instagramUserId: string;
    format: 'CAROUSEL' | 'SINGLE';
    /** Meta catalog media: product images, multi-image slideshow per card, or product video when available */
    media: 'IMAGES' | 'SLIDESHOW' | 'VIDEO';
    /** Catalog ads: website only, or open the app via the catalog's deep links with the website as backup */
    destination: 'WEBSITE' | 'APP_WEB';
    message: string;
    headline: string;
    description: string;
    cta: string;
    link: string;
    endCard: boolean;
    /** URL parameters (UTM) appended to every product link */
    urlTags: UrlTags;
  };
}

export interface PostMedia { type: 'image' | 'video'; url: string; poster?: string }

export interface UrlTags { source: string; medium: string; campaign: string; content: string; term: string }

/** What the current screen is building. Derived from mode + chosen campaign. */
export interface FlowContext {
  mode: Mode;
  needsCampaign: boolean;
  objective: string;
  isCatalog: boolean;
  catalogId: string;
  /** Budget lives on the ad set (new campaign with ad set budget, or existing campaign without one) */
  adsetBudget: boolean;
  /** Existing campaign already has a campaign budget */
  campaignHasBudget: boolean;
  showBudget: boolean;
  /** A catalog template ad will be created */
  needsAd: boolean;
  /** Catalog ad inside a campaign without a catalog (ad-level catalog and product set) */
  adLevelCatalog: boolean;
  /** A normal (non-catalog) ad will be created: uploaded image or existing post */
  needsStandardAd: boolean;
}

export interface LaunchRequest {
  accountId: string;
  currency: string;
  mode: Mode;
  status: 'PAUSED' | 'ACTIVE';
  form: FormState;
  existingCampaign?: CampaignLite;
  /** AD_ONLY: the existing ad set the ad is added to */
  targetAdset?: AdsetLite;
}

export interface LaunchResult {
  ok: boolean;
  created: { campaign?: { id: string; name: string }; adset?: { id: string; name: string }; creative?: { id: string }; ads: { id: string; name: string }[] };
  activated: boolean;
  error?: MetaError;
  step?: string;
}

/** One Graph API request, recorded on the server and shown in the API log. Secrets are removed. */
export interface GraphCall {
  id: string;
  at: number;
  method: string;
  path: string;
  params: Record<string, unknown>;
  status: number;
  ms: number;
  ok: boolean;
  response?: unknown;
  truncated?: boolean;
}

export interface MetaError { message: string; title?: string; userMessage?: string; code?: number; subcode?: number; fbtraceId?: string }
