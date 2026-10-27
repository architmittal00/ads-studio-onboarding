'use client';
import { ChevronDown, ChevronRight, Search } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import BottomSheetJs from '@/components/BottomSheet';
import { RefreshIcon, SortIcon, ChartIcon } from '@/components/icons';
import styles from '@/styles/Home.module.css';
import { apiGet } from '@/launch-ad/lib/client-api';
import { useAsync } from '@/launch-ad/lib/hooks';
import { rowMetrics, totals, type Catalog, type Row } from '@/launch-ad/lib/catalog-perf';
import type { AdAccount } from '@/launch-ad/lib/types';
import { SetChecks, SetThumbs, type SetHealth, type SetLite } from './CatalogPanel';
import { RangePill, type Range } from './PageHeader';
import { MobileContextBar, MobileIconBtn, MobileChips, PickerField, PickerSheet, formatRangeLabel } from '@/components/mobile/MobileChrome';
import { RANGE_PRESETS } from '@/lib/dateRanges';
import { statusLabel } from './Pickers';
import { Loading } from './ui';

// Phone presentation of Catalog Ads (the desktop tables/pill row stay in
// CatalogAdsApp). Same data, shaped for a thumb: one context button, a sticky
// chip row for the four sections, head-to-head rows instead of wide cards,
// ranked ad cards instead of a 9-column table, product sets with the products
// in a bottom sheet. See DESIGN.md → Mobile web.

/* eslint-disable @typescript-eslint/no-explicit-any */
const BottomSheet = BottomSheetJs as any;
const MobileContextBarC = MobileContextBar as any;
const MobileIconBtnC = MobileIconBtn as any;
const MobileChipsC = MobileChips as any;
const PickerFieldC = PickerField as any;
const PickerSheetC = PickerSheet as any;

type Perf = { data?: Row[]; loading: boolean; error: string };

/** Sheets render in a portal, outside .la-root; this brings the scoped styles back. */
function SheetBody({ children }: { children: ReactNode }) {
  return <div className="la-root">{children}</div>;
}

const compactNum = new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1 });
/** ₹1.2L / 81.2K / 812 — numbers sized for a 3-column card. */
function compact(n: number): string {
  const a = Math.abs(n);
  if (a >= 1000) return compactNum.format(n);
  if (a >= 100) return Math.round(n).toString();
  return n.toLocaleString('en-IN', { maximumFractionDigits: 2 });
}
const compactMoney = (sym: string, n: number) => `${sym}${compact(n)}`;

const dotClass = (status: string) => (status === 'ACTIVE' ? styles.statusDotOn : status === 'WITH_ISSUES' || status === 'DISAPPROVED' ? styles.statusDotWarn : styles.statusDotOff);

function PerfState({ perf, children }: { perf: Perf; children: () => ReactNode }) {
  if (perf.loading) return <div className="la-m-state"><Loading /></div>;
  if (perf.error) return <div className="notice bad">{perf.error}</div>;
  return <>{children()}</>;
}

/* ── Context: account + date + refresh (same chrome as Partnership Ads) ── */

export function MobileContext({ accounts, accountId, onAccount, range, onRange, timeZone, onRefresh, showRange, refreshing }: {
  accounts: { data?: AdAccount[]; loading: boolean; error: string };
  accountId: string;
  onAccount: (id: string) => void;
  range: Range;
  onRange: (r: Range) => void;
  timeZone?: string;
  onRefresh: () => void;
  showRange: boolean;
  refreshing?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const list = accounts.data || [];
  const account = list.find((a) => a.id === accountId);
  const sub = showRange ? formatRangeLabel(RANGE_PRESETS.find((p) => p.key === range.preset)?.label, range.since, range.until) : 'Create ad';
  return (
    <>
      <MobileContextBarC
        title={account ? account.name : accounts.loading ? 'Loading ad accounts…' : 'Select an ad account'}
        sub={sub}
        onOpen={() => setOpen(true)}
      >
        {showRange ? (
          <MobileIconBtnC label="Reload" onClick={onRefresh} disabled={!account || refreshing} spinning={refreshing}>
            <RefreshIcon size={16} />
          </MobileIconBtnC>
        ) : null}
      </MobileContextBarC>
      <BottomSheet open={open} title="Account & dates" onClose={() => setOpen(false)} footer={<button type="button" className={styles.btnPrimary} style={{ flex: 1 }} onClick={() => setOpen(false)}>Done</button>}>
        <SheetBody>
          <div className={styles.pvSheetFields}>
            <PickerFieldC label="Ad account" value={account?.name} placeholder={accounts.loading ? 'Loading ad accounts…' : 'Select an ad account…'} onClick={() => setPicking(true)} />
            {showRange ? (
              <div className={styles.pvField}>
                <span>Date range</span>
                <RangePill range={range} onChange={onRange} fullWidth timeZone={timeZone} />
              </div>
            ) : null}
          </div>
        </SheetBody>
      </BottomSheet>
      {picking ? (
        <PickerSheetC
          open
          title="Ad account"
          options={list.map((a) => ({ id: a.id, name: a.name || a.account_id, sub: a.account_id }))}
          value={accountId}
          onPick={onAccount}
          onClose={() => setPicking(false)}
          searchPlaceholder="Search ad accounts"
        />
      ) : null}
    </>
  );
}

/* ── Section chips (sticky under the top bar) ── */

export function MobileTabs<T extends string>({ tabs, tab, onTab }: { tabs: { key: T; label: string }[]; tab: T; onTab: (t: T) => void }) {
  return <MobileChipsC label="Catalog Ads" tabs={tabs} active={tab} onChange={onTab} />;
}

/* ── Overview: KPI strip + head-to-head rows ── */

export function MobileOverview({ perf, sym, range }: { perf: Perf; sym: string; range: Range }) {
  return (
    <PerfState perf={perf}>
      {() => {
        const rows = perf.data || [];
        if (!rows.length) return <div className="card note">No ads delivered between {range.since} and {range.until}. Pick a longer date range.</div>;
        const cat = totals(rows.filter((r) => r.isCatalog));
        const norm = totals(rows.filter((r) => !r.isCatalog));
        const n = (x: number) => compact(x);
        const m = (x: number) => compactMoney(sym, x);
        type Line = { label: string; a: number; b: number; show: (x: number) => string; better: 'higher' | 'lower' | 'none' };
        const lines: Line[] = [
          { label: 'ROAS', a: cat.roas, b: norm.roas, show: (x) => x.toFixed(2), better: 'higher' },
          { label: 'CPA', a: cat.cpa, b: norm.cpa, show: m, better: 'lower' },
          { label: 'CTR', a: cat.ctr, b: norm.ctr, show: (x) => `${x.toFixed(2)}%`, better: 'higher' },
          { label: 'Frequency', a: cat.frequency, b: norm.frequency, show: (x) => x.toFixed(2), better: 'lower' },
          { label: 'Reach', a: cat.reach, b: norm.reach, show: n, better: 'none' },
          { label: 'Spend', a: cat.spend, b: norm.spend, show: m, better: 'none' },
          { label: 'Purchases', a: cat.purchases, b: norm.purchases, show: n, better: 'none' },
        ];
        const kpis: [string, string][] = [['Spend', m(cat.spend)], ['ROAS', cat.roas.toFixed(2)], ['Purchases', n(cat.purchases)], ['CPA', cat.purchases ? m(cat.cpa) : '–'], ['CTR', `${cat.ctr.toFixed(2)}%`], ['Reach', n(cat.reach)]];
        return (
          <div className="la-m-stack">
            <p className={styles.mvMeta}>{range.since} to {range.until} · live from Meta</p>
            <div>
              <div className="la-m-h">Catalog ads <span>{cat.ads} ads · {cat.live} live</span></div>
              <div className={styles.kpiStrip}>
                {kpis.map(([k, v]) => (
                  <div key={k} className={styles.kpiTile}><div className={styles.kpiLabel}>{k}</div><div className={styles.kpiValue}>{v}</div></div>
                ))}
              </div>
            </div>
            {!cat.ads ? (
              <div className="card note">No catalog ads delivered in this range, so there&apos;s nothing to compare yet. Create one from the Product Sets tab.</div>
            ) : (
              <section className="la-m-vs">
                <div className="la-m-vs-head"><span /><span className="c">Catalog</span><span className="o">Normal</span><span className="d">Diff</span></div>
                {lines.map((l) => {
                  const d = l.b ? ((l.a - l.b) / l.b) * 100 : null;
                  const flat = d === null || Math.abs(d) < 0.5;
                  const good = l.better === 'none' || flat ? null : l.better === 'higher' ? d! > 0 : d! < 0;
                  return (
                    <div className="la-m-vs-row" key={l.label}>
                      <span className="k">{l.label}</span>
                      <span className="c">{l.show(l.a)}</span>
                      <span className="o">{l.show(l.b)}</span>
                      <span className={`d pill ${good === null ? '' : good ? 'ok' : 'bad'}`}>{d === null ? '–' : flat ? '0%' : `${d > 0 ? '+' : ''}${d.toFixed(0)}%`}</span>
                    </div>
                  );
                })}
              </section>
            )}
            <p className="hint">Normal ads: {norm.ads} ads · {norm.live} live. Reach is added up across ads, so someone reached by several ads counts more than once.</p>
          </div>
        );
      }}
    </PerfState>
  );
}

/* ── My Catalog Ads: ranked cards ── */

type SortKey = 'spend' | 'roas' | 'cpr' | 'cpm' | 'ctr' | 'purchases' | 'value';
const SORTS: { key: SortKey; label: string }[] = [
  { key: 'spend', label: 'Spend' }, { key: 'roas', label: 'ROAS' }, { key: 'purchases', label: 'Purchases' }, { key: 'value', label: 'Value' },
  { key: 'ctr', label: 'CTR' }, { key: 'cpr', label: 'CPR' }, { key: 'cpm', label: 'CPM' },
];

export function MobileAdList({ perf, sym }: { perf: Perf; sym: string }) {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'spend', dir: -1 });
  const [sheet, setSheet] = useState(false);
  return (
    <PerfState perf={perf}>
      {() => {
        const all = (perf.data || []).filter((r) => r.isCatalog);
        const s = q.trim().toLowerCase();
        const val = (r: Row, k: SortKey) => (k === 'spend' || k === 'purchases' || k === 'value' ? r[k] : rowMetrics(r)[k]);
        const rows = all.filter((r) => !s || `${r.name} ${r.campaign} ${r.adset}`.toLowerCase().includes(s)).sort((a, b) => (val(a, sort.key) - val(b, sort.key)) * sort.dir);
        const label = SORTS.find((x) => x.key === sort.key)!.label;
        // Sorted metric leads the grid so the ranking is visible on the card.
        const order = [sort.key, ...SORTS.map((x) => x.key).filter((k) => k !== sort.key)];
        const show = (r: Row, k: SortKey) => {
          const m = rowMetrics(r);
          switch (k) {
            case 'spend': return compactMoney(sym, r.spend);
            case 'roas': return m.roas.toFixed(2);
            case 'cpr': return r.purchases ? compactMoney(sym, m.cpr) : '–';
            case 'cpm': return compactMoney(sym, m.cpm);
            case 'ctr': return `${m.ctr.toFixed(2)}%`;
            case 'purchases': return compact(r.purchases);
            default: return compactMoney(sym, r.value);
          }
        };
        return (
          <div className={styles.mobileList}>
            <div className="la-m-toolbar">
              <div className={styles.mobileSearch}><Search size={15} /><input placeholder="Search ads, ad sets, campaigns" value={q} onChange={(e) => setQ(e.target.value)} /></div>
              <button type="button" className={`${styles.mobileToolBtn} ${styles.mobileToolBtnOn}`} onClick={() => setSheet(true)}>
                <SortIcon size={14} /><span className={styles.mobileToolBtnLabel}>{label}</span><span>{sort.dir === -1 ? '↓' : '↑'}</span>
              </button>
            </div>
            <p className={styles.mvMeta}>{rows.length === all.length ? `${all.length} catalog ${all.length === 1 ? 'ad' : 'ads'}` : `${rows.length} of ${all.length} catalog ads`}</p>
            {!all.length ? <div className="card note">No catalog ads delivered in this range.</div> : (
              <div className={styles.cardList}>
                {rows.map((r) => (
                  <article key={r.id} className={styles.rowCard}>
                    <div className={styles.rowCardHead}>
                      {r.thumb ? <img className="la-m-thumb" src={r.thumb} alt="" /> : <span className="la-m-thumb empty" />}
                      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                        <span className={styles.rowCardTitle}>{r.name}</span>
                        <span className={styles.rowCardSub}>
                          <span className={`${styles.statusDot} ${dotClass(r.status)}`} /> {statusLabel(r.status) || '–'}
                        </span>
                        <span className="la-m-crumb">{r.campaign} › {r.adset}</span>
                      </div>
                    </div>
                    <div className={styles.cardMetrics} style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '10px 6px' }}>
                      {order.map((k) => (
                        <div key={k} className={styles.cardMetric}>
                          <div className={k === sort.key ? `${styles.cardMetricLabel} ${styles.cardMetricLabelActive}` : styles.cardMetricLabel}>{SORTS.find((x) => x.key === k)!.label}</div>
                          <div className={styles.cardMetricValue}>{show(r, k)}</div>
                        </div>
                      ))}
                    </div>
                  </article>
                ))}
                {!rows.length ? <div className="note">No catalog ads match “{q}”.</div> : null}
              </div>
            )}
            <BottomSheet open={sheet} title="Sort by" onClose={() => setSheet(false)}>
              <SheetBody>
                <div className={styles.sheetList}>
                  {SORTS.map((o) => (
                    <button key={o.key} type="button" className={styles.sheetListItem} onClick={() => { setSort({ key: o.key, dir: sort.key === o.key ? (sort.dir === -1 ? 1 : -1) : -1 }); setSheet(false); }}>
                      <span style={{ flex: 1 }}>{o.label}</span>
                      {sort.key === o.key ? <span className="la-m-tick">{sort.dir === -1 ? 'High → Low' : 'Low → High'}</span> : null}
                    </button>
                  ))}
                </div>
                <p className="hint">Tap the active metric again to reverse the order.</p>
              </SheetBody>
            </BottomSheet>
          </div>
        );
      }}
    </PerfState>
  );
}

/* ── Product Sets: cards, products in a sheet ── */

interface Product { id: string; name: string; price?: string; sale_price?: string; image_url?: string; brand?: string; availability?: string; url?: string }

function ProductsSheet({ set, onClose }: { set: SetLite; onClose: () => void }) {
  const res = useAsync<Product[]>(`products-${set.id}`, () => apiGet('products', { set: set.id }));
  const health = useAsync<SetHealth>(`set-health-${set.id}`, () => apiGet('set-health', { set: set.id }));
  const list = res.data || [];
  return (
    <BottomSheet open title={set.name} onClose={onClose}>
      <SheetBody>
        {res.loading || health.loading ? <Loading /> : res.error ? <div className="notice bad">{res.error}</div> : !list.length ? <div className="note">This product set has no products.</div> : (
          <>
            <div className="hint" style={{ marginTop: 0 }}>{set.product_count && set.product_count > list.length ? `Showing ${list.length} of ${set.product_count.toLocaleString('en-IN')} products` : `${list.length} ${list.length === 1 ? 'product' : 'products'}`}</div>
            {health.data ? <SetChecks setId={set.id} data={health.data} /> : null}
            <div className="la-m-products">
              {list.map((p) => {
                const sale = p.sale_price && p.sale_price !== p.price;
                const oos = /out of stock/i.test(p.availability || '');
                return (
                  <a key={p.id} className="la-m-product" href={p.url || undefined} target="_blank" rel="noreferrer">
                    <span className="img" style={{ backgroundImage: p.image_url ? `url("${p.image_url}")` : undefined }} />
                    <span className="nm">{p.name}</span>
                    <span className="pr">{sale ? <><b>{p.sale_price}</b> <s>{p.price}</s></> : p.price || '–'}</span>
                    {oos ? <span className="oos">Out of stock</span> : null}
                  </a>
                );
              })}
            </div>
          </>
        )}
      </SheetBody>
    </BottomSheet>
  );
}

export function MobileSets({ account, perf, sym, onCreate }: { account: AdAccount; perf: Perf; sym: string; onCreate: (catalogId: string, productSetId: string) => void }) {
  const catalogs = useAsync<Catalog[]>(`catalogs-${account.id}`, () => apiGet('catalogs', { account: account.id }));
  const [catalogId, setCatalogId] = useState('');
  const [catSheet, setCatSheet] = useState(false);
  const [q, setQ] = useState('');
  const [viewing, setViewing] = useState<SetLite | null>(null);
  useEffect(() => { setCatalogId(''); }, [account.id]);
  useEffect(() => { if (!catalogId && catalogs.data?.length) setCatalogId(catalogs.data[0].id); }, [catalogs.data, catalogId]);
  const sets = useAsync<SetLite[]>(catalogId ? `sets-${catalogId}` : null, () => apiGet('product-sets', { catalog: catalogId }));

  const bySet = useMemo(() => {
    const m = new Map<string, Row[]>();
    (perf.data || []).filter((r) => r.isCatalog && r.productSetId).forEach((r) => m.set(r.productSetId, [...(m.get(r.productSetId) || []), r]));
    return m;
  }, [perf.data]);

  if (catalogs.loading) return <div className="la-m-state"><Loading /></div>;
  if (catalogs.error) return <div className="notice bad">{catalogs.error}</div>;
  if (!catalogs.data?.length) return <div className="notice warn">No catalogs found for this ad account. Create one in Commerce Manager, or connect your store through the Facebook &amp; Instagram app.</div>;

  const catalog = catalogs.data.find((c) => c.id === catalogId);
  const s = q.trim().toLowerCase();
  const list = (sets.data || [])
    .filter((x) => !s || x.name.toLowerCase().includes(s))
    .map((x) => ({ set: x, t: totals(bySet.get(x.id) || []) }))
    .sort((a, b) => b.t.ads - a.t.ads || b.t.spend - a.t.spend || a.set.name.localeCompare(b.set.name));

  return (
    <div className={styles.mobileList}>
      <button type="button" className={styles.mvViewBtn} onClick={() => setCatSheet(true)} disabled={catalogs.data.length < 2}>
        <span className={styles.mvViewText}>
          <span className={styles.mvViewTitle}>{catalog?.name || 'Select a catalog'}</span>
          <span className={styles.mvViewSub}>Catalog{catalog?.product_count != null ? ` · ${catalog.product_count.toLocaleString('en-IN')} products` : ''}</span>
        </span>
        {catalogs.data.length > 1 ? <ChevronDown size={18} /> : null}
      </button>
      <div className="la-m-toolbar">
        <div className={styles.mobileSearch}><Search size={15} /><input placeholder="Search product sets" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      </div>
      {sets.loading ? <div className="la-m-state"><Loading /></div> : sets.error ? <div className="notice bad">{sets.error}</div> : !sets.data?.length ? (
        <div className="notice warn">This catalog has no product sets yet. Create one in Commerce Manager.</div>
      ) : (
        <div className={styles.cardList}>
          {list.map(({ set, t }) => (
            <article key={set.id} className={styles.rowCard}>
              <div className={styles.rowCardHead}>
                <div className="la-m-collage"><SetThumbs s={set} /></div>
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <span className={styles.rowCardTitle}>{set.name}</span>
                  <span className={styles.rowCardSub}>{set.product_count != null ? `${set.product_count.toLocaleString('en-IN')} products` : 'Product set'}</span>
                </div>
              </div>
              <div className="la-m-set-metrics">
                {([['Ads', perf.loading ? '…' : t.ads ? String(t.ads) : '0'], ['Spend', perf.loading ? '…' : t.ads ? compactMoney(sym, t.spend) : '–'], ['ROAS', perf.loading ? '…' : t.ads ? t.roas.toFixed(2) : '–'], ['Purchases', perf.loading ? '…' : t.ads ? compact(t.purchases) : '–']] as [string, string][]).map(([k, v]) => (
                  <div key={k} className={styles.cardMetric}><div className={styles.cardMetricLabel}>{k}</div><div className={styles.cardMetricValue}>{v}</div></div>
                ))}
              </div>
              <div className="la-m-actions">
                <button type="button" className="btn-ghost" onClick={() => setViewing(set)}>Products <ChevronRight size={14} /></button>
                <button type="button" className="btn-primary" onClick={() => onCreate(catalogId, set.id)}>Create ad</button>
              </div>
            </article>
          ))}
          {!list.length ? <div className="note">No product sets match “{q}”.</div> : null}
        </div>
      )}
      <BottomSheet open={catSheet} title="Catalog" onClose={() => setCatSheet(false)}>
        <SheetBody>
          <div className={styles.sheetList}>
            {catalogs.data.map((c) => (
              <button key={c.id} type="button" className={styles.sheetListItem} onClick={() => { setCatalogId(c.id); setCatSheet(false); }}>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block' }}>{c.name}</span>
                  <span style={{ display: 'block', fontSize: 11.5, fontWeight: 500, color: 'var(--t3)' }}>
                    {[c.product_count != null ? `${c.product_count.toLocaleString('en-IN')} products` : '', c.relevance === 'USED' ? 'Used in this ad account' : c.relevance === 'LINKED' ? 'Linked to this ad account’s dataset' : ''].filter(Boolean).join(' · ')}
                  </span>
                </span>
                {c.id === catalogId ? <span className="la-m-tick">✓</span> : null}
              </button>
            ))}
          </div>
        </SheetBody>
      </BottomSheet>
      {viewing ? <ProductsSheet set={viewing} onClose={() => setViewing(null)} /> : null}
    </div>
  );
}
