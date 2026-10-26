'use client';
import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { apiGet, apiPost, errorText } from '@/launch-ad/lib/client-api';
import { useAsync } from '@/launch-ad/lib/hooks';
import type { AdAccount } from '@/launch-ad/lib/types';
import { Field, Loading, SearchSelect, Select } from './ui';

/* eslint-disable @typescript-eslint/no-explicit-any */

interface Catalog { id: string; name: string; product_count?: number; vertical?: string; business?: string; shared?: boolean; relevance?: 'USED' | 'LINKED' | 'BUSINESS' }

type State = 'pass' | 'warn' | 'fail';
interface Row { state: State; title: string; detail?: string; action?: 'link' }

export type SetLite = { id: string; name: string; product_count?: number; products?: { data?: { id: string; image_url?: string }[] } };

export function SetThumbs({ s }: { s: SetLite }) {
  const imgs = (s.products?.data || []).map((p) => p.image_url).filter(Boolean).slice(0, 4) as string[];
  if (!imgs.length) return null;
  return <span className="set-thumbs" aria-hidden>{imgs.map((src, i) => <img key={i} src={src} alt="" loading="lazy" />)}</span>;
}

export type SetHealth = { outOfStock: number | null; links: { id: string; name: string; url?: string; ok: boolean; reason: string }[]; noUrl: number };

/** Out-of-stock count and a sample of product links, for the chosen product set. Pass `data` when it's already fetched. */
export function SetChecks({ setId, data }: { setId: string; data?: SetHealth }) {
  const fetched = useAsync<SetHealth>(data ? null : `set-health-${setId}`, () => apiGet('set-health', { set: setId }));
  const res = data ? { data, loading: false, error: '' } : fetched;
  if (res.loading) return <div className="set-checks"><Loading /></div>;
  if (res.error || !res.data) return <div className="set-checks"><div className="health-row warn"><span className="icon"><AlertTriangle size={16} /></span><div><div className="t">Couldn&apos;t check this product set</div><div className="d">{res.error}</div></div></div></div>;
  const { outOfStock, links, noUrl } = res.data;
  const bad = links.filter((l) => !l.ok);
  return (
    <div className="set-checks" aria-live="polite">
      {outOfStock != null ? (
        <div className={`health-row ${outOfStock ? 'warn' : 'pass'}`}>
          <span className="icon">{outOfStock ? <AlertTriangle size={16} /> : <CheckCircle2 size={16} />}</span>
          <div><div className="t">{outOfStock ? `${outOfStock}${outOfStock >= 100 ? '+' : ''} out of stock` : 'No out-of-stock products'}</div>{outOfStock ? <div className="d">Meta stops showing them once the catalog syncs; until then a click can land on a sold-out page.</div> : null}</div>
        </div>
      ) : null}
      {links.length ? (
        <div className={`health-row ${bad.length ? 'warn' : 'pass'}`}>
          <span className="icon">{bad.length ? <AlertTriangle size={16} /> : <CheckCircle2 size={16} />}</span>
          <div>
            <div className="t">{bad.length ? `${bad.length} of ${links.length} sampled product links have problems` : `${links.length} of ${links.length} sampled product links open a product page`}</div>
            {bad.length ? <div className="d">{bad.slice(0, 3).map((l) => `${l.name}: ${l.reason}`).join(' · ')}</div> : <div className="d">Clicks on a product go to that product&apos;s page.</div>}
          </div>
        </div>
      ) : null}
      {noUrl ? (
        <div className="health-row warn"><span className="icon"><AlertTriangle size={16} /></span><div><div className="t">{noUrl} sampled {noUrl === 1 ? 'product has' : 'products have'} no link</div><div className="d">Meta can&apos;t show products without a link in the catalog.</div></div></div>
      ) : null}
    </div>
  );
}

const isUnavailable = (x: any): x is { unavailable: string } => x && typeof x === 'object' && 'unavailable' in x;

/** The two things a catalog ad needs: products in the catalog, and a pixel linked to it. */
export function readHealth(h: any, pixelId: string): { rows: Row[]; ready: boolean } {
  const rows: Row[] = [];
  let ready = true;

  // Products
  if (isUnavailable(h.info)) {
    rows.push({ state: 'warn', title: "Couldn't read the product count", detail: h.info.unavailable });
  } else {
    const n = Number(h.info?.product_count || 0);
    if (n > 0) rows.push({ state: 'pass', title: `${n.toLocaleString('en-IN')} products in the catalog` });
    else { rows.push({ state: 'fail', title: 'The catalog has no products', detail: 'Sync your store to this catalog in Commerce Manager first.' }); ready = false; }
  }

  // Pixel link
  if (!pixelId) {
    rows.push({ state: 'fail', title: 'Pick the dataset (pixel) above', detail: 'Catalog ads use its ViewContent, AddToCart and Purchase events to choose products.' });
    ready = false;
  } else if (isUnavailable(h.sources)) {
    rows.push({ state: 'warn', title: "Couldn't confirm the pixel is linked to this catalog", detail: h.sources.unavailable });
  } else if (Array.isArray(h.sources) && h.sources.some((s: any) => s.id === pixelId)) {
    rows.push({ state: 'pass', title: 'Pixel is linked to this catalog' });
  } else {
    rows.push({ state: 'fail', title: "Pixel isn't linked to this catalog", detail: "Without the link, Meta can't match shopper events to products.", action: 'link' });
    ready = false;
  }

  return { rows, ready };
}

const ICON: Record<State, import("react").JSX.Element> = {
  pass: <CheckCircle2 size={16} />,
  warn: <AlertTriangle size={16} />,
  fail: <XCircle size={16} />,
};

export default function CatalogPanel({ account, catalogId, locked, onCatalog, productSets, productSetsLoading, productSetsError, productSetId, onProductSet, pixelId, onReady, showHealth = true, pixels, pixelsLoading, onPixel }: {
  account: AdAccount;
  catalogId: string;
  locked: boolean;
  onCatalog: (id: string) => void;
  productSets: SetLite[];
  productSetsLoading: boolean;
  productSetsError: string;
  productSetId: string;
  onProductSet: (id: string) => void;
  /** Chosen in the Ad Set card; used for the pixel checks here. */
  pixelId: string;
  onReady: (ready: boolean) => void;
  /** Hide readiness checks and the dataset (reverse journey: the dataset is chosen later) */
  showHealth?: boolean;
  /** Dataset picker, shown in this card for catalog campaigns */
  pixels?: { id: string; name: string }[];
  pixelsLoading?: boolean;
  onPixel?: (id: string) => void;
}) {
  const catalogs = useAsync<Catalog[]>(`catalogs-${account.id}`, () => apiGet('catalogs', { account: account.id }));
  const health = useAsync<any>(catalogId && showHealth ? `health-${catalogId}-${pixelId}` : null, () => apiGet('health', { catalog: catalogId, pixel: pixelId }));
  const [linking, setLinking] = useState(false);
  const [linkError, setLinkError] = useState('');
  const [q, setQ] = useState('');
  const [showAll, setShowAll] = useState(false);
  // Product set list collapses to the chosen set; "Change" reopens it.
  const [pickingSet, setPickingSet] = useState(!productSetId);
  // The list reopens if the choice is cleared (e.g. the catalog changed); it collapses only when someone picks a set.
  useEffect(() => { if (!productSetId) setPickingSet(true); }, [productSetId]);

  const result = useMemo(() => (health.data ? readHealth(health.data, pixelId) : null), [health.data, pixelId]);
  useEffect(() => { onReady(!!result?.ready); }, [result, onReady]);

  // Auto-pick when there's exactly one catalog.
  useEffect(() => {
    if (!locked && !catalogId && catalogs.data?.length === 1) onCatalog(catalogs.data[0].id);
  }, [catalogs.data, catalogId, locked, onCatalog]);

  const link = async () => {
    setLinking(true);
    setLinkError('');
    try { await apiPost('link-pixel', { catalog: catalogId, pixel: pixelId }); health.reload(); }
    catch (e) { setLinkError(errorText(e)); }
    finally { setLinking(false); }
  };

  const current = catalogs.data?.find((c) => c.id === catalogId);
  // Show catalogs this ad account uses or is linked to; the rest of the business on request.
  const relevant = (catalogs.data || []).filter((c) => c.relevance && c.relevance !== 'BUSINESS');
  const scoped = !showAll && relevant.length > 0;
  const listed = scoped ? relevant.concat(current && !relevant.includes(current) ? [current] : []) : (catalogs.data || []);
  const others = (catalogs.data || []).length - relevant.length;
  const sets = productSets.filter((s) => !q || s.name.toLowerCase().includes(q.toLowerCase()));
  const chosenSet = productSets.find((s) => s.id === productSetId);
  // One loading message at a time: the readiness lines wait while the lists above are still loading.
  const busy = catalogs.loading || !!pixelsLoading || productSetsLoading;

  return (
    <div className="card">
      <Field label="Catalog" hint={locked ? 'Set by the campaign.' : undefined}>
        {catalogs.loading ? <Loading /> : catalogs.error && !locked ? <div className="notice bad">{catalogs.error}</div> : locked ? (
          <input className="input" disabled value={current ? `${current.name} (${current.id})` : catalogId} />
        ) : catalogs.data && !catalogs.data.length ? (
          <div className="notice warn">No catalogs found for this ad account. It isn&apos;t using one yet and its business has none. Create one in Commerce Manager, or connect your store through the Facebook &amp; Instagram app.</div>
        ) : (
          <>
            <SearchSelect
              value={catalogId}
              onChange={onCatalog}
              ariaLabel="Catalog"
              noun="catalogs"
              placeholder="Select a catalog..."
              searchPlaceholder="Search catalogs by name or ID"
              // Name and product count only; the ID is shown just when two catalogs share a name (it is always searchable).
              options={listed.map((c) => ({
                key: c.id,
                label: c.name,
                meta: [c.product_count != null ? `${c.product_count.toLocaleString('en-IN')} products` : '', listed.some((o) => o.id !== c.id && o.name === c.name) ? c.id : ''].filter(Boolean).join(' · '),
              }))}
            />
            {relevant.length && others > 0 ? (
              <button type="button" className="btn-link" style={{ marginTop: 6 }} onClick={() => setShowAll(!showAll)}>
                {scoped ? `Show all ${(catalogs.data || []).length} catalogs in the business` : 'Only show catalogs for this ad account'}
              </button>
            ) : !relevant.length && (catalogs.data || []).length ? (
              <div className="hint">This ad account hasn&apos;t used a catalog yet and none is linked to its datasets, so all catalogs in its business are listed.</div>
            ) : null}
          </>
        )}
      </Field>

      {showHealth && onPixel ? (
        <Field label="Dataset (pixel)">
          {pixelsLoading ? <Loading /> : (
            <Select value={pixelId} onChange={onPixel} placeholder="Select a dataset (pixel)..." options={(pixels || []).map((p) => ({ key: p.id, label: `${p.name} (${p.id})` }))} />
          )}
        </Field>
      ) : null}

      {catalogId ? (
        <Field label={`Product sets${productSets.length ? ` (${productSets.length})` : ''}`}>
          {productSetsLoading ? <Loading /> : productSetsError ? <div className="notice bad">{productSetsError}</div> : !productSets.length ? (
            <div className="notice warn">This catalog has no product sets yet.</div>
          ) : chosenSet && !pickingSet ? (
            <>
              <div className="set-row on" style={{ cursor: 'default' }}>
                <SetThumbs s={chosenSet} />
                <span className="set-name">{chosenSet.name}</span>
                <span className="set-meta">{chosenSet.product_count != null ? `${chosenSet.product_count.toLocaleString('en-IN')} products` : ''}</span>
                <button type="button" className="btn-link" onClick={() => setPickingSet(true)}>Change</button>
              </div>
            </>
          ) : (
            <>
              {productSets.length > 6 ? (
                <input className="input" style={{ marginBottom: 8 }} placeholder="Search product sets…" value={q} onChange={(e) => setQ(e.target.value)} />
              ) : null}
              <div className="set-list" role="radiogroup" aria-label="Product sets">
                {sets.map((s) => (
                  <label key={s.id} className={`set-row ${s.id === productSetId ? 'on' : ''}`}>
                    <input type="radio" name="product-set" checked={s.id === productSetId} onChange={() => { onProductSet(s.id); setPickingSet(false); setQ(''); }} />
                    <SetThumbs s={s} />
                    <span className="set-name">{s.name}</span>
                    <span className="set-meta">{s.product_count != null ? `${s.product_count.toLocaleString('en-IN')} products` : ''}</span>
                  </label>
                ))}
                {!sets.length ? <div className="hint" style={{ padding: 8 }}>No product sets match “{q}”.</div> : null}
              </div>
            </>
          )}
        </Field>
      ) : null}

      {catalogId && showHealth ? (
        <div className="health" aria-live="polite">
          {health.loading ? (busy ? null : <Loading />) : health.error ? <div className="notice bad">{health.error}</div> : result?.rows.map((r, i) => (
            <div key={i} className={`health-row ${r.state}`}>
              <span className="icon">{ICON[r.state]}</span>
              <div>
                <div className="t">{r.title}</div>
                {r.detail ? <div className="d">{r.detail}</div> : null}
                {r.action === 'link' ? (
                  <div style={{ marginTop: 6 }}>
                    <button type="button" className="btn-ghost" onClick={link} disabled={linking}>{linking ? <span className="spinner" /> : null} Link pixel to catalog</button>
                    {linkError ? <div className="d" style={{ color: 'var(--bad)' }}>{linkError}</div> : null}
                  </div>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
