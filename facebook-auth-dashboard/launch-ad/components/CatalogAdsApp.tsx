'use client';
import { ArrowDown, ArrowUp, Search } from 'lucide-react';
import { ChartIcon } from '@/components/icons';
import styles from '@/styles/Home.module.css';
import { useEffect, useMemo, useState } from 'react';
import { apiGet } from '@/launch-ad/lib/client-api';
import { currencySymbol } from '@/launch-ad/lib/constants';
import { adFirstForm, clearAccountBound, repeatForm } from '@/launch-ad/lib/form';
import { useAsync } from '@/launch-ad/lib/hooks';
import { useIsMobile } from '@/lib/useIsMobile';
import { totals, rowMetrics, STATUS_TONE, type Row, type Catalog } from '@/launch-ad/lib/catalog-perf';
import type { AdAccount, FormState, LaunchResult } from '@/launch-ad/lib/types';
import AdFirstWorkspace from './AdFirstWorkspace';
import { SetChecks, SetThumbs, type SetHealth, type SetLite } from './CatalogPanel';
import PageHeader, { AccountNotices, AdAccountPill, RangePill, RefreshPill, presetRange, type Range } from './PageHeader';
import PartnershipEmptyState from '@/components/partnership/PartnershipEmptyState';
import LegalLinks from './LegalLinks';
import { statusLabel } from './Pickers';
import ResultView from './ResultView';
import { Loading, SearchSelect } from './ui';
import { MobileAdList, MobileContext, MobileOverview, MobileSets, MobileTabs } from './CatalogAdsMobile';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const PartnershipEmptyStateC = PartnershipEmptyState as any;

type Tab = 'overview' | 'ads' | 'sets' | 'create';
const TABS: { key: Tab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'ads', label: 'My Catalog Ads' },
  { key: 'sets', label: 'Product Sets' },
  { key: 'create', label: 'Create Ad' },
];

/** Catalog Ads: compare catalog ads with other ads, see each catalog ad, browse product sets, and create catalog ads. */
export default function CatalogAdsApp({ declined }: { declined: string[] }) {
  const isMobile = useIsMobile();
  const accounts = useAsync<AdAccount[]>('accounts', () => apiGet('adaccounts'));
  const [accountId, setAccountId] = useState('');
  const [range, setRange] = useState<Range>(() => presetRange('last_30d'));
  const [tick, setTick] = useState(0);
  const [tab, setTabState] = useState<Tab>('overview');
  // Overview waits for "Check Performance"; the other tabs load on their own (and count as checked).
  const [checked, setChecked] = useState(false);
  // Create Ad state
  const [form, setForm] = useState<FormState>(() => adFirstForm({ catalogId: '', productSetId: '' }));
  const [wsKey, setWsKey] = useState(0);
  const [result, setResult] = useState<LaunchResult | null>(null);
  const [lastAd, setLastAd] = useState<{ form: FormState; adsetName: string } | null>(null);
  const [repeatOf, setRepeatOf] = useState('');

  useEffect(() => {
    if (window.location.hash === '#_=_') window.history.replaceState(null, '', window.location.pathname + window.location.search);
    const t = new URLSearchParams(window.location.search).get('tab') as Tab | null;
    if (t && TABS.some((x) => x.key === t)) setTabState(t);
  }, []);
  useEffect(() => { if (accounts.data?.length && !accountId) setAccountId(accounts.data[0].id); }, [accounts.data, accountId]);

  const setTab = (t: Tab) => {
    setTabState(t);
    const u = new URL(window.location.href); u.searchParams.set('tab', t); window.history.replaceState(null, '', u.toString());
    window.scrollTo({ top: 0 });
  };
  const account = useMemo(() => accounts.data?.find((a) => a.id === accountId), [accounts.data, accountId]);
  const sym = currencySymbol(account?.currency || 'INR');
  const money = (n: number) => `${sym}${n.toLocaleString('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;

  const wantPerf = !!account && tab !== 'create' && (tab !== 'overview' || checked);
  useEffect(() => { if (tab === 'ads' || tab === 'sets') setChecked(true); }, [tab]);
  const perf = useAsync<Row[]>(wantPerf ? `catperf-${account!.id}-${range.since}-${range.until}-${tick}` : null, () => apiGet('catalog-performance', { account: account!.id, since: range.since, until: range.until }));

  const changeAccount = (id: string) => {
    if (id === accountId) return;
    setAccountId(id);
    setForm((f) => clearAccountBound(f));
    setResult(null); setLastAd(null); setRepeatOf('');
  };
  const startCreate = (catalog?: { catalogId: string; productSetId: string }) => {
    setForm(adFirstForm(catalog || { catalogId: '', productSetId: '' }));
    setResult(null); setRepeatOf(''); setWsKey((k) => k + 1); setTab('create');
  };

  const checkPrompt = (
    <PartnershipEmptyStateC
      icon={ChartIcon}
      title="Ready to compare performance"
      description="See how your catalog ads stack up against your other ads over a chosen window."
      steps={['Pick an ad account', 'Choose a date range', 'Click “Check Performance”']}
      ctaLabel="Check Performance"
      onRun={() => setChecked(true)}
      canRun
    />
  );

  if (isMobile) {
    return (
      <div className="content wide la-m">
        <MobileContext
          accounts={accounts}
          accountId={accountId}
          onAccount={changeAccount}
          range={range}
          onRange={setRange}
          onRefresh={() => { setChecked(true); setTick((n) => n + 1); }}
          showRange={tab !== 'create'}
          refreshing={perf.loading}
        />
        <AccountNotices accounts={accounts} />
        {declined.length ? (
          <div className={styles.error}>
            You didn&apos;t allow <b>{declined.join(', ')}</b>. Some options won&apos;t load. <a href="/">Log in again</a> to grant them.
          </div>
        ) : null}
        <MobileTabs
          tabs={[{ key: 'overview', label: 'Overview' }, { key: 'ads', label: 'Ads' }, { key: 'sets', label: 'Sets' }, { key: 'create', label: 'Create ad' }]}
          tab={tab}
          onTab={setTab}
        />
        {!account ? null : tab === 'overview' && !checked ? (
          checkPrompt
        ) : tab === 'overview' ? (
          <MobileOverview perf={perf} sym={sym} range={range} />
        ) : tab === 'ads' ? (
          <MobileAdList perf={perf} sym={sym} />
        ) : tab === 'sets' ? (
          <MobileSets account={account} perf={perf} sym={sym} onCreate={(catalogId, productSetId) => startCreate({ catalogId, productSetId })} />
        ) : result ? (
          <ResultView
            result={result}
            account={account}
            onAgain={() => startCreate()}
            onRepeat={lastAd && result.ok ? () => { setForm(repeatForm(lastAd.form)); setRepeatOf(lastAd.adsetName || 'the last ad set'); setResult(null); setWsKey((k) => k + 1); } : undefined}
          />
        ) : (
          <AdFirstWorkspace
            key={`${account.id}-${wsKey}`}
            account={account}
            form={form}
            setForm={setForm}
            catalogOnly
            repeatOf={repeatOf || undefined}
            onDone={(r) => { setLastAd(r.ok ? { form, adsetName: r.created.adset?.name || '' } : null); setResult(r); window.scrollTo({ top: 0 }); }}
          />
        )}
        <LegalLinks style={{ marginTop: 32 }} />
      </div>
    );
  }

  return (
    <div className="content wide">
      <PageHeader
        title="Catalog Ads"
        sub="Compare catalog ads with your other ads, browse product sets, and launch catalog ads."
        action={tab !== 'create' ? <button type="button" className={styles.btnPrimary} onClick={() => startCreate()}>Create Ad</button> : undefined}
      >
        <AdAccountPill accounts={accounts} value={accountId} onChange={changeAccount} />
        {tab !== 'create' ? (
          <>
            <RangePill range={range} onChange={setRange} />
            <RefreshPill onClick={() => { setChecked(true); setTick((n) => n + 1); }} />
          </>
        ) : null}
      </PageHeader>
      <AccountNotices accounts={accounts} />

      {declined.length ? (
        <div className={styles.error}>
          You didn&apos;t allow <b>{declined.join(', ')}</b>. Some options won&apos;t load. <a href="/">Log in again</a> to grant them.
        </div>
      ) : null}

      <div className={styles.tabGroup} style={{ flexWrap: 'wrap' }} role="tablist" aria-label="Catalog Ads">
        {TABS.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className={tab === t.key ? `${styles.tab} ${styles.tabActive}` : styles.tab} onClick={() => setTab(t.key)}>{t.label}</button>
        ))}
      </div>

      {!account ? null : tab === 'overview' && !checked ? (
        checkPrompt
      ) : tab === 'overview' ? (
        <Overview perf={perf} money={money} range={range} />
      ) : tab === 'ads' ? (
        <CatalogAdsTable perf={perf} money={money} />
      ) : tab === 'sets' ? (
        <ProductSets account={account} perf={perf} money={money} onCreate={(catalogId, productSetId) => startCreate({ catalogId, productSetId })} />
      ) : result ? (
        <ResultView
          result={result}
          account={account}
          onAgain={() => startCreate()}
          onRepeat={lastAd && result.ok ? () => { setForm(repeatForm(lastAd.form)); setRepeatOf(lastAd.adsetName || 'the last ad set'); setResult(null); setWsKey((k) => k + 1); } : undefined}
        />
      ) : (
        <AdFirstWorkspace
          key={`${account.id}-${wsKey}`}
          account={account}
          form={form}
          setForm={setForm}
          catalogOnly
          repeatOf={repeatOf || undefined}
          onDone={(r) => { setLastAd(r.ok ? { form, adsetName: r.created.adset?.name || '' } : null); setResult(r); window.scrollTo({ top: 0 }); }}
        />
      )}

      <LegalLinks style={{ marginTop: 48 }} />
    </div>
  );
}

type Perf = { data?: Row[]; loading: boolean; error: string };

function PerfState({ perf, children }: { perf: Perf; children: () => React.ReactNode }) {
  if (perf.loading) return <div className="card"><Loading /></div>;
  if (perf.error) return <div className="notice bad">{perf.error}</div>;
  return <>{children()}</>;
}

function Overview({ perf, money: moneyExact, range }: { perf: Perf; money: (n: number) => string; range: Range }) {
  // Whole rupees in the summary cards so large amounts fit; the table keeps paise.
  const money = (x: number) => (Math.abs(x) >= 1000 ? moneyExact(x).replace(/\.\d+$/, '') : moneyExact(x));
  return (
    <PerfState perf={perf}>
      {() => {
        const rows = perf.data || [];
        const cat = totals(rows.filter((r) => r.isCatalog));
        const norm = totals(rows.filter((r) => !r.isCatalog));
        const n = (x: number) => x.toLocaleString('en-IN', { maximumFractionDigits: 0 });
        const card = (title: string, sub: string, t: ReturnType<typeof totals>, dot: string) => (
          <div className="cat-card">
            <div className="cat-card-head"><span className={`dot ${dot}`} /> <div><div className="strong">{title}</div><div className="hint" style={{ margin: 0 }}>{sub}</div></div></div>
            <div className="cat-metrics">
              <Metric k="All ads" v={`${n(t.ads)} (${n(t.live)} live)`} />
              <Metric k="Reach" v={n(t.reach)} />
              <Metric k="Spend" v={money(t.spend)} />
              <Metric k="Avg ROAS" v={t.roas.toFixed(2)} tone="ok" />
              <Metric k="CTR" v={`${t.ctr.toFixed(2)}%`} />
              <Metric k="Purchases" v={n(t.purchases)} />
              <Metric k="CPA" v={t.purchases ? money(t.cpa) : '–'} />
              <Metric k="Frequency" v={t.frequency.toFixed(2)} />
            </div>
          </div>
        );
        const delta = (label: string, a: number, b: number, show: (x: number) => string, better: 'higher' | 'lower' | 'none') => {
          const d = b ? ((a - b) / b) * 100 : 0;
          const good = better === 'none' ? null : better === 'higher' ? d > 0 : d < 0;
          return (
            <div className="cat-delta" key={label}>
              <div className="hint" style={{ margin: 0 }}>{label}</div>
              <div className={`big ${!b || Math.abs(d) < 0.5 ? '' : good === null ? '' : good ? 'ok' : 'bad'}`}>{b ? (Math.abs(d) < 0.5 ? '0%' : `${d > 0 ? '+' : ''}${d.toFixed(0)}%`) : '–'}</div>
              <div className="hint" style={{ margin: 0 }}>Catalog {show(a)} vs. Normal {show(b)}</div>
            </div>
          );
        };
        if (!rows.length) return <div className="card note">No ads delivered between {range.since} and {range.until}. Pick a longer date range.</div>;
        return (
          <>
            <p className="note" style={{ marginTop: 0 }}>{range.since} to {range.until}, live from Meta. Catalog ads are ads that show products from a catalog.</p>
            <div className="cat-cards">
              {card('Catalog Ads', 'Products from a catalog', cat, 'coral')}
              {card('Normal Ads', 'Image, video and post ads', norm, 'grey')}
            </div>
            <h3 className="ws-section">How Catalog Ads compare</h3>
            {!cat.ads ? <div className="card note">No catalog ads delivered in this range, so there&apos;s nothing to compare yet. Create one from the Product Sets tab.</div> : (
              <div className="cat-deltas">
                {delta('ROAS', cat.roas, norm.roas, (x) => x.toFixed(2), 'higher')}
                {delta('CPA', cat.cpa, norm.cpa, money, 'lower')}
                {delta('CTR', cat.ctr, norm.ctr, (x) => `${x.toFixed(2)}%`, 'higher')}
                {delta('Frequency', cat.frequency, norm.frequency, (x) => x.toFixed(2), 'lower')}
                {delta('Reach', cat.reach, norm.reach, n, 'none')}
                {delta('Spend', cat.spend, norm.spend, money, 'none')}
              </div>
            )}
            <p className="hint">Reach is added up across ads, so someone reached by several ads counts more than once; frequency is impressions divided by that reach.</p>
          </>
        );
      }}
    </PerfState>
  );
}

function Metric({ k, v, tone }: { k: string; v: string; tone?: string }) {
  return <div className="cat-metric"><div className="k">{k}</div><div className={`v ${tone || ''}`}>{v}</div></div>;
}

type SortKey = 'spend' | 'roas' | 'cpr' | 'cpm' | 'ctr' | 'purchases' | 'value';
const COLS: { key: SortKey; label: string }[] = [
  { key: 'spend', label: 'Spend' }, { key: 'roas', label: 'ROAS' }, { key: 'cpr', label: 'CPR' }, { key: 'cpm', label: 'CPM' },
  { key: 'ctr', label: 'CTR' }, { key: 'purchases', label: 'Purchases' }, { key: 'value', label: 'Purchase value' },
];

function CatalogAdsTable({ perf, money }: { perf: Perf; money: (n: number) => string }) {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'spend', dir: -1 });
  return (
    <PerfState perf={perf}>
      {() => {
        const all = (perf.data || []).filter((r) => r.isCatalog);
        const s = q.trim().toLowerCase();
        const val = (r: Row, k: SortKey) => (k === 'spend' || k === 'purchases' || k === 'value' ? r[k] : rowMetrics(r)[k]);
        const rows = all.filter((r) => !s || `${r.name} ${r.campaign} ${r.adset}`.toLowerCase().includes(s)).sort((a, b) => (val(a, sort.key) - val(b, sort.key)) * sort.dir);
        return (
          <>
            <p className="note" style={{ marginTop: 0 }}>{all.length} catalog {all.length === 1 ? 'ad' : 'ads'}</p>
            <div className="cat-search"><Search size={14} /><input className="input" placeholder="Search ads, ad sets or campaigns…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
            {!all.length ? <div className="card note">No catalog ads delivered in this range.</div> : (
              <div className="cat-table-wrap">
                <table className="cat-table">
                  <thead>
                    <tr>
                      <th className="ad">Ad</th><th>Status</th>
                      {COLS.map((c) => (
                        <th key={c.key} className="num">
                          <button type="button" onClick={() => setSort({ key: c.key, dir: sort.key === c.key ? (sort.dir === -1 ? 1 : -1) : -1 })}>
                            {c.label}{sort.key === c.key ? (sort.dir === -1 ? <ArrowDown size={12} /> : <ArrowUp size={12} />) : null}
                          </button>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const m = rowMetrics(r);
                      return (
                        <tr key={r.id}>
                          <td className="ad">
                            <div className="ad-cell">
                              {r.thumb ? <img src={r.thumb} alt="" /> : <span className="thumb-empty" />}
                              <div style={{ minWidth: 0 }}><div className="nm" title={r.name}>{r.name}</div><div className="sub" title={`${r.campaign} › ${r.adset}`}>{r.campaign} › {r.adset}</div></div>
                            </div>
                          </td>
                          <td><span className={`badge ${STATUS_TONE[r.status] || 'grey'}`}>{statusLabel(r.status) || '–'}</span></td>
                          <td className="num">{money(r.spend)}</td>
                          <td className="num">{m.roas.toFixed(2)}</td>
                          <td className="num">{r.purchases ? money(m.cpr) : '–'}</td>
                          <td className="num">{money(m.cpm)}</td>
                          <td className="num">{m.ctr.toFixed(2)}%</td>
                          <td className="num">{r.purchases.toLocaleString('en-IN')}</td>
                          <td className="num">{money(r.value)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {!rows.length ? <div className="note" style={{ padding: 14 }}>No catalog ads match “{q}”.</div> : null}
              </div>
            )}
          </>
        );
      }}
    </PerfState>
  );
}

function ProductSets({ account, perf, money, onCreate }: { account: AdAccount; perf: Perf; money: (n: number) => string; onCreate: (catalogId: string, productSetId: string) => void }) {
  const catalogs = useAsync<Catalog[]>(`catalogs-${account.id}`, () => apiGet('catalogs', { account: account.id }));
  const [catalogId, setCatalogId] = useState('');
  const [q, setQ] = useState('');
  const [checking, setChecking] = useState('');
  useEffect(() => { setCatalogId(''); }, [account.id]);
  useEffect(() => { if (!catalogId && catalogs.data?.length) setCatalogId(catalogs.data[0].id); }, [catalogs.data, catalogId]);
  const sets = useAsync<SetLite[]>(catalogId ? `sets-${catalogId}` : null, () => apiGet('product-sets', { catalog: catalogId }));

  // In-range results of catalog ads, grouped by the product set they show.
  const bySet = useMemo(() => {
    const m = new Map<string, Row[]>();
    (perf.data || []).filter((r) => r.isCatalog && r.productSetId).forEach((r) => m.set(r.productSetId, [...(m.get(r.productSetId) || []), r]));
    return m;
  }, [perf.data]);

  if (catalogs.loading) return <div className="card"><Loading /></div>;
  if (catalogs.error) return <div className="notice bad">{catalogs.error}</div>;
  if (!catalogs.data?.length) return <div className="notice warn">No catalogs found for this ad account. Create one in Commerce Manager, or connect your store through the Facebook &amp; Instagram app.</div>;

  const s = q.trim().toLowerCase();
  // Most catalog ads first, then highest spend, then name.
  const list = (sets.data || [])
    .filter((x) => !s || x.name.toLowerCase().includes(s))
    .map((x) => ({ set: x, t: totals(bySet.get(x.id) || []) }))
    .sort((a, b) => b.t.ads - a.t.ads || b.t.spend - a.t.spend || a.set.name.localeCompare(b.set.name));

  return (
    <>
      <div className="cat-sets-head">
        <div style={{ width: 'min(460px, 100%)' }}>
          <span className="label">Catalog</span>
          <SearchSelect
            value={catalogId}
            onChange={(v) => { setCatalogId(v); setChecking(''); }}
            ariaLabel="Catalog"
            noun="catalogs"
            placeholder="Select a catalog..."
            searchPlaceholder="Search catalogs by name or ID"
            options={catalogs.data.map((c) => ({ key: c.id, label: c.name, meta: [c.product_count != null ? `${c.product_count.toLocaleString('en-IN')} products` : '', c.relevance === 'USED' ? 'Used in this ad account' : c.relevance === 'LINKED' ? 'Linked to this ad account’s dataset' : ''].filter(Boolean).join(' · ') }))}
          />
        </div>
        <div className="cat-search" style={{ margin: 0, flex: 1, maxWidth: 360 }}><Search size={14} /><input className="input" placeholder="Search product sets…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      </div>
      <p className="note">Pick a product set to create a catalog ad from it. Results are for catalog ads showing that set in the selected date range.</p>

      {sets.loading ? <div className="card"><Loading /></div> : sets.error ? <div className="notice bad">{sets.error}</div> : !sets.data?.length ? (
        <div className="notice warn">This catalog has no product sets yet. Create one in Commerce Manager.</div>
      ) : (
        <div className="cat-table-wrap">
          <table className="cat-table">
            <thead>
              <tr><th className="ad">Product set</th><th className="num">Products</th><th className="num">Catalog ads</th><th className="num">Spend</th><th className="num">ROAS</th><th className="num">Purchases</th><th /></tr>
            </thead>
            <tbody>
              {list.map(({ set, t }) => (
                <FragmentRow key={set.id} open={checking === set.id} cols={7} detail={<SetProducts set={set} />}>
                  <td className="ad"><div className="ad-cell"><SetThumbs s={set} /><div style={{ minWidth: 0 }}><div className="nm">{set.name}</div><div className="sub">{set.id}</div></div></div></td>
                  <td className="num">{set.product_count != null ? set.product_count.toLocaleString('en-IN') : '–'}</td>
                  <td className="num">{perf.loading ? '…' : t.ads ? `${t.ads} (${t.live} live)` : '0'}</td>
                  <td className="num">{perf.loading ? '…' : t.ads ? money(t.spend) : '–'}</td>
                  <td className="num">{perf.loading ? '…' : t.ads ? t.roas.toFixed(2) : '–'}</td>
                  <td className="num">{perf.loading ? '…' : t.ads ? t.purchases.toLocaleString('en-IN') : '–'}</td>
                  <td className="actions">
                    <button type="button" className="btn-link" onClick={() => setChecking(checking === set.id ? '' : set.id)}>{checking === set.id ? 'Hide products' : 'View products'}</button>
                    <button type="button" className="btn-primary sm" onClick={() => onCreate(catalogId, set.id)}>Create ad</button>
                  </td>
                </FragmentRow>
              ))}
            </tbody>
          </table>
          {!list.length ? <div className="note" style={{ padding: 14 }}>No product sets match “{q}”.</div> : null}
        </div>
      )}
    </>
  );
}

interface Product { id: string; name: string; price?: string; sale_price?: string; image_url?: string; brand?: string; availability?: string; url?: string }

/** The products in a set (first 25, as Meta returns them) and their checks, behind one loader. */
function SetProducts({ set }: { set: SetLite }) {
  const res = useAsync<Product[]>(`products-${set.id}`, () => apiGet('products', { set: set.id }));
  const health = useAsync<SetHealth>(`set-health-${set.id}`, () => apiGet('set-health', { set: set.id }));
  if (res.loading || health.loading) return <Loading />;
  if (res.error) return <div className="notice bad">{res.error}</div>;
  const list = res.data || [];
  if (!list.length) return <div className="note">This product set has no products.</div>;
  return (
    <>
      <div className="hint" style={{ marginTop: 0 }}>{set.product_count && set.product_count > list.length ? `Showing ${list.length} of ${set.product_count.toLocaleString('en-IN')} products` : `${list.length} ${list.length === 1 ? 'product' : 'products'}`}</div>
      <div className="set-products">
        {list.map((p) => {
          const sale = p.sale_price && p.sale_price !== p.price;
          const oos = /out of stock/i.test(p.availability || '');
          return (
            <a key={p.id} className="set-product" href={p.url || undefined} target="_blank" rel="noreferrer" title={p.url ? `Opens ${p.url}` : undefined}>
              <span className="img" style={{ backgroundImage: p.image_url ? `url("${p.image_url}")` : undefined }} />
              <span className="nm">{p.name}</span>
              <span className="pr">{sale ? <><b>{p.sale_price}</b> <s>{p.price}</s></> : p.price || '–'}</span>
              <span className="meta">{[p.brand, oos ? 'Out of stock' : ''].filter(Boolean).join(' · ')}</span>
            </a>
          );
        })}
      </div>
      {health.data ? <SetChecks setId={set.id} data={health.data} /> : null}
    </>
  );
}

function FragmentRow({ open, cols, detail, children }: { open: boolean; cols: number; detail: React.ReactNode; children: React.ReactNode }) {
  return (
    <>
      <tr>{children}</tr>
      {open ? <tr className="detail"><td colSpan={cols}>{detail}</td></tr> : null}
    </>
  );
}
