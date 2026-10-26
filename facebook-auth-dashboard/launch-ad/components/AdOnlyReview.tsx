'use client';
import { useState } from 'react';
import { apiPost, errorText } from '@/launch-ad/lib/client-api';
import { apiGet } from '@/launch-ad/lib/client-api';
import { CTAS, buildUrlTags } from '@/launch-ad/lib/constants';
import { useAsync } from '@/launch-ad/lib/hooks';
import type { AdAccount, AdsetLite, FormState, LaunchResult } from '@/launch-ad/lib/types';
import { adsetFacts } from './AdsetFacts';
import type { ProductSet } from './LaunchForm';
import ProductStrip from './ProductStrip';
import ReviewGroups, { type ReviewRow } from './ReviewGroups';
import { Segmented } from './ui';

type Props = { account: AdAccount; form: FormState; target: AdsetLite; onDone: (r: LaunchResult) => void; productSets?: ProductSet[] };

const day = (s: string) => new Date(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

/** The Review step when the ad joins an existing ad set: what is added, how it starts, and the button. */
export function AdOnlyPanel({ account, form, target, onDone, productSets }: Props) {
  const [status, setStatus] = useState<'PAUSED' | 'ACTIVE'>('PAUSED');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<LaunchResult | null>(null);
  const [error, setError] = useState('');
  const [understood, setUnderstood] = useState(false);
  const pixels = useAsync<{ id: string; name: string }[]>(`pixels-${account.id}`, () => apiGet('pixels', { account: account.id }));
  const ad = form.ad;
  const isCatalog = ad.kind === 'CATALOG';
  const targetSet = target.promoted_object?.product_set_id;
  // The structure map above the review already names the campaign, ad set and ad, so the rows don't repeat them.

  const cta = CTAS.find((x) => x.key === ad.cta)?.label;
  const facts = adsetFacts(target, account).filter(([k]) => k !== 'Campaign' && k !== 'Ad set');
  const adsetRows: ReviewRow[] = facts;

  const setId = targetSet || form.adset.productSetId;
  const set = productSets?.find((s) => s.id === setId);
  const adRows: ReviewRow[] = [];
  adRows.push(['Format', isCatalog
    ? `${ad.format === 'CAROUSEL' ? 'Carousel' : 'Single image or video'} from catalog, “${cta}” button`
    : ad.kind === 'POST' ? `Existing ${ad.postSource === 'INSTAGRAM' ? 'Instagram' : 'Facebook'} post` : `New ${ad.videoId ? 'video' : 'image'} ad${ad.imageName ? ` (${ad.imageName})` : ''}, “${cta}” button`]);
  if (isCatalog) {
    adRows.push(['Product set', set
      ? `${set.name}${set.product_count != null ? ` · ${set.product_count.toLocaleString('en-IN')} products` : ''}${targetSet ? ' (the ad set’s own set)' : ''}`
      : targetSet ? 'The ad set’s own product set' : 'The one chosen for this ad']);
    adRows.push(['Clicks go to', ad.destination === 'APP_WEB' ? 'App, website as backup' : 'Website']);
  }
  if (isCatalog || ad.kind === 'UPLOAD') adRows.push([isCatalog ? 'See more URL' : 'Website', ad.link]);

  // The ad tracks website events with the chosen dataset (pixel), else the ad set’s own.
  const trackPixel = form.adset.pixelId || target.promoted_object?.pixel_id || '';
  const pxName = (id: string) => { const p = pixels.data?.find((x) => x.id === id); return p ? `${p.name} (${p.id})` : id; };
  const trackRows: ReviewRow[] = [
    ['Dataset (pixel)', trackPixel ? `${pxName(trackPixel)}, tracks website events for this ad` : 'None chosen'],
    ['URL parameters', buildUrlTags(ad.urlTags || {}) || 'None'],
  ];
  const pixelMismatch = !!(form.adset.pixelId && target.promoted_object?.pixel_id && form.adset.pixelId !== target.promoted_object.pixel_id);

  // Things that stop this ad from delivering even once it is added.
  const heads: string[] = [];
  const st = target.effective_status || target.status;
  if (st === 'CAMPAIGN_PAUSED') heads.push('The campaign is paused, so your ad won’t deliver until the campaign is turned on in Ads Manager.');
  else if (st === 'PAUSED') heads.push('This ad set is paused, so your ad won’t deliver until it is turned on in Ads Manager.');
  if (target.end_time && new Date(target.end_time).getTime() < Date.now()) heads.push(`This ad set’s schedule ended on ${day(target.end_time)}. Extend it in Ads Manager, or your ad won’t deliver.`);

  const go = async () => {
    setBusy(true); setError(''); setFailed(null);
    try {
      const result = await apiPost<LaunchResult>('launch', { accountId: account.id, currency: account.currency, mode: 'AD_ONLY', status, form, targetAdset: target });
      if (result.ok) onDone(result); else setFailed(result);
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };

  return (
    <>
        <ReviewGroups groups={[{ title: 'Ad set it joins', rows: adsetRows }, { title: 'Your ad', rows: adRows }, { title: 'Tracking', rows: trackRows }]} />
        {isCatalog ? <div style={{ marginTop: 14 }}><ProductStrip setId={setId} label="Products the ad can show" total={set?.product_count} /></div> : null}
        {heads.length || pixelMismatch || !trackPixel ? (
          <div className="review-notes">
            {heads.map((h) => <div key={h} className="notice warn">{h}</div>)}
            {pixelMismatch ? <div className="notice warn">This ad set optimises for <b>{pxName(target.promoted_object?.pixel_id || '')}</b>, but your ad tracks <b>{pxName(form.adset.pixelId)}</b>. Use the same dataset (pixel) unless you mean to track a different one.</div> : null}
            {!trackPixel ? <div className="notice warn">No dataset (pixel) is chosen, so Ads Manager won&apos;t track website events for this ad. Pick one in the Ad step.</div> : null}
          </div>
        ) : null}
        <div className="field" style={{ marginTop: 18 }}>
          <span className="label">Start as</span>
          <Segmented value={status} onChange={setStatus} options={[{ key: 'PAUSED', label: 'Paused' }, { key: 'ACTIVE', label: 'Active' }]} />
          <div className="hint">{status === 'PAUSED' ? 'The ad is created paused so you can check it in Ads Manager first.' : 'The ad delivers once Meta approves it, if its ad set and campaign are active.'}</div>
          {status === 'ACTIVE' ? (
            <label className="confirm-active"><input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} /> I understand this can start spending as soon as Meta approves it.</label>
          ) : null}
        </div>
        {failed?.error ? (
          <div className="notice bad" style={{ marginTop: 16 }}>
            <b>Facebook rejected the {failed.step}:</b> {failed.error.title ? `${failed.error.title}. ` : ''}{failed.error.userMessage || failed.error.message}
            {failed.error.fbtraceId ? <div style={{ marginTop: 4, opacity: .8 }}>Trace ID: {failed.error.fbtraceId}</div> : null}
          </div>
        ) : null}
        {error ? <div className="notice bad" style={{ marginTop: 16 }}>{error}</div> : null}
        <div className="modal-actions">
          <button type="button" className="btn-primary" onClick={go} disabled={busy || (status === 'ACTIVE' && !understood)}>
            {busy ? <><span className="spinner" style={{ borderTopColor: '#fff' }} /> Launching…</> : status === 'ACTIVE' ? 'Add ad and start spending' : 'Add ad paused'}
          </button>
        </div>
    </>
  );
}
