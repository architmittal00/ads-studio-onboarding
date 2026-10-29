import { currencySymbol, fromMinorUnits, normalizeObjective } from '@/launch-ad/lib/constants';
import type { AdsetLite, CampaignLite } from '@/launch-ad/lib/types';

/** Helpers for the campaign and ad set picker: how they read in a list, and whether the ad built first can go into them. */

function budgetText(c: { daily_budget?: string; lifetime_budget?: string }, currency: string) {
  const sym = currencySymbol(currency);
  if (c.daily_budget) return `${sym}${Number(fromMinorUnits(c.daily_budget, currency)).toLocaleString('en-IN')}/day`;
  if (c.lifetime_budget) return `${sym}${Number(fromMinorUnits(c.lifetime_budget, currency)).toLocaleString('en-IN')} lifetime`;
  return 'Ad set budgets';
}

const statusLabel = (s?: string) => (s === 'IN_PROCESS' ? 'ACTIVE' : s || '').replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

/** What the ad built first needs from its destination. */
export interface AdFit { isCatalog: boolean; catalogId: string }

/** Why a campaign can't take the ad ('' when it can). */
export function campaignFit(c: CampaignLite, fit: AdFit): string {
  const catalog = c.promoted_object?.product_catalog_id;
  if (fit.isCatalog && catalog && catalog !== fit.catalogId) return 'Uses a different catalog';
  if (fit.isCatalog && !catalog && normalizeObjective(c.objective) !== 'OUTCOME_SALES') return 'Catalog ads need a Sales campaign';
  if (!fit.isCatalog && catalog) return 'Catalog campaigns need a catalog ad';
  return '';
}

/** Why an ad set can't take the ad ('' when it can). */
export function adsetFit(a: AdsetLite, fit: AdFit): string {
  const set = a.promoted_object?.product_set_id;
  if (fit.isCatalog) {
    if (set) return a.campaign?.promoted_object?.product_catalog_id === fit.catalogId ? '' : 'Uses a different catalog';
    return normalizeObjective(a.campaign?.objective) === 'OUTCOME_SALES' ? '' : 'Catalog ads need a Sales campaign';
  }
  return set ? 'Catalog ad sets need a catalog ad' : '';
}

export { budgetText, statusLabel };
