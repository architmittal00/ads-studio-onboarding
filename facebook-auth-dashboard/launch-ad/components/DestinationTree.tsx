'use client';
import { ChevronDown, ChevronRight, Plus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { apiGet } from '@/launch-ad/lib/client-api';
import { currencySymbol, fromMinorUnits, objectiveLabel } from '@/launch-ad/lib/constants';
import { useAsync } from '@/launch-ad/lib/hooks';
import type { AdAccount, AdsetLite, CampaignLite, Insight } from '@/launch-ad/lib/types';
import { type AdFit, adsetFit, budgetText, campaignFit, statusLabel } from './Pickers';
import { Loading } from './ui';

export type Destination =
  | { kind: 'NEW_CAMPAIGN' }
  | { kind: 'NEW_ADSET'; campaign: CampaignLite }
  | { kind: 'ADSET'; adset: AdsetLite };

/* eslint-disable @typescript-eslint/no-explicit-any */
export function audienceText(t: any): string {
  if (!t) return '';
  const geo = t.geo_locations || {};
  const places = [...(geo.countries || []), ...(geo.regions || []).map((r: any) => r.name || r.key), ...(geo.cities || []).map((c: any) => c.name || c.key)];
  const parts = [
    places.length ? (places.length > 2 ? `${places.slice(0, 2).join(', ')} +${places.length - 2}` : places.join(', ')) : '',
    t.age_min || t.age_max ? `${t.age_min || 18}–${t.age_max && t.age_max < 65 ? t.age_max : '65+'}` : '',
    t.product_audience_specs?.length ? 'Retargeting' : t.targeting_automation?.advantage_audience === 1 ? 'Advantage+ audience' : t.custom_audiences?.length ? 'Custom audiences' : '',
  ];
  return parts.filter(Boolean).join(' · ');
}

export function adsetBudget(a: AdsetLite, currency: string): string {
  const sym = currencySymbol(currency);
  if (a.daily_budget) return `${sym}${Number(fromMinorUnits(a.daily_budget, currency)).toLocaleString('en-IN')}/day`;
  if (a.lifetime_budget) return `${sym}${Number(fromMinorUnits(a.lifetime_budget, currency)).toLocaleString('en-IN')} lifetime`;
  return 'Campaign budget';
}

/** Last-7-day spend, purchases and ROAS from an insights field. */
export function perf(ins?: { data?: Insight[] }) {
  const r = ins?.data?.[0];
  const spend = Number(r?.spend || 0);
  const purchases = Number(r?.actions?.find((a) => ['omni_purchase', 'purchase', 'offsite_conversion.fb_pixel_purchase'].includes(a.action_type))?.value || 0);
  const roas = Number(r?.purchase_roas?.[0]?.value || 0);
  return { spend, purchases, roas };
}
export function perfText(p: { spend: number; purchases: number; roas: number }, currency: string, full = true): string {
  if (!p.spend) return 'No spend in the last 7 days';
  const parts = [`${currencySymbol(currency)}${p.spend.toLocaleString('en-IN', { maximumFractionDigits: 0 })} spent`];
  if (full && p.purchases) parts.push(`${p.purchases.toLocaleString('en-IN')} ${p.purchases === 1 ? 'purchase' : 'purchases'}`);
  if (full && p.roas) parts.push(`${p.roas.toFixed(2)} ROAS`);
  return `${parts.join(' · ')} (7d)`;
}

// Running first, then by last-7-day spend, then most recently edited.
const STATUS_RANK: Record<string, number> = { ACTIVE: 0, WITH_ISSUES: 1, IN_PROCESS: 1, CAMPAIGN_PAUSED: 2, ADSET_PAUSED: 2, PAUSED: 3 };
function byActivity(x: { effective_status?: string; status?: string; updated_time?: string; insights?: { data?: Insight[] } }, y: typeof x) {
  const rx = STATUS_RANK[x.effective_status || x.status || ''] ?? 4;
  const ry = STATUS_RANK[y.effective_status || y.status || ''] ?? 4;
  if (rx !== ry) return rx - ry;
  const sx = perf(x.insights).spend; const sy = perf(y.insights).spend;
  if (sx !== sy) return sy - sx;
  return String(y.updated_time || '').localeCompare(String(x.updated_time || ''));
}

function AdsetRow({ a, why, selected, onPick, currency }: { a: AdsetLite; why: string; selected: boolean; onPick: () => void; currency: string }) {
  const n = a.ads?.summary?.total_count ?? 0;
  return (
    <button type="button" className={`tree-row ${selected ? 'on' : ''}`} disabled={!!why} title={why || undefined} onClick={onPick} aria-pressed={selected}>
      <span className="radio" aria-hidden />
      <span className="t-name">{a.name}</span>
      {a.promoted_object?.product_set_id ? <span className="badge coral">Catalog</span> : null}
      <span className="t-meta">{[adsetBudget(a, currency), statusLabel(a.effective_status || a.status), perfText(perf(a.insights), currency), `${n} ${n === 1 ? 'ad' : 'ads'}`, audienceText(a.targeting), why].filter(Boolean).join(' · ')}</span>
    </button>
  );
}

/** A campaign's ad sets, fetched only when the campaign is expanded. */
function CampaignChildren({ account, c, blocked, fit, isSel, onChange, fitsOnly }: {
  account: AdAccount; c: CampaignLite; blocked: string; fit: AdFit;
  isSel: (d: Destination) => boolean; onChange: (d: Destination) => void; fitsOnly: boolean;
}) {
  const res = useAsync<AdsetLite[]>(`adsets-c-${c.id}`, () => apiGet('adsets', { account: account.id, campaign: c.id }));
  const all = [...(res.data || [])].sort(byActivity);
  const shown = fitsOnly ? all.filter((a) => !adsetFit(a, fit)) : all;
  const hidden = all.length - shown.length;
  return (
    <div className="tree-children">
      {res.loading ? <Loading /> : res.error ? <div className="notice bad">{res.error}</div> : !all.length ? (
        <div className="hint" style={{ padding: '6px 11px' }}>No active or paused ad sets in this campaign.</div>
      ) : !shown.length ? (
        <div className="hint" style={{ padding: '6px 11px' }}>None of this campaign&apos;s {all.length} ad sets can take this ad.</div>
      ) : shown.map((a) => (
        <AdsetRow key={a.id} a={a} why={blocked || adsetFit(a, fit)} selected={isSel({ kind: 'ADSET', adset: a })} onPick={() => onChange({ kind: 'ADSET', adset: a })} currency={account.currency} />
      ))}
      <button type="button" className={`tree-row new ${isSel({ kind: 'NEW_ADSET', campaign: c }) ? 'on' : ''}`} disabled={!!blocked} title={blocked || undefined} onClick={() => onChange({ kind: 'NEW_ADSET', campaign: c })}>
        <span className="radio" aria-hidden />
        <Plus size={14} />
        <span className="t-name">New ad set in this campaign</span>
      </button>
      {hidden && shown.length ? <div className="hint" style={{ padding: '2px 11px' }}>{hidden} {hidden === 1 ? 'ad set doesn’t' : 'ad sets don’t'} fit this ad and {hidden === 1 ? 'is' : 'are'} hidden.</div> : null}
    </div>
  );
}

/**
 * Ads Manager-style tree in a fixed-height card: campaigns load first; a campaign's ad sets load when it
 * is expanded; search looks up campaigns locally and ad sets by name on Meta's side.
 * Once a destination is picked the list folds into a one-line summary with a Change link.
 */
export default function DestinationTree({ account, fit, value, onChange }: {
  account: AdAccount;
  fit: AdFit;
  value: Destination | null;
  onChange: (d: Destination) => void;
}) {
  const campaigns = useAsync<CampaignLite[]>(`campaigns-${account.id}`, () => apiGet('campaigns', { account: account.id }));
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [fitsOnly, setFitsOnly] = useState(true);
  // Once something is picked the list folds into a one-line summary; "Change" opens it again.
  const [picking, setPicking] = useState(!value);
  useEffect(() => { if (!value) setPicking(true); }, [value]);
  const pick = (d: Destination) => { onChange(d); setPicking(false); };
  useEffect(() => { const t = setTimeout(() => setDebounced(q.trim()), 350); return () => clearTimeout(t); }, [q]);
  const searching = debounced.length >= 2;
  const found = useAsync<AdsetLite[]>(searching ? `adsets-s-${account.id}-${debounced}` : null, () => apiGet('adsets', { account: account.id, search: debounced }));

  const s = debounced.toLowerCase();
  const allRows = useMemo(() => (campaigns.data || [])
    .map((c) => ({ c, blocked: campaignFit(c, fit), hits: (searching ? (found.data || []).filter((a) => a.campaign?.id === c.id) : []).filter((a) => !fitsOnly || !adsetFit(a, fit)) }))
    .filter((r) => !searching || r.c.name.toLowerCase().includes(s) || r.c.id.includes(s) || r.hits.length > 0)
    .sort((x, y) => Number(!!x.blocked) - Number(!!y.blocked) || byActivity(x.c, y.c)), [campaigns.data, fit, searching, found.data, s, fitsOnly]);
  const rows = fitsOnly ? allRows.filter((r) => !r.blocked) : allRows;
  const hiddenCampaigns = allRows.length - rows.length;
  // Why campaigns are hidden, in numbers, so "doesn't fit" is never a mystery.
  const WHY: Record<string, [string, string]> = {
    'Uses a different catalog': ['uses a different catalog', 'use a different catalog'],
    'Catalog ads need a Sales campaign': ['is not a Sales campaign (catalog ads need one)', 'are not Sales campaigns (catalog ads need one)'],
    'Catalog campaigns need a catalog ad': ['is a catalog campaign (this is not a catalog ad)', 'are catalog campaigns (this is not a catalog ad)'],
  };
  const hiddenWhy = fitsOnly && hiddenCampaigns
    ? Object.entries(allRows.filter((r) => r.blocked).reduce((m, r) => ({ ...m, [r.blocked]: (m[r.blocked] || 0) + 1 }), {} as Record<string, number>)).map(([why, n]) => `${n} ${WHY[why] ? WHY[why][n === 1 ? 0 : 1] : why.toLowerCase()}`).join(', ')
    : '';

  const isSel = (d: Destination) => !!value && value.kind === d.kind
    && (d.kind !== 'NEW_ADSET' || (value.kind === 'NEW_ADSET' && value.campaign.id === d.campaign.id))
    && (d.kind !== 'ADSET' || (value.kind === 'ADSET' && value.adset.id === d.adset.id));

  if (value && !picking) {
    const sel = value.kind === 'ADSET'
      ? { name: value.adset.name, meta: [value.adset.campaign?.name, adsetBudget(value.adset, account.currency), statusLabel(value.adset.effective_status || value.adset.status)] }
      : value.kind === 'NEW_ADSET'
        ? { name: 'New ad set', meta: [`in ${value.campaign.name}`] }
        : { name: 'New campaign', meta: ['A new campaign and ad set for this ad'] };
    return (
      <div className="card tree">
        <div className="tree-scroll" style={{ maxHeight: 'none' }}>
          <div className="tree-row on" style={{ cursor: 'default' }}>
            <span className="radio" aria-hidden />
            <span className="t-name" title={sel.name}>{sel.name}</span>
            <span className="t-meta">{sel.meta.filter(Boolean).join(' · ')}</span>
            <button type="button" className="btn-link" onClick={() => setPicking(true)}>Change</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="card tree">
      <div className="tree-head">
        <input className="input" placeholder="Search campaigns and ad sets by name…" value={q} onChange={(e) => setQ(e.target.value)} />
        <button type="button" className={`tree-row new top ${isSel({ kind: 'NEW_CAMPAIGN' }) ? 'on' : ''}`} onClick={() => pick({ kind: 'NEW_CAMPAIGN' })} aria-pressed={isSel({ kind: 'NEW_CAMPAIGN' })}>
          <span className="radio" aria-hidden />
          <Plus size={14} />
          <span className="t-name">New campaign</span>
          <span className="t-meta">Create a campaign and ad set for this ad{fit.isCatalog ? ' (with your catalog)' : ''}</span>
        </button>
        <div className="tree-filter">
          <span>{campaigns.data ? `${rows.length} ${rows.length === 1 ? 'campaign' : 'campaigns'}${fitsOnly ? ' this ad can go into' : ''} · running first, then by 7-day spend` : ''}</span>
          {hiddenCampaigns || !fitsOnly ? (
            <button type="button" className="btn-link" onClick={() => setFitsOnly(!fitsOnly)}>
              {fitsOnly ? `Show the ${hiddenCampaigns} it can’t go into` : 'Hide the ones it can’t go into'}
            </button>
          ) : null}
        </div>
        {hiddenWhy ? <div className="hint" style={{ margin: 0 }}>Hidden because this ad can&apos;t go into them: {hiddenWhy}.</div> : null}
      </div>

      <div className="tree-scroll">
        {campaigns.loading ? <Loading /> : campaigns.error ? <div className="notice bad">{campaigns.error}</div> : searching && found.loading ? <Loading /> : !rows.length ? (
          <div className="note" style={{ padding: '10px 4px' }}>{searching ? `No campaigns or ad sets match “${debounced}”.` : 'No active or paused campaigns in this ad account. Create a new campaign above.'}</div>
        ) : rows.map(({ c, blocked, hits }) => {
          const selectedInside = (value?.kind === 'ADSET' && value.adset.campaign?.id === c.id) || (value?.kind === 'NEW_ADSET' && value.campaign.id === c.id);
          const expanded = open[c.id] ?? selectedInside;
          const catalog = c.promoted_object?.product_catalog_id;
          const count = c.adsets?.summary?.total_count;
          return (
            <div key={c.id} className={`tree-campaign ${blocked ? 'blocked' : ''}`}>
              <button type="button" className="tree-row camp" onClick={() => setOpen({ ...open, [c.id]: !expanded })} aria-expanded={expanded} title={blocked || undefined}>
                {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <span className="t-name">{c.name}</span>
                <span className={`badge ${catalog ? 'coral' : 'grey'}`}>{catalog ? 'Catalog' : 'Normal'}</span>
                <span className="t-meta">{[objectiveLabel(c.objective), budgetText(c, account.currency), statusLabel(c.effective_status || c.status), perfText(perf(c.insights), account.currency, false), count != null ? `${count} ${count === 1 ? 'ad set' : 'ad sets'}` : '', blocked].filter(Boolean).join(' · ')}</span>
              </button>
              {expanded ? (
                <CampaignChildren account={account} c={c} blocked={blocked} fit={fit} isSel={isSel} onChange={pick} fitsOnly={fitsOnly} />
              ) : hits.length ? (
                <div className="tree-children">
                  {hits.map((a) => <AdsetRow key={a.id} a={a} why={blocked || adsetFit(a, fit)} selected={isSel({ kind: 'ADSET', adset: a })} onPick={() => pick({ kind: 'ADSET', adset: a })} currency={account.currency} />)}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
