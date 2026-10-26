'use client';
import { ChevronLeft, ChevronRight, Heart, Maximize2, MessageCircle, Play, Send, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { apiGet } from '@/launch-ad/lib/client-api';
import { CTAS } from '@/launch-ad/lib/constants';
import { useAsync } from '@/launch-ad/lib/hooks';
import type { FormState } from '@/launch-ad/lib/types';
import { MediaView } from './PostMedia';
import { Loading, Segmented } from './ui';

interface Page { id: string; name: string; instagram_business_account?: { id: string; username?: string } }
interface Product { id: string; name: string; price?: string; sale_price?: string; image_url?: string; additional_image_urls?: string[]; brand?: string; url?: string }

const MAX_CARDS = 10;
const imagesOf = (p: Product) => [p.image_url, ...(p.additional_image_urls || [])].filter(Boolean).slice(0, 5) as string[];

export function fill(text: string, p?: Product): string {
  if (!p) return text;
  const current = p.sale_price && p.sale_price !== p.price ? p.sale_price : p.price;
  return text
    .replace(/\{\{\s*product\.name[^}]*\}\}/g, p.name || '')
    .replace(/\{\{\s*product\.current_price[^}]*\}\}/g, current || '')
    .replace(/\{\{\s*product\.price[^}]*\}\}/g, p.price || '')
    .replace(/\{\{\s*product\.brand[^}]*\}\}/g, p.brand || '')
    .replace(/\{\{\s*product\.description[^}]*\}\}/g, '');
}

function usePage(pageId: string) {
  const pages = useAsync<Page[]>('pages', () => apiGet('pages'));
  return pages.data?.find((p) => p.id === pageId);
}

/** Catalog ad preview: Feed carousel / single, Stories and Reels, with hover slideshow and click-to-enlarge. */
export function CatalogPreview({ form, productSetId, compact = false, total }: { form: FormState; productSetId: string; compact?: boolean; total?: number }) {
  const ad = form.ad;
  const page = usePage(ad.pageId);
  const ig = page?.instagram_business_account;
  const products = useAsync<Product[]>(productSetId ? `products-${productSetId}` : null, () => apiGet('products', { set: productSetId }));
  const [placement, setPlacement] = useState<'FEED' | 'STORIES' | 'REELS'>('FEED');
  const [idx, setIdx] = useState(0);
  const [tick, setTick] = useState(0);
  const [hoverId, setHoverId] = useState('');
  const [zoom, setZoom] = useState<{ p: Product; i: number } | null>(null);

  useEffect(() => {
    setTick(0);
    if (ad.media !== 'SLIDESHOW' || !hoverId) return;
    const t = setInterval(() => setTick((n) => n + 1), 1100);
    return () => clearInterval(t);
  }, [ad.media, hoverId]);

  useEffect(() => {
    if (!zoom) return;
    const key = (e: KeyboardEvent) => {
      const n = imagesOf(zoom.p).length;
      if (e.key === 'Escape') setZoom(null);
      if (e.key === 'ArrowRight') setZoom({ ...zoom, i: (zoom.i + 1) % n });
      if (e.key === 'ArrowLeft') setZoom({ ...zoom, i: (zoom.i - 1 + n) % n });
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [zoom]);

  const all = products.data || [];
  const sample = useMemo(() => all.slice(0, ad.format === 'SINGLE' ? 1 : MAX_CARDS), [all, ad.format]);
  const steps = ad.format === 'SINGLE' ? sample : all;
  const cur = steps[Math.min(idx, Math.max(steps.length - 1, 0))];
  const ctaLabel = CTAS.find((c) => c.key === ad.cta)?.label || 'Shop now';
  const frame = (p: Product) => (ad.media === 'SLIDESHOW' && p.id === hoverId ? tick : 0);
  const imageFor = (p: Product) => { const imgs = imagesOf(p); return imgs.length ? imgs[frame(p) % imgs.length] : undefined; };
  const badge = (p: Product) => {
    const imgs = imagesOf(p);
    if (ad.media === 'VIDEO') return <span className="media-badge"><Play size={9} fill="#fff" /> Video if available</span>;
    if (ad.media === 'SLIDESHOW') return <span className="media-badge">{imgs.length > 1 ? `${(frame(p) % imgs.length) + 1}/${imgs.length}` : '1 image'}</span>;
    return null;
  };
  const open = (p: Product) => setZoom({ p, i: frame(p) % Math.max(imagesOf(p).length, 1) });
  const pageName = page?.name || 'Your Page';

  return (
    <div className={`preview ${compact ? 'compact' : ''}`} aria-label="Ad preview">
      <div className="preview-tabs">
        <span className="label" style={{ margin: 0 }}>Preview</span>
        <Segmented value={placement} onChange={(v) => { setPlacement(v); setIdx(0); }} options={[{ key: 'FEED', label: 'Feed' }, { key: 'STORIES', label: 'Stories' }, { key: 'REELS', label: 'Reels' }]} />
      </div>

      {!productSetId ? (
        <div className="preview-empty">Pick a product set to preview real products.</div>
      ) : products.loading ? <Loading /> : products.error ? <div className="notice warn">Preview unavailable: {products.error}</div> : !sample.length ? (
        <div className="preview-empty">This product set has no products to preview.</div>
      ) : placement === 'FEED' ? (
        <>
          <div className="preview-head">
            <div className="pg">{pageName.slice(0, 1)}</div>
            <div><div className="n">{pageName}</div><div className="s">Sponsored</div></div>
          </div>
          <div className="preview-text">{fill(ad.message, sample[0]) || 'Primary text'}</div>
          <div className="cards-row">
            {sample.map((p) => {
              const imgs = imagesOf(p);
              return (
                <div key={p.id} className={`p-card ${ad.format === 'SINGLE' ? 'single' : ''}`} onMouseEnter={() => setHoverId(p.id)} onMouseLeave={() => setHoverId('')}>
                  <div className="img zoomable" role="button" tabIndex={0} title="Click to enlarge" aria-label={`Enlarge ${p.name}`} onClick={() => open(p)} onKeyDown={(e) => { if (e.key === 'Enter') open(p); }} style={{ backgroundImage: imageFor(p) ? `url("${imageFor(p)}")` : undefined }}>
                    {badge(p)}
                    <span className="zoom-hint" aria-hidden><Maximize2 size={12} /></span>
                    {ad.media === 'SLIDESHOW' && imgs.length > 1 ? <div className="dots">{imgs.map((_, i) => <span key={i} className={i === frame(p) % imgs.length ? 'on' : ''} />)}</div> : null}
                  </div>
                  <div className="body">
                    <div style={{ minWidth: 0 }}>
                      <div className="h">{fill(ad.headline, p) || p.name}</div>
                      <div className="ds">{fill(ad.description, p)}</div>
                    </div>
                    <span className="cta">{ctaLabel}</span>
                  </div>
                </div>
              );
            })}
            {ad.format === 'CAROUSEL' && ad.endCard ? (
              <div className="p-card end">
                <div className="img">See more at<br />{ad.link.replace(/^https?:\/\//, '') || 'your website'}</div>
                <div className="body"><div className="h">{pageName}</div><span className="cta">{ctaLabel}</span></div>
              </div>
            ) : null}
          </div>
        </>
      ) : cur ? (
        <div className="phone" aria-label={`${placement === 'STORIES' ? 'Stories' : 'Reels'} preview`} onMouseEnter={() => setHoverId(cur.id)} onMouseLeave={() => setHoverId('')}>
          {placement === 'STORIES' ? (
            <>
              <div className="bg" style={{ backgroundImage: imageFor(cur) ? `url("${imageFor(cur)}")` : undefined }} />
              <div className="bars">{steps.slice(0, 20).map((p, i) => <span key={p.id} className={i <= idx ? 'on' : ''} />)}</div>
              <div className="who"><div className="pg">{pageName.slice(0, 1)}</div><div><div>{ig?.username || pageName}</div><div className="s">Sponsored</div></div></div>
              <div className="story-card">
                <div className="img zoomable" role="button" tabIndex={0} title="Click to enlarge" onClick={() => open(cur)} style={{ backgroundImage: imageFor(cur) ? `url("${imageFor(cur)}")` : undefined, position: 'relative' }}>{badge(cur)}<span className="zoom-hint" aria-hidden><Maximize2 size={12} /></span></div>
                <div className="meta"><b>{fill(ad.headline, cur) || cur.name}</b>{fill(ad.description, cur)}</div>
              </div>
              <div className="cta-pill">{ctaLabel}</div>
            </>
          ) : (
            <>
              <div className="reel-img zoomable" role="button" tabIndex={0} title="Click to enlarge" onClick={() => open(cur)} style={{ backgroundImage: imageFor(cur) ? `url("${imageFor(cur)}")` : undefined }} />
              <div className="reel-shade" />
              {badge(cur)}
              <div className="rail"><Heart size={18} /><MessageCircle size={18} /><Send size={18} /></div>
              <div className="reel-text"><b>{ig?.username || pageName} · Sponsored</b>{fill(ad.message, cur).slice(0, 110)}</div>
              <div className="reel-cta"><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{fill(ad.headline, cur) || cur.name}</span><b>{ctaLabel}</b></div>
            </>
          )}
          {steps.length > 1 ? (
            <>
              <button type="button" className="nav" style={{ left: 6 }} aria-label="Previous product" onClick={() => { const i = Math.max(0, idx - 1); setIdx(i); if (hoverId) setHoverId(steps[i].id); }}><ChevronLeft size={14} /></button>
              <button type="button" className="nav" style={{ right: 6 }} aria-label="Next product" onClick={() => { const i = Math.min(steps.length - 1, idx + 1); setIdx(i); if (hoverId) setHoverId(steps[i].id); }}><ChevronRight size={14} /></button>
            </>
          ) : null}
        </div>
      ) : null}

      {productSetId && sample.length ? (
        <p className="hint">
          {placement === 'FEED' ? `${sample.length} of ${total != null && total >= all.length ? total.toLocaleString('en-IN') : `${all.length}${all.length >= 25 ? '+' : ''}`} products` : `Product ${Math.min(idx + 1, steps.length)} of ${steps.length}`}
          {' · '}Click an image to enlarge{ad.media === 'SLIDESHOW' ? ', hover to play its slideshow' : ''}. Meta picks the products per shopper.
        </p>
      ) : null}

      {zoom ? (
        <div className="overlay" role="dialog" aria-modal="true" aria-label={`${zoom.p.name} images`} onClick={(e) => { if (e.target === e.currentTarget) setZoom(null); }}>
          <div className="zoom-box">
            <button type="button" className="icon-btn zoom-close" aria-label="Close" onClick={() => setZoom(null)}><X size={18} /></button>
            <div className="zoom-stage">
              {imagesOf(zoom.p).length > 1 ? <button type="button" className="nav" style={{ left: 10 }} aria-label="Previous image" onClick={() => setZoom({ ...zoom, i: (zoom.i - 1 + imagesOf(zoom.p).length) % imagesOf(zoom.p).length })}><ChevronLeft size={16} /></button> : null}
              {imagesOf(zoom.p)[zoom.i] ? <img src={imagesOf(zoom.p)[zoom.i]} alt={zoom.p.name} /> : <div className="note">No image</div>}
              {imagesOf(zoom.p).length > 1 ? <button type="button" className="nav" style={{ right: 10 }} aria-label="Next image" onClick={() => setZoom({ ...zoom, i: (zoom.i + 1) % imagesOf(zoom.p).length })}><ChevronRight size={16} /></button> : null}
            </div>
            <div className="zoom-meta">
              <div>
                <div className="strong">{zoom.p.name}</div>
                <div className="hint" style={{ marginTop: 2 }}>{[zoom.p.sale_price && zoom.p.sale_price !== zoom.p.price ? `${zoom.p.sale_price} (was ${zoom.p.price})` : zoom.p.price, zoom.p.brand].filter(Boolean).join(' · ')}</div>
                {zoom.p.url ? <div className="hint" style={{ marginTop: 2, wordBreak: 'break-all' }}>Clicks go to {zoom.p.url}</div> : null}
              </div>
              {imagesOf(zoom.p).length > 1 ? <span className="hint">Image {zoom.i + 1} of {imagesOf(zoom.p).length}</span> : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Image ad and existing post previews. */
export function NormalPreview({ form }: { form: FormState }) {
  const ad = form.ad;
  const page = usePage(ad.pageId);
  const pageName = page?.name || 'Your Page';
  const ctaLabel = CTAS.find((c) => c.key === ad.cta)?.label || 'Shop now';
  if (ad.kind === 'POST') {
    return (
      <div className="preview" aria-label="Post preview">
        <div className="preview-tabs"><span className="label" style={{ margin: 0 }}>Preview</span></div>
        {ad.postPreview || ad.postMedia?.length ? (
          <>
            <div className="preview-head"><div className="pg">{pageName.slice(0, 1)}</div><div><div className="n">{pageName}</div><div className="s">Sponsored</div></div></div>
            {ad.postMedia?.length ? <MediaView media={ad.postMedia} /> : <img src={ad.postPreview} alt="" style={{ width: '100%', borderRadius: 8, display: 'block' }} />}
            <p className="hint">The post runs as it is, with its own text and engagement.</p>
          </>
        ) : <div className="preview-empty">Pick a post to preview it.</div>}
      </div>
    );
  }
  return (
    <div className="preview" aria-label="Ad preview">
      <div className="preview-tabs"><span className="label" style={{ margin: 0 }}>Preview</span></div>
      <div className="preview-head"><div className="pg">{pageName.slice(0, 1)}</div><div><div className="n">{pageName}</div><div className="s">Sponsored</div></div></div>
      <div className="preview-text">{ad.message || 'Primary text'}</div>
      <div className="p-card single">
        {ad.videoUrl ? (
          <video className="img" src={ad.videoUrl} poster={ad.imageUrl || undefined} controls playsInline muted preload="metadata" style={{ width: '100%', background: '#000', display: 'block' }} />
        ) : (
          <div className="img" style={{ backgroundImage: ad.imageUrl ? `url("${ad.imageUrl}")` : undefined, backgroundSize: 'cover' }}>{!ad.imageUrl ? <span className="preview-empty" style={{ border: 0 }}>{ad.imageHash ? 'Image uploaded' : 'Upload an image or video'}</span> : null}</div>
        )}
        <div className="body">
          <div style={{ minWidth: 0 }}>
            <div className="ds">{ad.link.replace(/^https?:\/\//, '').split('/')[0].toUpperCase() || 'YOURSTORE.COM'}</div>
            <div className="h">{ad.headline || 'Headline'}</div>
          </div>
          <span className="cta">{ctaLabel}</span>
        </div>
      </div>
      <p className="hint">Feed preview. Meta adapts the {ad.videoUrl ? 'video' : 'image'} for Stories and Reels.</p>
    </div>
  );
}

export default function AdPreview({ form, total }: { form: FormState; total?: number }) {
  return form.ad.kind === 'CATALOG' ? <CatalogPreview form={form} productSetId={form.adset.productSetId} total={total} /> : <NormalPreview form={form} />;
}
