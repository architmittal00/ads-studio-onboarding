'use client';
import { ArrowLeft, ArrowRight, Check, ImageIcon, LayoutGrid, Newspaper } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { apiGet } from '@/launch-ad/lib/client-api';
import { CATALOG_AD_TEXT, buildContext, validateAd } from '@/launch-ad/lib/form';
import { currencySymbol, goalsFor, objectiveLabel } from '@/launch-ad/lib/constants';
import { useAsync } from '@/launch-ad/lib/hooks';
import type { AdAccount, FormState, LaunchResult, Mode } from '@/launch-ad/lib/types';
import AdPreview from './AdPreview';
import AdSection from './AdSection';
import AdsetFacts from './AdsetFacts';
import { Field, Select } from './ui';
import { AdOnlyPanel } from './AdOnlyReview';
import CatalogPanel from './CatalogPanel';
import DestinationTree, { adsetBudget, type Destination } from './DestinationTree';
import LaunchForm, { type ProductSet } from './LaunchForm';
import { adsetFit, budgetText } from './Pickers';
import { ReviewPanel } from './ReviewPanel';
import StandardAdSection from './StandardAdSection';

type Step = 'AD' | 'DEST' | 'SETTINGS' | 'REVIEW';
type AdType = 'CATALOG' | 'UPLOAD' | 'POST';
interface Missing { key: string; label: string }

const AD_TYPES: { key: AdType; title: string; text: string; icon: ReactNode }[] = [
  { key: 'CATALOG', title: 'Catalog ad', text: 'Products from your catalog, picked for each shopper. Carousel or single.', icon: <LayoutGrid size={18} /> },
  { key: 'UPLOAD', title: 'Image or video ad', text: 'One image or video with your own text, link and button.', icon: <ImageIcon size={18} /> },
  { key: 'POST', title: 'Existing post', text: 'Promote a Facebook or Instagram post as it is.', icon: <Newspaper size={18} /> },
];

/**
 * "Start with an Ad" workspace: a step rail on the left, one step at a time in the middle, the live
 * preview and destination summary on the right, and an action bar that says what's blocking.
 */
export default function AdFirstWorkspace({ account, form, setForm, onDone, repeatOf, catalogOnly = false }: {
  account: AdAccount;
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  onDone: (r: LaunchResult) => void;
  /** Reusing the ad just launched: start on Destination; name of the ad set it went into */
  repeatOf?: string;
  /** Catalog Ads > Create ad: catalog ads only (no image/video or existing post) */
  catalogOnly?: boolean;
}) {
  const [step, setStep] = useState<Step>(repeatOf ? 'DEST' : 'AD');
  // An ad that arrives with content (repeat, or kept across an ad account switch) keeps its type.
  const [type, setType] = useState<AdType | null>(catalogOnly ? 'CATALOG' : repeatOf || form.ad.name ? (form.ad.kind === 'CATALOG' || form.ad.kind === 'POST' ? form.ad.kind : 'UPLOAD') : null);
  const [dest, setDest] = useState<Destination | null>(null);
  const [settingsMissing, setSettingsMissing] = useState<Missing[]>([{ key: 'settings', label: 'Ad set settings' }]);
  const [catalogReady, setCatalogReady] = useState(false);
  const mainRef = useRef<HTMLDivElement>(null);
  const sideRef = useRef<HTMLElement>(null);
  const sideInner = useRef<HTMLDivElement>(null);

  // The preview column is sticky: keep it no taller than the room left in the window and scroll inside it,
  // with a fade at the bottom while there is more to see.
  useEffect(() => {
    const el = sideRef.current; const inner = sideInner.current;
    if (!el || !inner) return;
    let raf = 0;
    const fit = () => {
      raf = 0;
      if (getComputedStyle(el).position !== 'sticky') { el.style.maxHeight = ''; el.dataset.more = '0'; return; }
      const room = window.innerHeight - el.getBoundingClientRect().top - 16;
      el.style.maxHeight = `${Math.max(240, Math.floor(room))}px`;
      el.dataset.more = el.scrollHeight - el.scrollTop - el.clientHeight > 6 ? '1' : '0';
    };
    const queue = () => { if (!raf) raf = requestAnimationFrame(fit); };
    fit();
    const ro = new ResizeObserver(queue); ro.observe(inner);
    window.addEventListener('scroll', queue, { passive: true });
    window.addEventListener('resize', queue);
    el.addEventListener('scroll', queue, { passive: true });
    return () => { if (raf) cancelAnimationFrame(raf); ro.disconnect(); window.removeEventListener('scroll', queue); window.removeEventListener('resize', queue); el.removeEventListener('scroll', queue); };
  }, []);

  const isCatalog = form.ad.kind === 'CATALOG';
  const fit = { isCatalog, catalogId: form.campaign.catalogId };
  const adMissing = useMemo<Missing[]>(() => {
    if (!type) return [{ key: 'ad.type', label: 'Ad type' }];
    const m: Missing[] = validateAd(form, isCatalog, true);
    // Catalog ads need a dataset (pixel) linked to the catalog; checked in the Products card.
    if (isCatalog && !form.adset.pixelId) m.push({ key: 'adset.pixelId', label: 'Dataset (pixel)' });
    if (isCatalog && form.adset.pixelId && form.adset.productSetId && !catalogReady) m.push({ key: 'catalog.ready', label: 'Catalog readiness' });
    return m;
  }, [form, isCatalog, type, catalogReady]);
  const needsSettings = !!dest && dest.kind !== 'ADSET';
  const destMissing: Missing[] = dest ? [] : [{ key: 'dest', label: 'Campaign or ad set' }];

  const reach: Record<Step, boolean> = {
    AD: true,
    DEST: !adMissing.length,
    SETTINGS: !adMissing.length && needsSettings,
    REVIEW: !adMissing.length && !!dest && (!needsSettings || !settingsMissing.length),
  };
  const blocking: Missing[] = step === 'AD' ? adMissing : step === 'DEST' ? destMissing : step === 'SETTINGS' ? settingsMissing : [];
  const next: Step | null = step === 'AD' ? 'DEST' : step === 'DEST' ? (needsSettings ? 'SETTINGS' : 'REVIEW') : step === 'SETTINGS' ? 'REVIEW' : null;
  const prev: Step | null = step === 'REVIEW' ? (needsSettings ? 'SETTINGS' : 'DEST') : step === 'SETTINGS' ? 'DEST' : step === 'DEST' ? 'AD' : null;
  const go = (s: Step) => { setStep(s); mainRef.current?.scrollIntoView({ block: 'start' }); window.scrollTo({ top: 0 }); };

  // Editing the ad can make the chosen ad set unsuitable; drop it.
  useEffect(() => {
    if (dest?.kind === 'ADSET' && adsetFit(dest.adset, fit)) setDest(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCatalog, form.campaign.catalogId]);

  const chooseType = (t: AdType) => {
    setType(t);
    setForm((f) => {
      const wasCatalog = f.ad.kind === 'CATALOG';
      const toCatalog = t === 'CATALOG';
      const text = toCatalog && !wasCatalog ? CATALOG_AD_TEXT : !toCatalog && wasCatalog ? { message: '', headline: '', description: '' } : {};
      return {
        ...f,
        campaign: { ...f.campaign, catalogEnabled: toCatalog, objective: toCatalog ? 'OUTCOME_SALES' : f.campaign.objective },
        ad: { ...f.ad, kind: t, ...text },
      };
    });
  };

  const chooseDest = (d: Destination) => {
    setDest(d);
    if (d.kind !== 'ADSET') setSettingsMissing([{ key: 'settings', label: d.kind === 'NEW_CAMPAIGN' ? 'Campaign and ad set settings' : 'Ad set settings' }]);
    if (d.kind === 'NEW_ADSET') {
      const c = d.campaign;
      const level = c.daily_budget || c.lifetime_budget ? 'CAMPAIGN' : 'ADSET';
      const goal = goalsFor(c.objective, !!c.promoted_object?.product_catalog_id)[0].key;
      setForm((f) => ({ ...f, budget: { ...f.budget, level }, adset: { ...f.adset, goal } }));
    }
    if (d.kind === 'NEW_CAMPAIGN') {
      setForm((f) => ({ ...f, campaign: { ...f.campaign, catalogEnabled: isCatalog, objective: isCatalog ? 'OUTCOME_SALES' : f.campaign.objective } }));
    }
  };

  const productSets = useAsync<ProductSet[]>(isCatalog && form.campaign.catalogId ? `sets-${form.campaign.catalogId}` : null, () => apiGet('product-sets', { catalog: form.campaign.catalogId }));
  const pixels = useAsync<{ id: string; name: string }[]>(`pixels-${account.id}`, () => apiGet('pixels', { account: account.id }));
  useEffect(() => {
    const sets = productSets.data;
    if (sets?.length && form.adset.productSetId && !sets.some((s) => s.id === form.adset.productSetId)) setForm((f) => ({ ...f, adset: { ...f.adset, productSetId: '' } }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productSets.data]);

  // One dataset (pixel) in the account: use it.
  useEffect(() => {
    if (pixels.data?.length === 1 && !form.adset.pixelId) setForm((f) => ({ ...f, adset: { ...f.adset, pixelId: pixels.data![0].id } }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pixels.data]);
  const setPixel = (id: string) => setForm((f) => ({ ...f, adset: { ...f.adset, pixelId: id } }));

  const setCount = productSets.data?.find((x) => x.id === form.adset.productSetId)?.product_count;
  const setAd = (p: Partial<FormState['ad']>) => setForm((f) => ({ ...f, ad: { ...f.ad, ...p } }));
  const mode: Mode = dest?.kind === 'NEW_CAMPAIGN' ? 'NEW' : dest?.kind === 'NEW_ADSET' ? 'EXISTING' : 'AD_ONLY';

  // The step bar names the steps only; the names of the ad, campaign and ad set live in the "Runs in" card.
  const STEPS: { key: Step; title: string; sub: string }[] = [
    { key: 'AD', title: 'Ad', sub: catalogOnly ? 'Product set and text' : 'Type, creative and text' },
    { key: 'DEST', title: 'Campaign & ad set', sub: 'Existing or new' },
    { key: 'SETTINGS', title: 'Setup', sub: 'Only for a new ad set or campaign' },
    { key: 'REVIEW', title: 'Review', sub: 'Check and launch' },
  ];
  // "Still needed" chips take you to the field: match its label, scroll, focus and flash it.
  const jumpTo = (m: Missing) => {
    const want = m.label.replace(/\s*\(.*\)\s*/, '').toLowerCase();
    const labels = Array.from(document.querySelectorAll<HTMLElement>('.ws-main .field > .label, .ws-main .health .label, .ws-main .ws-section'));
    const hit = labels.find((l) => (l.textContent || '').trim().toLowerCase() === want)
      || labels.find((l) => (l.textContent || '').trim().toLowerCase().startsWith(want))
      || labels.find((l) => (l.textContent || '').toLowerCase().includes(want));
    const box = (hit?.closest('.field') || hit) as HTMLElement | null;
    if (!box) { mainRef.current?.scrollIntoView({ behavior: 'smooth' }); return; }
    // Open any collapsed Advanced section the field sits in.
    let d = box.closest('details'); while (d) { d.setAttribute('open', ''); d = d.parentElement?.closest('details') || null; }
    box.scrollIntoView({ behavior: 'smooth', block: 'center' });
    box.classList.remove('flash'); void box.offsetWidth; box.classList.add('flash');
    setTimeout(() => box.querySelector<HTMLElement>('input:not([readonly]), textarea, select, button')?.focus({ preventScroll: true }), 350);
  };

  const doneOf = (s: Step) => (s === 'AD' ? !adMissing.length : s === 'DEST' ? !!dest : s === 'SETTINGS' ? needsSettings && !settingsMissing.length : false);

  // Named for what comes next, which depends on the pick in step 2.
  const nextLabel = next === 'DEST' ? 'Choose campaign & ad set'
    : next === 'SETTINGS' ? (dest?.kind === 'NEW_CAMPAIGN' ? 'Set up campaign & ad set' : 'Set up ad set')
    : 'Review';
  // Continue never dead-ends: with something missing it takes you to the first missing field.
  const proceed = () => { if (!next) return; if (blocking.length) { jumpTo(blocking[0]); return; } go(next); };

  return (
    <div className="ws">
      {/* Step bar: back, the four steps, continue */}
      <nav className="ws-bar" aria-label="Steps">
        {prev ? (
          <button type="button" className="icon-btn ws-back" onClick={() => go(prev)} aria-label="Back" title="Back">
            <ArrowLeft size={16} />
          </button>
        ) : null}
        <ol className="ws-steps">
          {STEPS.map((s, i) => {
            const skipped = s.key === 'SETTINGS' && !!dest && !needsSettings;
            const state = step === s.key ? 'current' : skipped ? 'skipped' : doneOf(s.key) ? 'done' : reach[s.key] ? 'open' : 'locked';
            return (
              <li key={s.key} className={state}>
                <button type="button" className={`ws-step ${state}`} disabled={!reach[s.key] || skipped} onClick={() => go(s.key)} aria-current={step === s.key ? 'step' : undefined} title={s.sub}>
                  <span className="no">{state === 'done' ? <Check size={12} strokeWidth={3} /> : i + 1}</span>
                  <span className="txt"><span className="t">{s.title}</span><span className="s">{s.sub}</span></span>
                </button>
              </li>
            );
          })}
        </ol>
        {next ? (
          <button type="button" className={`btn-primary ws-next ${blocking.length ? 'blocked' : ''}`} onClick={proceed} title={blocking.length ? `Still needed: ${blocking.map((m) => m.label).join(', ')}` : undefined}>
            {nextLabel} <ArrowRight size={14} />
          </button>
        ) : <span className="ws-next-spacer" />}
      </nav>
      {repeatOf ? (
        <div className="ws-draft">Same ad as the one you just added to <b>{repeatOf}</b>. Pick another campaign or ad set, or edit the ad first.</div>
      ) : null}

      <div className="ws-body">
      {/* Current step */}
      <div className="ws-main" ref={mainRef}>
        {step === 'AD' ? (
          <>
            <StepHead
              title={catalogOnly ? 'Create your catalog ad' : 'Create your ad'}
              sub={catalogOnly ? 'Pick the catalog and product set, then add the ad\u2019s text. The preview on the right shows real products.' : 'Pick the kind of ad, then add its creative and text. The preview on the right updates as you type.'}
            />
            {!catalogOnly ? <div className="type-cards" role="radiogroup" aria-label="Ad type">
              {AD_TYPES.map((t) => (
                <button key={t.key} type="button" role="radio" aria-checked={type === t.key} className={`type-card ${type === t.key ? 'on' : ''}`} onClick={() => chooseType(t.key)}>
                  <span className="ic">{t.icon}</span>
                  <span className="tt">{t.title}</span>
                  <span className="tx">{t.text}</span>
                </button>
              ))}
            </div> : null}
            {type === 'CATALOG' ? (
              <>
                <SectionTitle>Products</SectionTitle>
                <CatalogPanel
                  account={account}
                  catalogId={form.campaign.catalogId}
                  locked={false}
                  onCatalog={(id) => setForm((f) => ({ ...f, campaign: { ...f.campaign, catalogId: id }, adset: { ...f.adset, productSetId: '', crossSellSourceSetId: '' } }))}
                  productSets={productSets.data || []}
                  productSetsLoading={productSets.loading}
                  productSetsError={productSets.error}
                  productSetId={form.adset.productSetId}
                  onProductSet={(id) => setForm((f) => ({ ...f, adset: { ...f.adset, productSetId: id } }))}
                  pixelId={form.adset.pixelId}
                  onReady={setCatalogReady}
                  pixels={pixels.data || []}
                  pixelsLoading={pixels.loading}
                  onPixel={setPixel}
                />
                <SectionTitle>Ad details</SectionTitle>
                <AdSection form={form} setAd={setAd} />
              </>
            ) : type ? (
              <>
                <SectionTitle>Ad details</SectionTitle>
                <StandardAdSection key={type} form={form} setAd={setAd} accountId={account.id} />
                <SectionTitle>Tracking</SectionTitle>
                <div className="card">
                  <Field label="Dataset (pixel)" hint={form.adset.pixelId ? 'Website events from this ad (purchases, add to cart) are tracked with this dataset.' : 'Recommended: without it, Ads Manager won\u2019t track website events for this ad.'}>
                    <Select value={form.adset.pixelId} onChange={setPixel} placeholder="Select a dataset (pixel)..." options={(pixels.data || []).map((p) => ({ key: p.id, label: `${p.name} (${p.id})` }))} />
                  </Field>
                </div>
              </>
            ) : null}
          </>
        ) : step === 'DEST' ? (
          <>
            <StepHead title="Which campaign and ad set should run this ad?" sub={`Pick an existing ad set, create a new ad set in a campaign, or create a new campaign. Only campaigns and ad sets this ${isCatalog ? 'catalog ad' : 'ad'} can go into are shown.`} />
            <DestinationTree account={account} fit={fit} value={dest} onChange={chooseDest} />
            {dest?.kind === 'ADSET' ? (
              <>
                <SectionTitle>This ad set</SectionTitle>
                <div className="card"><AdsetFacts adset={dest.adset} account={account} /><p className="hint" style={{ marginBottom: 0 }}>Your ad joins this ad set as it is: its budget, audience and schedule don&apos;t change.</p></div>
              </>
            ) : null}
          </>
        ) : step === 'SETTINGS' && dest && dest.kind !== 'ADSET' ? (
          <>
            <StepHead
              title={dest.kind === 'NEW_CAMPAIGN' ? 'Set up the campaign and ad set' : `Set up the ad set in ${dest.campaign.name}`}
              sub="Budget, audience and schedule for your ad. Everything else uses Meta's recommended defaults."
            />
            <LaunchForm
              key={dest.kind === 'NEW_ADSET' ? `ws-adset-${dest.campaign.id}` : 'ws-campaign'}
              mode={dest.kind === 'NEW_CAMPAIGN' ? 'NEW' : 'EXISTING'}
              account={account}
              form={form}
              setForm={setForm}
              campaign={dest.kind === 'NEW_ADSET' ? dest.campaign : undefined}
              onMissing={setSettingsMissing}
            />
          </>
        ) : step === 'REVIEW' && dest ? (
          <>
            <StepHead title="Review and launch" sub="This is what will be created in Meta. Everything starts paused unless you choose otherwise." />
            <div className="review-account">In ad account <b>{account.name}</b></div>
            <StructureMap account={account} form={form} dest={dest} />
            <div className="card" style={{ marginTop: 14 }}>
              {dest.kind === 'ADSET' ? (
                <AdOnlyPanel account={account} form={form} target={dest.adset} productSets={productSets.data || []} onDone={onDone} />
              ) : (
                <ReviewPanel
                  mode={mode}
                  account={account}
                  form={form}
                  ctx={buildContext(mode, form, dest.kind === 'NEW_ADSET' ? dest.campaign : undefined)}
                  campaign={dest.kind === 'NEW_ADSET' ? dest.campaign : undefined}
                  productSets={productSets.data || []}
                  pixels={pixels.data || []}
                  onDone={onDone}
                />
              )}
            </div>
          </>
        ) : null}

        {/* Action bar */}
        {step !== 'REVIEW' ? (
          <div className="sticky-bar ws-foot">
            <span className="sticky-text">
              {blocking.length ? <>Still needed: {blocking.map((m) => <button type="button" key={m.key} className="need" onClick={() => jumpTo(m)} title="Go to this field">{m.label}</button>)}</> : <span className="ready">Ready to continue</span>}
            </span>
            {next ? (
              <button type="button" className={`btn-primary ${blocking.length ? 'blocked' : ''}`} onClick={proceed}>
                {nextLabel} <ArrowRight size={14} />
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Live preview and destination summary */}
      <aside className="ws-side" aria-label="Preview" ref={sideRef}>
        <div className="ws-side-inner" ref={sideInner}>
        {type ? <AdPreview form={form} total={isCatalog ? setCount : undefined} /> : <div className="preview"><div className="preview-empty">Pick an ad type to see a preview.</div></div>}
        {dest ? (() => {
          const campaignName = dest.kind === 'NEW_CAMPAIGN' ? form.campaign.name || 'New campaign' : dest.kind === 'NEW_ADSET' ? dest.campaign.name : dest.adset.campaign?.name || '–';
          const adsetName = dest.kind === 'ADSET' ? dest.adset.name : form.adset.name || 'New ad set';
          const budget = dest.kind === 'ADSET'
            ? (dest.adset.daily_budget || dest.adset.lifetime_budget ? `${adsetBudget(dest.adset, account.currency)} ad set budget` : dest.adset.campaign ? `${budgetText(dest.adset.campaign, account.currency)} campaign budget` : '')
            : form.budget.amount ? `${currencySymbol(account.currency)}${Number(form.budget.amount).toLocaleString('en-IN')}${form.budget.type === 'DAILY' ? '/day' : ' lifetime'} ${form.budget.level === 'ADSET' ? 'ad set' : 'campaign'} budget` : '';
          return (
            <div className="card ws-dest">
              <div className="label" style={{ marginBottom: 8 }}>Runs in</div>
              <dl className="runs-in">
                <dt>Campaign</dt><dd>{campaignName}{dest.kind === 'NEW_CAMPAIGN' ? <span className="tag">New</span> : null}</dd>
                <dt>Ad set</dt><dd>{adsetName}{dest.kind !== 'ADSET' ? <span className="tag">New</span> : null}</dd>
                <dt>Ad</dt><dd>{form.ad.name || '–'}<span className="tag">New</span></dd>
              </dl>
              {budget ? <div className="hint budget-line">{budget}</div> : null}
              {step !== 'DEST' ? <button type="button" className="btn-link" style={{ marginTop: 8 }} onClick={() => go('DEST')}>Change</button> : null}
            </div>
          );
        })() : null}
        </div>
      </aside>
      </div>
    </div>
  );
}

function StepHead({ title, sub }: { title: string; sub: string }) {
  return <header className="ws-head"><h2>{title}</h2><p>{sub}</p></header>;
}
function SectionTitle({ children }: { children: ReactNode }) {
  return <h3 className="ws-section">{children}</h3>;
}

/** Campaign → ad set → ad, each marked new or existing, with what it spends. */
function StructureMap({ account, form, dest }: { account: AdAccount; form: FormState; dest: Destination }) {
  const sym = currencySymbol(account.currency);
  const newBudget = form.budget.amount ? `${sym}${Number(form.budget.amount).toLocaleString('en-IN')}${form.budget.type === 'DAILY' ? '/day' : ' lifetime'}` : '';
  const campaign = dest.kind === 'ADSET' ? dest.adset.campaign : dest.kind === 'NEW_ADSET' ? dest.campaign : undefined;
  const nodes: { level: string; isNew: boolean; name: string; meta: string }[] = [
    {
      level: 'Campaign',
      isNew: dest.kind === 'NEW_CAMPAIGN',
      name: dest.kind === 'NEW_CAMPAIGN' ? form.campaign.name || 'New campaign' : campaign?.name || '',
      meta: dest.kind === 'NEW_CAMPAIGN'
        ? [objectiveLabel(form.campaign.objective), form.budget.level === 'CAMPAIGN' && newBudget ? `${newBudget} campaign budget` : 'Ad set budget'].join(' · ')
        : campaign ? [objectiveLabel(campaign.objective), budgetText(campaign, account.currency)].join(' · ') : '',
    },
    {
      level: 'Ad set',
      isNew: dest.kind !== 'ADSET',
      name: dest.kind === 'ADSET' ? dest.adset.name : form.adset.name || 'New ad set',
      meta: dest.kind === 'ADSET'
        ? (dest.adset.daily_budget || dest.adset.lifetime_budget ? `${adsetBudget(dest.adset, account.currency)} ad set budget` : 'Uses the campaign budget')
        : (form.budget.level === 'ADSET' && newBudget ? `${newBudget} ad set budget` : campaign && (campaign.daily_budget || campaign.lifetime_budget) ? 'Uses the campaign budget' : newBudget ? 'Uses the campaign budget' : ''),
    },
    {
      level: 'Ad',
      isNew: true,
      name: form.ad.name || 'Your ad',
      meta: form.ad.kind === 'CATALOG' ? `Catalog ad · ${form.ad.format === 'CAROUSEL' ? 'Carousel' : 'Single'}` : form.ad.kind === 'POST' ? 'Existing post' : form.ad.videoId ? 'Video ad' : 'Image ad',
    },
  ];
  return (
    <div className="structure">
      {nodes.map((n, i) => (
        <div key={n.level} className="node" style={{ marginLeft: i * 22 }}>
          <span className={`tag ${n.isNew ? 'new' : ''}`}>{n.isNew ? 'New' : 'Existing'}</span>
          <span className="lvl">{n.level}</span>
          <span className="nm">{n.name}</span>
          <span className="mt">{n.meta}</span>
        </div>
      ))}
    </div>
  );
}
