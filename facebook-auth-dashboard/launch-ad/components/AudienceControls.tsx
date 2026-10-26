'use client';
import { useEffect, useState } from 'react';
import { apiGet, apiPost } from '@/launch-ad/lib/client-api';
import { useAsync } from '@/launch-ad/lib/hooks';
import type { AudienceItem, FlowContext, FormState, InterestItem } from '@/launch-ad/lib/types';
import { Chip, Field, Loading, SearchSelect } from './ui';

/* eslint-disable @typescript-eslint/no-explicit-any */

interface CustomAudience { id: string; name: string; subtype?: string; approximate_count_lower_bound?: number; approximate_count_upper_bound?: number; operation_status?: { code?: number; description?: string } }

const SUBTYPE: Record<string, string> = {
  CUSTOM: 'Customer list', WEBSITE: 'Website visitors', APP: 'App activity', LOOKALIKE: 'Lookalike', ENGAGEMENT: 'Engagement', VIDEO: 'Video viewers',
  OFFLINE_CONVERSION: 'Offline activity', DATA_SET: 'Data set', CLAIM: 'Claim', PARTNER: 'Partner', MANAGED: 'Managed',
};
const subtypeLabel = (s?: string) => (s ? SUBTYPE[s] || s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ') : 'Custom audience');
const people = (n: number) => n.toLocaleString('en-IN');

function sizeText(c: CustomAudience): string {
  const lo = c.approximate_count_lower_bound; const hi = c.approximate_count_upper_bound;
  if (hi == null && lo == null) return '';
  if (lo != null && hi != null && lo !== hi) return `${people(lo)}–${people(hi)} people`;
  return `${people((hi ?? lo) as number)} people`;
}

/** Custom audiences and lookalikes of the ad account: the ones to include, and the ones to leave out. */
export function CustomAudiences({ accountId, include, exclude, onInclude, onExclude, includeHint }: {
  accountId: string;
  include: AudienceItem[];
  exclude: AudienceItem[];
  onInclude: (v: AudienceItem[]) => void;
  onExclude: (v: AudienceItem[]) => void;
  includeHint?: string;
}) {
  const list = useAsync<CustomAudience[]>(`custom-audiences-${accountId}`, () => apiGet('custom-audiences', { account: accountId }));
  const picker = (own: AudienceItem[], other: AudienceItem[], set: (v: AudienceItem[]) => void, label: string) => {
    const taken = new Set([...own, ...other].map((x) => x.id));
    const options = (list.data || []).filter((c) => !taken.has(c.id)).map((c) => {
      const notReady = c.operation_status?.code != null && c.operation_status.code !== 200;
      return { key: c.id, label: c.name, meta: [subtypeLabel(c.subtype), sizeText(c), notReady ? `Not ready: ${c.operation_status?.description || 'still being built'}` : ''].filter(Boolean).join(' · ') };
    });
    return (
      <>
        {own.length ? <div className="chips" style={{ marginBottom: 8 }}>{own.map((x) => <Chip key={x.id} label={x.name} onRemove={() => set(own.filter((y) => y.id !== x.id))} />)}</div> : null}
        <SearchSelect
          value=""
          onChange={(id) => { const c = list.data?.find((x) => x.id === id); if (c) set([...own, { id: c.id, name: c.name, subtype: c.subtype }]); }}
          ariaLabel={label}
          noun="custom audiences"
          placeholder={`Search ${list.data?.length ? list.data.length.toLocaleString('en-IN') + ' ' : ''}custom audiences and lookalikes...`}
          searchPlaceholder="Search by name"
          options={options}
        />
      </>
    );
  };

  if (list.loading && !list.data) return <Field label="Custom audiences"><Loading /></Field>;
  if (list.error) return <Field label="Custom audiences"><div className="notice warn">Couldn&apos;t load this ad account&apos;s custom audiences: {list.error}</div></Field>;
  if (!list.data?.length && !include.length && !exclude.length) {
    return <Field label="Custom audiences" hint="This ad account has no custom audiences or lookalikes yet. Create them under Audiences in Meta Ads Manager and they will show up here."><div className="hint" style={{ margin: 0 }} /></Field>;
  }
  return (
    <>
      <Field label="Custom audiences" hint={includeHint || 'Customer lists, website visitors and lookalikes to reach.'}>{picker(include, exclude, onInclude, 'Custom audiences')}</Field>
      <Field label="Exclude custom audiences" hint="People in these audiences won't see the ad, for example recent buyers.">{picker(exclude, include, onExclude, 'Exclude custom audiences')}</Field>
    </>
  );
}

/** Interests Meta finds related to the ones already chosen, one click to add. */
export function InterestSuggestions({ interests, onAdd }: { interests: InterestItem[]; onAdd: (i: InterestItem) => void }) {
  const names = interests.map((i) => i.name).slice(0, 8);
  const sig = names.join('|');
  const [asked, setAsked] = useState('');
  useEffect(() => { const t = setTimeout(() => setAsked(sig), 500); return () => clearTimeout(t); }, [sig]);
  const res = useAsync<any[]>(asked ? `interest-suggestions-${asked}` : null, () => apiGet('interest-suggestions', { names: JSON.stringify(asked.split('|')) }));
  if (!interests.length) return null;
  if (res.loading && !res.data) return <Loading />;
  const have = new Set(interests.map((i) => i.id));
  const list = (res.data || []).filter((s) => !have.has(String(s.id))).slice(0, 10);
  if (!list.length) return null; // suggestions are a bonus: nothing to show, or Meta couldn't give any
  return (
    <div className="suggest">
      <div className="hint" style={{ margin: '0 0 6px' }}>Suggested from the interests you chose</div>
      <div className="chips">
        {list.map((s) => (
          <button key={s.id} type="button" className="chip suggest-chip" onClick={() => onAdd({ id: String(s.id), name: s.name })} title={s.audience_size_upper_bound ? `${people(Number(s.audience_size_upper_bound))} people` : undefined}>+ {s.name}</button>
        ))}
      </div>
    </div>
  );
}

/** What a saved audience contains, in one line. */
export function describeTargeting(t: any): string {
  if (!t) return '';
  const geo = t.geo_locations || {};
  const places = [...(geo.countries || []), ...(geo.regions || []).map((r: any) => r.name || r.key), ...(geo.cities || []).map((c: any) => c.name || c.key)];
  const interests: string[] = (t.flexible_spec || []).flatMap((g: any) => (g.interests || []).map((i: any) => i.name)).filter(Boolean);
  const n = (list: unknown[] | undefined, what: string) => (list?.length ? `${list.length} ${what}` : '');
  return [
    places.length ? places.slice(0, 3).join(', ') + (places.length > 3 ? ` +${places.length - 3}` : '') : '',
    t.age_min || t.age_max ? `${t.age_min || 18}–${t.age_max && t.age_max < 65 ? t.age_max : '65+'}` : '',
    Array.isArray(t.genders) && t.genders.length === 1 ? (t.genders[0] === 1 ? 'Men' : 'Women') : '',
    interests.length ? `Interests: ${interests.slice(0, 4).join(', ')}${interests.length > 4 ? ` +${interests.length - 4}` : ''}` : '',
    n(t.custom_audiences, t.custom_audiences?.length === 1 ? 'custom audience' : 'custom audiences'),
    n(t.excluded_custom_audiences, 'excluded'),
  ].filter(Boolean).join(' · ');
}

interface Estimate { available: boolean; reason?: string; ready?: boolean; daily?: number | null; lower?: number | null; upper?: number | null }

// Our own reading of the size (not Meta's): the bar runs from 10 thousand to 100 million people on a log scale.
const SCALE_MIN = 4; const SCALE_MAX = 8;
function band(n: number): { key: 'narrow' | 'moderate' | 'broad'; label: string } {
  if (n < 100_000) return { key: 'narrow', label: 'Narrow' };
  if (n < 10_000_000) return { key: 'moderate', label: 'Moderate' };
  return { key: 'broad', label: 'Broad' };
}

/** Meta's estimate of how many people the audience reaches, so a too-narrow or too-broad one shows before launch. */
export function AudienceEstimate({ accountId, form, ctx }: { accountId: string; form: FormState; ctx: FlowContext }) {
  const a = form.adset;
  // Only what changes the audience: typing elsewhere in the form doesn't ask Meta again.
  const sig = JSON.stringify([a.audienceType, a.savedAudienceId, a.locations.map((l) => `${l.type}-${l.key}`), a.ageMin, a.ageMax, a.gender, a.interests.map((i) => i.id),
    a.customAudiences.map((c) => c.id), a.excludedAudiences.map((c) => c.id), a.locales.map((l) => l.key), a.devices, a.os, a.catalogAudience, ctx.isCatalog]);
  const [asked, setAsked] = useState('');
  useEffect(() => { const t = setTimeout(() => setAsked(sig), 700); return () => clearTimeout(t); }, [sig]);
  const res = useAsync<Estimate>(asked ? `audience-estimate-${accountId}-${asked}` : null, () => apiPost('audience-estimate', {
    accountId, ctx,
    form: { ...form, ad: { ...form.ad, postMedia: [], imageUrl: '', videoUrl: '', postPreview: '' } },
  }));
  const retarget = ctx.isCatalog && a.catalogAudience !== 'BROAD';
  if (retarget) return null;

  const e = res.data;
  let body: React.ReactNode;
  if (res.error && !e) body = <div className="hint" style={{ margin: 0 }} title={res.error}>Audience size isn&apos;t available for this ad account right now.</div>;
  else if (!e) body = <Loading />;
  else if (!e.available) body = <div className="hint" style={{ margin: 0 }}>{e.reason}</div>;
  else if (!e.ready) body = <div className="hint" style={{ margin: 0 }}>Meta is still working out this estimate. <button type="button" className="btn-link" onClick={res.reload}>Check again</button></div>;
  else {
    const lo = e.lower ?? e.upper ?? 0; const hi = e.upper ?? e.lower ?? 0;
    const mid = (lo + hi) / 2 || 1;
    const b = band(mid);
    const pos = Math.min(100, Math.max(0, ((Math.log10(Math.max(mid, 1)) - SCALE_MIN) / (SCALE_MAX - SCALE_MIN)) * 100));
    body = (
      <>
        <div className="est-top">
          <span className="est-num">{lo === hi ? people(hi) : `${people(lo)}–${people(hi)}`} people</span>
          <span className={`est-badge ${b.key}`}>{b.label}</span>
          {res.loading ? <span className="hint" style={{ margin: 0 }}>Updating…</span> : null}
        </div>
        <div className="est-bar" role="img" aria-label={`${b.label} audience`}><span className="seg n" /><span className="seg m" /><span className="seg b" /><i style={{ left: `${pos}%` }} /></div>
        <div className="est-scale"><span>Narrow</span><span>Moderate</span><span>Broad</span></div>
        <div className="hint" style={{ margin: '6px 0 0' }}>
          {a.audienceType === 'ADVANTAGE' ? 'Meta can go beyond this: Advantage+ audience starts from your suggestions. ' : ''}
          Meta&apos;s estimate of people on its apps who match. Under 1 lakh is narrow and can limit delivery; over 1 crore is broad.
        </div>
      </>
    );
  }
  return <div className="audience-est"><div className="label" style={{ marginBottom: 6 }}>Estimated audience size</div>{body}</div>;
}
