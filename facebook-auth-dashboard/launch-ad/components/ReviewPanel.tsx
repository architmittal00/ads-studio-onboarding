'use client';
import { useState } from 'react';
import { apiPost, errorText } from '@/launch-ad/lib/client-api';
import {
  ATTRIBUTION, BID_STRATEGIES, CATALOG_EVENTS, CONVERSION_EVENTS, CTAS, RETARGET_PRESETS, buildUrlTags, catalogAudienceSpec, currencySymbol, goalsFor, objectiveLabel,
} from '@/launch-ad/lib/constants';
import type { AdAccount, CampaignLite, FlowContext, FormState, LaunchResult, Mode } from '@/launch-ad/lib/types';
import type { ProductSet } from './LaunchForm';
import { placementSummary } from './PlacementControls';
import ProductStrip from './ProductStrip';
import ReviewGroups, { type ReviewRow } from './ReviewGroups';
import { Segmented } from './ui';

type ReviewProps = {
  mode: Mode;
  account: AdAccount;
  form: FormState;
  ctx: FlowContext;
  campaign?: CampaignLite;
  productSets: ProductSet[];
  pixels: { id: string; name: string }[];
  onDone: (r: LaunchResult) => void;
};

/** The Review step: what will be created, how it starts (paused or active) and the Launch button. */
export function ReviewPanel({ mode, account, form, ctx, campaign, productSets, pixels, onDone }: ReviewProps) {
  const [status, setStatus] = useState<'PAUSED' | 'ACTIVE'>('PAUSED');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<LaunchResult | null>(null);
  const [error, setError] = useState('');
  const [understood, setUnderstood] = useState(false);

  const c = form.campaign;
  const a = form.adset;
  const sym = currencySymbol(account.currency);
  const goal = goalsFor(ctx.objective, ctx.isCatalog).find((g) => g.key === a.goal);
  const setName = (id: string) => productSets.find((s) => s.id === id)?.name || id;
  const usesAudience = !ctx.isCatalog || a.catalogAudience === 'BROAD';

  // The structure map above the review already names the campaign, ad set and ad, so the rows don't repeat them.
  const campaignRows: ReviewRow[] = [];
  const adsetRows: ReviewRow[] = [];
  const adRows: ReviewRow[] = [];

  if (ctx.needsCampaign) {
    campaignRows.push(['Objective', `${objectiveLabel(c.objective)}${ctx.isCatalog ? ' with catalog' : ''}`]);
    campaignRows.push(['Setup', c.setup === 'ADVANTAGE_PLUS' ? 'Advantage+ Shopping' : 'Manual']);
    const bid = BID_STRATEGIES.find((b) => b.key === c.bidStrategy);
    campaignRows.push(['Bid strategy', `${bid?.label}${bid?.needs === 'bid' ? `, ${sym}${c.bidAmount}` : bid?.needs === 'roas' ? `, ${c.roasFloor}x` : ''}`]);
  }
  if (ctx.showBudget) {
    const amount = `${sym}${Number(form.budget.amount).toLocaleString('en-IN')} ${form.budget.type === 'DAILY' ? 'per day' : `lifetime, ends ${new Date(form.budget.endDate).toLocaleString('en-IN')}`}`;
    if (ctx.adsetBudget) adsetRows.push(['Ad set budget', amount]); else campaignRows.push(['Campaign budget', amount]);
  }

  if (ctx.isCatalog) {
    adsetRows.push(['Product set', setName(a.productSetId)]);
    if (a.catalogAudience === 'BROAD') adsetRows.push(['Catalog audience', 'Broad audience']);
    else {
      const ca = catalogAudienceSpec(a);
      const preset = RETARGET_PRESETS.find((p) => p.key === a.retargetPreset)?.label || a.retargetPreset;
      let detail = `${preset}, in the past ${a.retargetDays} days`;
      if (a.retargetPreset === 'UPSELL' || a.retargetPreset === 'CROSS_SELL') detail = `${preset}: people who interacted with ${setName(a.crossSellSourceSetId)}, in the past ${a.retargetDays} days`;
      if (a.retargetPreset === 'CUSTOM') {
        const ev = ca.events.map((e) => CATALOG_EVENTS.find((x) => x.key === e)?.label.toLowerCase()).join(' or ');
        detail = `Custom combination: ${ev} in the past ${a.retargetDays} days${ca.exclude ? `, excluding people who purchased in the past ${ca.excludeDays} days` : ''}`;
      }
      adsetRows.push(['Catalog audience', `Retarget ads to people who interacted with your products. ${detail}`]);
    }
  }
  adsetRows.push(['Performance goal', goal?.label || a.goal]);
  if (ctx.campaignHasBudget) adsetRows.push(['Budget', 'Uses the campaign budget']);
  if (goal?.pixel || ctx.isCatalog) {
    if (goal?.pixel) adsetRows.push(['Conversion event', CONVERSION_EVENTS.find((e) => e.key === (goal.fixedEvent || a.event))?.label || a.event]);
    const px = pixels.find((p) => p.id === a.pixelId);
    adsetRows.push(['Dataset (pixel)', px ? `${px.name} (${px.id})` : a.pixelId]);
  }
  if (usesAudience) {
    const names = (list: { name: string }[]) => list.map((x) => x.name).join(', ');
    adsetRows.push(['Audience', a.audienceType === 'ADVANTAGE' ? 'Advantage+ Audience' : a.audienceType === 'INTEREST' ? `Interests: ${names(a.interests) || 'none, broad'}` : `Saved audience${a.interests.length ? `, plus interests: ${names(a.interests)}` : ''}`]);
    if (a.customAudiences.length) adsetRows.push([a.audienceType === 'ADVANTAGE' ? 'Custom audience suggestions' : 'Custom audiences', names(a.customAudiences)]);
    if (a.excludedAudiences.length) adsetRows.push(['Excluded audiences', names(a.excludedAudiences)]);
    if (a.expandInterests && a.audienceType !== 'ADVANTAGE' && goal?.key !== 'VALUE' && goal?.key !== 'LANDING_PAGE_VIEWS') adsetRows.push(['Advantage detailed targeting', 'On: Meta may go beyond the chosen interests']);
  }
  if (!(usesAudience && a.audienceType === 'SAVED')) {
    adsetRows.push(['Locations', a.locations.map((l) => l.name).join(', ')]);
    adsetRows.push(['Age and gender', `${a.ageMin}–${a.ageMax === 65 ? '65+' : a.ageMax}, ${a.gender === 'ALL' ? 'all genders' : a.gender.toLowerCase()}`]);
    if (a.locales.length) adsetRows.push(['Languages', a.locales.map((l) => l.name).join(', ')]);
  }
  adsetRows.push(['Placements', placementSummary(a)]);
  if (goal?.attribution) adsetRows.push(['Attribution', ATTRIBUTION.find((x) => x.key === a.attribution)?.label || '']);

  if (ctx.needsAd) {
    adRows.push(['Format', `${form.ad.format === 'CAROUSEL' ? 'Carousel' : 'Single image or video'} from catalog, “${CTAS.find((x) => x.key === form.ad.cta)?.label}” button`]);
    adRows.push(['Catalog media', form.ad.media === 'SLIDESHOW' ? 'Multiple images (slideshow)' : form.ad.media === 'VIDEO' ? 'Product videos' : 'Images']);
    adRows.push(['Clicks go to', form.ad.destination === 'APP_WEB' ? 'App, website as backup' : 'Website']);
    if (ctx.adLevelCatalog) adRows.push(['Catalog', 'Set on the ad (the campaign has no catalog)']);
    adRows.push(['See more URL', form.ad.link]);
    adRows.push(['URL parameters', buildUrlTags(form.ad.urlTags || {}) || 'None']);
  }
  if (ctx.needsStandardAd) {
    const ad = form.ad;
    adRows.push(['Format', ad.kind === 'POST'
      ? `Existing ${ad.postSource === 'INSTAGRAM' ? 'Instagram' : 'Facebook'} post`
      : `New ${ad.videoId ? 'video' : 'image'} ad${ad.imageName ? ` (${ad.imageName})` : ''}, “${CTAS.find((x) => x.key === ad.cta)?.label}” button`]);
    if (ad.kind === 'UPLOAD') adRows.push(['Website', ad.link]);
    adRows.push(['URL parameters', buildUrlTags(ad.urlTags || {}) || 'None']);
  }
  const setTotal = productSets.find((x) => x.id === a.productSetId)?.product_count;

  const go = async () => {
    setBusy(true);
    setError('');
    setFailed(null);
    try {
      const result = await apiPost<LaunchResult>('launch', {
        accountId: account.id,
        currency: account.currency,
        mode,
        status,
        form,
        existingCampaign: campaign,
      });
      if (result.ok) onDone(result);
      else setFailed(result);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const created = failed?.created;
  const partial = !!(created?.campaign || created?.adset || created?.ads.length);

  return (
    <>
        <ReviewGroups groups={[{ title: 'Campaign', rows: campaignRows }, { title: 'Ad set', rows: adsetRows }, { title: 'Ad', rows: adRows }]} />
        {ctx.needsAd ? <div style={{ marginTop: 14 }}><ProductStrip setId={a.productSetId} label="Products the ad can show" total={setTotal} /></div> : null}

        <div className="field" style={{ marginTop: 18 }}>
          <span className="label">Start as</span>
          <Segmented value={status} onChange={setStatus} options={[{ key: 'PAUSED', label: 'Paused' }, { key: 'ACTIVE', label: 'Active' }]} />
          <div className="hint">{status === 'PAUSED' ? 'Everything is created paused so you can check it in Ads Manager first.' : 'Ads start delivering as soon as Meta approves them.'}</div>
          {status === 'ACTIVE' ? (
            <label className="confirm-active"><input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} /> I understand this can start spending as soon as Meta approves it.</label>
          ) : null}
        </div>

        {failed?.error ? (
          <div className="notice bad" style={{ marginTop: 16 }}>
            <b>Facebook rejected the {failed.step}:</b> {failed.error.title ? `${failed.error.title}. ` : ''}{failed.error.userMessage || failed.error.message}
            {failed.error.fbtraceId ? <div style={{ marginTop: 4, opacity: .8 }}>Trace ID: {failed.error.fbtraceId}</div> : null}
            {partial ? (
              <div style={{ marginTop: 6 }}>
                Already created (paused): {[created?.campaign && `campaign ${created.campaign.id}`, created?.adset && `ad set ${created.adset.id}`, created?.ads.length ? `${created.ads.length} ads` : ''].filter(Boolean).join(', ')}.
                {' '}Fix the issue and finish or delete these in Ads Manager — launching again creates new copies.
              </div>
            ) : null}
          </div>
        ) : null}
        {error ? <div className="notice bad" style={{ marginTop: 16 }}>{error}</div> : null}

        <div className="modal-actions">
          <button type="button" className="btn-primary" onClick={go} disabled={busy || (status === 'ACTIVE' && !understood)}>
            {busy ? <><span className="spinner" style={{ borderTopColor: '#fff' }} /> Launching…</> : status === 'ACTIVE' ? 'Launch and start spending' : 'Launch paused'}
          </button>
        </div>
    </>
  );
}
