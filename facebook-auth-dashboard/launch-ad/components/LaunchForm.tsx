'use client';
import { useEffect, useMemo, useState } from 'react';
import { apiGet } from '@/launch-ad/lib/client-api';
import {
  AGES, ATTRIBUTION, BID_STRATEGIES, CATALOG_EVENTS, CONVERSION_EVENTS, OBJECTIVES, PLATFORMS, RETARGET_PRESETS,
  currencySymbol, goalsFor,
} from '@/launch-ad/lib/constants';
import { buildContext, validate } from '@/launch-ad/lib/form';
import { useAsync } from '@/launch-ad/lib/hooks';
import type { AdAccount, CampaignLite, FormState, GeoItem, InterestItem, LocaleItem, Mode } from '@/launch-ad/lib/types';
import { AudienceEstimate, CustomAudiences, InterestSuggestions, describeTargeting } from './AudienceControls';
import BudgetField from './BudgetField';
import CatalogPanel from './CatalogPanel';
import { Devices, Positions, placementSummary } from './PlacementControls';
import { CheckPills, Field, Loading, Segmented, Select, TagSearch, TextInput, Toggle } from './ui';

export interface ProductSet { id: string; name: string; product_count?: number; products?: { data?: { id: string; image_url?: string }[] } }

const RETARGET_DAYS = [3, 7, 14, 30, 60, 90, 180].map((d) => ({ key: String(d), label: `${d} days` }));

/** In the workspace, rarely changed settings sit in a collapsed section whose title shows their current values. */
function Adv({ summary, children }: { summary: string; children: React.ReactNode }) {
  return <details className="adv"><summary>Advanced · {summary}</summary>{children}</details>;
}

/** The Setup step of "Start with an Ad": budget, audience, placements and schedule for a new campaign or ad set. */
export default function LaunchForm({ mode, account, form, setForm, campaign, onMissing }: {
  mode: Mode;
  account: AdAccount;
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  campaign?: CampaignLite;
  /** The workspace shows the action bar and the review: it is told what is still needed */
  onMissing: (missing: { key: string; label: string }[]) => void;
}) {
  const ctx = buildContext(mode, form, campaign);
  const c = form.campaign;
  const a = form.adset;
  const b = form.budget;
  const sym = currencySymbol(account.currency);
  const [catalogReady, setCatalogReady] = useState(false);

  const up = <K extends keyof FormState>(k: K, patch: Partial<FormState[K]>) =>
    setForm((f) => ({ ...f, [k]: { ...f[k], ...patch } }));

  // Account-level lists
  const pixels = useAsync<{ id: string; name: string }[]>(`pixels-${account.id}`, () => apiGet('pixels', { account: account.id }));
  const retarget = ctx.isCatalog && a.catalogAudience !== 'BROAD';
  const saved = useAsync<{ id: string; name: string; targeting?: unknown }[]>(
    !retarget && (a.audienceType === 'SAVED' || a.audienceType === 'INTEREST') ? `saved-${account.id}` : null,
    () => apiGet('saved-audiences', { account: account.id }),
  );
  // Campaign catalog, or the ad's own catalog when a catalog ad goes into a campaign without one.
  const setsCatalogId = ctx.isCatalog ? ctx.catalogId : ctx.adLevelCatalog ? c.catalogId : '';
  const productSets = useAsync<ProductSet[]>(setsCatalogId ? `sets-${setsCatalogId}` : null, () => apiGet('product-sets', { catalog: setsCatalogId }));

  // Goals follow the objective (and catalog). Keep the selection valid.
  const goals = goalsFor(ctx.objective, ctx.isCatalog);
  const goal = goals.find((g) => g.key === a.goal) || goals[0];
  useEffect(() => {
    if (!goals.some((g) => g.key === a.goal)) up('adset', { goal: goals[0].key });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.objective, ctx.isCatalog]);

  const bids = BID_STRATEGIES.filter((x) => !x.valueOnly || goal.key === 'VALUE');
  const bid = bids.find((x) => x.key === c.bidStrategy) || bids[0];
  useEffect(() => {
    if (!bids.some((x) => x.key === c.bidStrategy)) up('campaign', { bidStrategy: bids[0].key });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goal.key]);

  // A product set that doesn't belong to the loaded catalog is cleared; nothing is picked automatically.
  useEffect(() => {
    const sets = productSets.data;
    if (sets?.length && a.productSetId && !sets.some((s) => s.id === a.productSetId)) up('adset', { productSetId: '' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productSets.data]);

  const advantagePlus = ctx.needsCampaign && c.setup === 'ADVANTAGE_PLUS';
  useEffect(() => {
    if (advantagePlus) { up('adset', { audienceType: 'ADVANTAGE', placement: 'ADVANTAGE' }); up('budget', { level: 'CAMPAIGN' }); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [advantagePlus]);

  const missing = useMemo(
    () => validate(form, ctx, { goalNeedsPixel: !!goal.pixel, bidNeeds: ctx.needsCampaign ? bid.needs : undefined, catalogReady }),
    [form, ctx, goal.pixel, bid.needs, catalogReady],
  );

  // Report only when the list itself changes (the array is rebuilt every render).
  const missingKey = missing.map((m) => m.key).join('|');
  useEffect(() => { onMissing(missing); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [missingKey]);

  // Budget can live at either level; an amount at one level disables the other.
  const campaignBudgetReason = b.level === 'ADSET' ? 'The budget is set at ad set level. Switch the budget level above to use one budget for the whole campaign.' : undefined;
  const adsetBudgetReason = !ctx.needsCampaign
    ? (ctx.campaignHasBudget ? 'This campaign has a campaign budget (Advantage+ campaign budget), so its ad sets share it.' : undefined)
    : advantagePlus
      ? 'Advantage+ Shopping uses the campaign budget.'
      : b.level === 'CAMPAIGN' ? 'The budget is set at campaign level. Switch the budget level in the Campaign card to give the ad set its own.' : undefined;
  const setBudget = (patch: Partial<FormState['budget']>) => up('budget', patch);

  const upsellOrCross = retarget && (a.retargetPreset === 'UPSELL' || a.retargetPreset === 'CROSS_SELL');
  const setOptions = (productSets.data || []).map((s) => ({ key: s.id, label: `${s.name}${s.product_count != null ? ` (${s.product_count.toLocaleString('en-IN')} products)` : ''}` }));

  const locationField = (
    <TagSearch<GeoItem>
      type="adgeolocation"
      placeholder="Search countries, states, cities..."
      selected={a.locations}
      onAdd={(g) => up('adset', { locations: [...a.locations, g] })}
      onRemove={(g) => up('adset', { locations: a.locations.filter((x) => x.key !== g.key) })}
      getKey={(g) => `${g.type}-${g.key}`}
      getLabel={(g) => g.name}
      toItem={(r) => ({ key: String(r.key), name: r.type === 'country' ? r.name : `${r.name}${r.region ? `, ${r.region}` : ''}`, type: r.type, country_code: r.country_code })}
      describe={(r) => [r.type === 'region' ? 'State' : r.type === 'city' ? 'City' : 'Country', r.country_name].filter(Boolean).join(' · ')}
    />
  );
  const languageField = (
    <TagSearch<LocaleItem>
      type="adlocale"
      placeholder="Search languages... (leave empty for all)"
      selected={a.locales}
      onAdd={(l) => up('adset', { locales: [...a.locales, l] })}
      onRemove={(l) => up('adset', { locales: a.locales.filter((x) => x.key !== l.key) })}
      getKey={(l) => String(l.key)}
      getLabel={(l) => l.name}
      toItem={(r) => ({ key: Number(r.key), name: r.name })}
    />
  );
  const genderField = <Segmented value={a.gender} onChange={(v) => up('adset', { gender: v })} options={[{ key: 'ALL', label: 'All genders' }, { key: 'MALE', label: 'Men' }, { key: 'FEMALE', label: 'Women' }]} />;
  const interestField = (
    <TagSearch<InterestItem>
      type="adinterest"
      placeholder="Add demographics, interests or behaviors"
      selected={a.interests}
      onAdd={(i) => up('adset', { interests: [...a.interests, i] })}
      onRemove={(i) => up('adset', { interests: a.interests.filter((x) => x.id !== i.id) })}
      getKey={(i) => i.id}
      getLabel={(i) => i.name}
      toItem={(r) => ({ id: String(r.id), name: r.name })}
      describe={(r) => (r.audience_size_upper_bound ? `${Number(r.audience_size_upper_bound).toLocaleString('en-IN')} people` : '')}
    />
  );

  const addInterest = (i: InterestItem) => up('adset', { interests: [...a.interests, i] });
  const customAudienceFields = (hint: string) => (
    <CustomAudiences accountId={account.id} include={a.customAudiences} exclude={a.excludedAudiences} includeHint={hint}
      onInclude={(v) => up('adset', { customAudiences: v })} onExclude={(v) => up('adset', { excludedAudiences: v })} />
  );
  const estimate = !retarget ? <AudienceEstimate accountId={account.id} form={form} ctx={ctx} /> : null;
  // Advantage detailed targeting: Original audience only. For some goals Meta applies it by itself.
  const expansion = a.interests.length || a.audienceType === 'SAVED' ? (
    goal.key === 'VALUE' || goal.key === 'LANDING_PAGE_VIEWS'
      ? <p className="hint">For this performance goal Meta already widens detailed targeting when it expects better results.</p>
      : (
        <Field hint="Lets Meta show your ad to people outside the interests above when that is likely to improve results. If Meta doesn't allow it for your goal, turn it off.">
          <Toggle checked={a.expandInterests} onChange={(v) => up('adset', { expandInterests: v })} label={<span className="strong">Advantage detailed targeting</span>} />
        </Field>
      )
  ) : null;
  const savedSummary = describeTargeting(saved.data?.find((s) => s.id === a.savedAudienceId)?.targeting);

  return (
    <>
      {/* ── Campaign ── */}
      {ctx.needsCampaign ? (
        <>
          <h2 className="section-title">Campaign</h2>
          <div className="card">
            <Field label="Campaign name">
              <TextInput value={c.name} onChange={(e) => up('campaign', { name: e.target.value })} placeholder={c.catalogEnabled ? 'e.g. D2C-Catalog-Retargeting-Oct' : 'e.g. D2C-Sales-Prospecting-Oct'} />
            </Field>
            <Field label="Campaign objective">
              <Select
                value={c.objective}
                disabled={c.catalogEnabled}
                onChange={(v) => up('campaign', { objective: v, catalogEnabled: v === 'OUTCOME_SALES' ? c.catalogEnabled : false })}
                options={OBJECTIVES}
              />
            </Field>
            {c.objective === 'OUTCOME_SALES' ? (
              <Field hint="Set by your ad.">
                <Toggle
                  checked={c.catalogEnabled}
                  onChange={() => undefined}
                  label={<span className="strong">Catalog</span>}
                />
              </Field>
            ) : null}
            <Adv summary={`${c.setup === 'ADVANTAGE_PLUS' ? 'Advantage+ Shopping' : 'Manual setup'} · ${bid.label}`}>
            <Field label="Campaign setup" hint={advantagePlus ? 'Advantage+ uses a campaign budget, Advantage+ Audience and Advantage+ Placements; those choices are locked below.' : undefined}>
              <Segmented value={c.setup} onChange={(v) => up('campaign', { setup: v })} options={[{ key: 'MANUAL', label: 'Manual' }, { key: 'ADVANTAGE_PLUS', label: 'Advantage+ Shopping' }]} />
            </Field>
            <Field label="Bid strategy" hint={b.level === 'ADSET' && b.amount ? 'Applied to the ad set, since the budget is at ad set level.' : undefined}>
              <Select value={bid.key} onChange={(v) => up('campaign', { bidStrategy: v })} options={bids} />
            </Field>
            {bid.needs === 'bid' ? (
              <Field label={bid.key === 'COST_CAP' ? 'Cost per result goal' : 'Bid cap'} hint="Applied to the ad set.">
                <div className="prefix-wrap"><span className="prefix">{sym.trim()}</span>
                  <TextInput inputMode="decimal" value={c.bidAmount} onChange={(e) => up('campaign', { bidAmount: e.target.value.replace(/[^\d.]/g, '') })} placeholder="e.g. 450" />
                </div>
              </Field>
            ) : null}
            {bid.needs === 'roas' ? (
              <Field label="ROAS goal" hint="Minimum return per rupee spent, e.g. 2.5 means ₹2.50 back for every ₹1.">
                <TextInput inputMode="decimal" value={c.roasFloor} onChange={(e) => up('campaign', { roasFloor: e.target.value.replace(/[^\d.]/g, '') })} placeholder="e.g. 2.5" />
              </Field>
            ) : null}
            </Adv>
            {!advantagePlus ? (
              <Field label="Budget level" hint={b.level === 'CAMPAIGN' ? 'One budget for the whole campaign; Meta spreads it across the campaign’s ad sets.' : 'Each ad set gets its own budget, set in the Ad Set card below.'}>
                <Segmented value={b.level} onChange={(v) => setBudget({ level: v })} options={[{ key: 'CAMPAIGN', label: 'Campaign budget' }, { key: 'ADSET', label: 'Ad set budget' }]} />
              </Field>
            ) : null}
            <BudgetField
              level="CAMPAIGN"
              label="Campaign budget"
              hint="Advantage+ campaign budget: Meta spreads it across the ad sets."
              budget={b}
              onChange={setBudget}
              symbol={sym}
              disabledReason={campaignBudgetReason}
            />
          </div>
        </>
      ) : null}

      {/* ── Catalog ── */}
      {ctx.isCatalog ? (
        <>
          <h2 className="section-title">Catalog</h2>
          <CatalogPanel
            account={account}
            catalogId={ctx.catalogId}
            locked
            onCatalog={(id) => { up('campaign', { catalogId: id }); up('adset', { productSetId: '', crossSellSourceSetId: '' }); }}
            productSets={productSets.data || []}
            productSetsLoading={productSets.loading}
            productSetsError={productSets.error}
            productSetId={a.productSetId}
            onProductSet={(id) => up('adset', { productSetId: id })}
            pixelId={a.pixelId}
            onReady={setCatalogReady}
            pixels={pixels.data || []}
            pixelsLoading={pixels.loading}
            onPixel={(id) => up('adset', { pixelId: id })}
          />
        </>
      ) : null}

      {/* ── Ad set (Ads Manager sections: Conversion, Budget & schedule, Audience, Placements) ── */}
      <h2 className="section-title">Ad Set</h2>
      <div className="card">
        <Field label="Ad set name">
          <TextInput value={a.name} onChange={(e) => up('adset', { name: e.target.value })} placeholder={ctx.isCatalog ? 'e.g. Catalog - Viewed or added to cart 14d' : 'e.g. Advantage+ Audience - Broad'} />
        </Field>

        {/* Conversion */}
        <div className="subhead">Conversion</div>
        {(() => {
          const location = goal.destination === 'WEBSITE' || ctx.isCatalog ? (
            <Field label="Conversion location" hint="Other conversion locations (app, messaging, calls) aren't supported in this launcher.">
              <Segmented value="WEBSITE" onChange={() => undefined} options={[{ key: 'WEBSITE', label: 'Website' }]} />
            </Field>
          ) : null;
          const goalField = (
            <Field label="Performance goal">
              <Select value={goal.key} onChange={(v) => up('adset', { goal: v })} options={goals} />
            </Field>
          );
          const dataset = ctx.isCatalog ? (
            <Field label="Dataset (pixel)" hint="Chosen in the Catalog card, where its link to the catalog is checked.">
              <TextInput readOnly value={(() => { const px = pixels.data?.find((p) => p.id === a.pixelId); return px ? `${px.name} (${px.id})` : 'Select it in the Catalog card'; })()} aria-label="Dataset" />
            </Field>
          ) : goal.pixel ? (
            <Field label="Dataset (pixel)">
              {pixels.loading ? <Loading /> : pixels.error ? <div className="notice bad">{pixels.error}</div> : (
                <Select value={a.pixelId} onChange={(v) => up('adset', { pixelId: v })} placeholder="Select a dataset (pixel)..." options={(pixels.data || []).map((p) => ({ key: p.id, label: `${p.name} (${p.id})` }))} />
              )}
            </Field>
          ) : null;
          const event = goal.pixel ? (
            <Field label="Conversion event">
              <Select value={goal.fixedEvent || a.event} disabled={!!goal.fixedEvent} onChange={(v) => up('adset', { event: v })} options={CONVERSION_EVENTS} />
            </Field>
          ) : null;
          const attribution = goal.attribution ? (
            <Field label="Attribution setting" hint="Some ad accounts lock this at the account level — if so, Facebook's own rejection message shows up at launch time.">
              <Select value={a.attribution} onChange={(v) => up('adset', { attribution: v })} options={ATTRIBUTION} />
            </Field>
          ) : null;
          const summary = [goal.pixel ? CONVERSION_EVENTS.find((e) => e.key === (goal.fixedEvent || a.event))?.label : '', goal.attribution ? ATTRIBUTION.find((x) => x.key === a.attribution)?.label : ''].filter(Boolean).join(' · ') || 'Website';
          return <>{dataset}{goalField}<Adv summary={summary}>{location}{event}{attribution}</Adv></>;
        })()}

        {/* Budget & schedule */}
        <div className="subhead">Budget &amp; schedule</div>
        <BudgetField
          level="ADSET"
          label="Ad set budget"
          budget={b}
          onChange={setBudget}
          symbol={sym}
          disabledReason={adsetBudgetReason}
        />
        <div className="row field">
          <Field label="Start date" hint="Leave empty to start as soon as it's published.">
            <TextInput type="datetime-local" value={a.startTime} onChange={(e) => up('adset', { startTime: e.target.value })} />
          </Field>
          <Field label={b.type === 'LIFETIME' ? 'End date' : 'End date (optional)'} hint={b.type === 'LIFETIME' ? 'Required with a lifetime budget.' : 'Leave empty to run continuously.'}>
            <TextInput type="datetime-local" value={b.endDate} onChange={(e) => setBudget({ endDate: e.target.value })} />
          </Field>
        </div>

        {/* Audience */}
        <div className="subhead">Audience</div>
        {ctx.isCatalog ? (
          <div className="subcard">
            <div className="label strong" style={{ marginBottom: 10 }}>Catalog · {setOptions.find((s) => s.key === a.productSetId)?.label || 'pick a product set in the Catalog card'}</div>
            <Segmented
              value={a.catalogAudience}
              onChange={(v) => up('adset', { catalogAudience: v })}
              options={[
                { key: 'RETARGET', label: 'Retarget ads to people who interacted with your products' },
                { key: 'BROAD', label: 'Broad audience' },
              ]}
            />
            {retarget ? (
              <>
                <Field label="Retargeting option">
                  <Select value={a.retargetPreset} onChange={(v) => up('adset', { retargetPreset: v })} options={RETARGET_PRESETS} />
                </Field>
                {upsellOrCross ? (
                  <Field
                    label="Product set people interacted with"
                    hint={a.retargetPreset === 'UPSELL'
                      ? 'People who viewed or added these products to cart are shown products from the chosen product set.'
                      : 'People who purchased these products are shown products from the chosen product set.'}
                  >
                    <Select value={a.crossSellSourceSetId} onChange={(v) => up('adset', { crossSellSourceSetId: v })} options={setOptions} placeholder="Select a product set…" />
                  </Field>
                ) : null}
                {a.retargetPreset === 'CUSTOM' ? (
                  <>
                    <Field label="Include people who">
                      <CheckPills value={a.retargetEvents} onChange={(v) => up('adset', { retargetEvents: v })} options={CATALOG_EVENTS} />
                    </Field>
                    <Field>
                      <Toggle checked={a.excludePurchasers} onChange={(v) => up('adset', { excludePurchasers: v })} label="Exclude people who purchased" />
                    </Field>
                  </>
                ) : null}
                <div className="row field">
                  <Field label="In the past">
                    <Select value={String(a.retargetDays)} onChange={(v) => up('adset', { retargetDays: Number(v) })} options={RETARGET_DAYS} />
                  </Field>
                  {a.retargetPreset === 'CUSTOM' && a.excludePurchasers ? (
                    <Field label="Exclude people who purchased in the past">
                      <Select value={String(a.excludeDays)} onChange={(v) => up('adset', { excludeDays: Number(v) })} options={RETARGET_DAYS} />
                    </Field>
                  ) : null}
                </div>
              </>
            ) : null}
          </div>
        ) : null}

        {!retarget ? (
          <Field>
            <Segmented
              value={a.audienceType === 'ADVANTAGE' ? 'ADVANTAGE' : 'ORIGINAL'}
              onChange={(v) => up('adset', v === 'ADVANTAGE' ? { audienceType: 'ADVANTAGE', ageMin: Math.min(a.ageMin, 25) } : { audienceType: a.savedAudienceId ? 'SAVED' : 'INTEREST' })}
              options={[
                { key: 'ADVANTAGE', label: 'Advantage+ audience' },
                { key: 'ORIGINAL', label: 'Original audience options', disabled: advantagePlus, title: advantagePlus ? 'Not available with Advantage+ Shopping' : undefined },
              ]}
            />
          </Field>
        ) : null}

        {!retarget && (a.audienceType === 'INTEREST' || a.audienceType === 'SAVED') ? (
          <Field label="Use saved audience">
            {saved.loading ? <Loading /> : saved.error ? <div className="notice bad">{saved.error}</div> : (
              <Select
                value={a.savedAudienceId}
                onChange={(v) => up('adset', { savedAudienceId: v, audienceType: v ? 'SAVED' : 'INTEREST' })}
                options={[{ key: '', label: 'None' }, ...(saved.data || []).map((s) => ({ key: s.id, label: s.name }))]}
              />
            )}
          </Field>
        ) : null}
        {!retarget && a.audienceType === 'SAVED' ? (
          <>
            {savedSummary ? <p className="hint" style={{ marginTop: 0 }}>This saved audience: {savedSummary}</p> : null}
            <p className="hint">Its own location, age, gender and detailed targeting are used. What you add below is added on top of it.</p>
            <Field label="Detailed targeting" hint="Added to the saved audience's own detailed targeting.">{interestField}</Field>
            <InterestSuggestions interests={a.interests} onAdd={addInterest} />
            {customAudienceFields('Added to the saved audience’s own custom audiences.')}
            {expansion}
            {estimate}
          </>
        ) : null}

        {!retarget && a.audienceType === 'ADVANTAGE' ? (
          <>
            <div className="label strong" style={{ marginTop: 14 }}>Audience controls</div>
            <Field label="Locations">{locationField}</Field>
            <Field label="Minimum age" hint="Meta won't show ads to anyone younger. Advantage+ audience allows up to 25.">
              <Select value={String(Math.min(a.ageMin, 25))} onChange={(v) => up('adset', { ageMin: Number(v) })} options={AGES.filter((n) => n <= 25).map((n) => ({ key: String(n), label: String(n) }))} />
            </Field>
            <div className="label strong" style={{ marginTop: 18 }}>Audience suggestion (optional)</div>
            <p className="hint" style={{ marginTop: 0 }}>Meta starts with these, then looks beyond them when it finds people likely to convert.</p>
            <div className="row field">
              <Field label="Age">
                <Select value={String(Math.max(a.ageMin, 18))} disabled onChange={() => undefined} options={[{ key: String(Math.max(a.ageMin, 18)), label: String(Math.max(a.ageMin, 18)) }]} />
              </Field>
              <Field label="to">
                <Select value={String(a.ageMax)} onChange={(v) => up('adset', { ageMax: Number(v) })} options={AGES.filter((n) => n >= a.ageMin).map((n) => ({ key: String(n), label: n === 65 ? '65+' : String(n) }))} />
              </Field>
            </div>
            <Field label="Gender">{genderField}</Field>
            <Field label="Detailed targeting">{interestField}</Field>
            <InterestSuggestions interests={a.interests} onAdd={addInterest} />
            {customAudienceFields('Suggestions: Meta starts with these, then looks beyond them.')}
            {estimate}
          </>
        ) : null}

        {retarget || a.audienceType === 'INTEREST' ? (
          <>
            {!retarget && a.audienceType === 'INTEREST' ? customAudienceFields('Customer lists, website visitors and lookalikes to reach.') : null}
            <Field label="Locations">{locationField}</Field>
            <div className="row field">
              <Field label="Age">
                <Select value={String(a.ageMin)} onChange={(v) => up('adset', { ageMin: Number(v) })} options={AGES.filter((n) => n < 65).map((n) => ({ key: String(n), label: String(n) }))} />
              </Field>
              <Field label="to">
                <Select value={String(a.ageMax)} onChange={(v) => up('adset', { ageMax: Number(v) })} options={AGES.map((n) => ({ key: String(n), label: n === 65 ? '65+' : String(n) }))} />
              </Field>
            </div>
            <Field label="Gender">{genderField}</Field>
            {!retarget && a.audienceType === 'INTEREST' ? <Field label="Detailed targeting" hint="Include people who match any of these. Leave empty for broad.">{interestField}</Field> : null}
            {!retarget && a.audienceType === 'INTEREST' ? <InterestSuggestions interests={a.interests} onAdd={addInterest} /> : null}
            {!retarget && a.audienceType === 'INTEREST' ? expansion : null}
            {!retarget && a.audienceType === 'INTEREST' ? estimate : null}
          </>
        ) : null}

        {/* Placements */}
        {(() => {
          const placements = (
            <>
              <Field label="Placements">
                <Segmented
                  value={a.placement}
                  onChange={(v) => up('adset', { placement: v })}
                  options={[
                    { key: 'ADVANTAGE', label: 'Advantage+ placements (recommended)' },
                    { key: 'MANUAL', label: 'Manual placements', disabled: advantagePlus, title: advantagePlus ? 'Not available with Advantage+ Shopping' : undefined },
                  ]}
                />
              </Field>
              {a.placement === 'MANUAL' ? (
                <>
                  <div className="field" style={{ marginTop: 10 }}>
                    <CheckPills value={a.platforms} onChange={(v) => up('adset', { platforms: v })} options={PLATFORMS} />
                  </div>
                  <Positions a={a} set={(p) => up('adset', p)} />
                </>
              ) : null}
              {a.placement === 'MANUAL' || a.devices !== 'ALL' ? <Devices a={a} set={(p) => up('adset', p)} /> : null}
            </>
          );
          const summary = `${placementSummary(a)} · ${a.locales.length ? a.locales.map((l) => l.name).join(', ') : 'All languages'}`;
          return <Adv summary={summary}>{placements}<Field label="Languages">{languageField}</Field></Adv>;
        })()}
      </div>
    </>
  );
}
