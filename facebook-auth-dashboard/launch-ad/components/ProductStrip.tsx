'use client';
import { apiGet } from '@/launch-ad/lib/client-api';
import { useAsync } from '@/launch-ad/lib/hooks';
import { Loading } from './ui';

/** Thumbnails of the products a catalog ad will draw from. `total` is the product set's real size when known. */
export default function ProductStrip({ setId, label, total }: { setId: string; label?: string; total?: number }) {
  const products = useAsync<{ id: string; name: string; image_url?: string; price?: string }[]>(setId ? `products-${setId}` : null, () => apiGet('products', { set: setId }));
  if (!setId) return null;
  if (products.loading) return <Loading />;
  const list = (products.data || []).filter((p) => p.image_url);
  if (!list.length) return <div className="hint">No product images to show.</div>;
  // Meta returns at most 25 products here: without the set's real size, say "15+ more" rather than a made-up exact number.
  const fetched = (products.data || []).length;
  const shown = Math.min(10, list.length);
  const exact = total != null && total >= fetched;
  const rest = (exact ? total! : fetched) - shown;
  return (
    <div className="product-strip">
      {label ? <div className="label" style={{ marginBottom: 6 }}>{label}</div> : null}
      <div className="strip">
        {list.slice(0, 10).map((p) => (
          <figure key={p.id} title={`${p.name}${p.price ? ` · ${p.price}` : ''}`}>
            <img src={p.image_url} alt={p.name} />
            <figcaption>{p.name}</figcaption>
          </figure>
        ))}
        {rest > 0 ? <div className="more">{!exact && fetched >= 25 ? `${rest}+ more` : `+${rest.toLocaleString('en-IN')} more`}</div> : null}
      </div>
    </div>
  );
}
