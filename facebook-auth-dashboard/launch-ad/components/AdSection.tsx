'use client';
import { useEffect, useState } from 'react';
import { apiGet } from '@/launch-ad/lib/client-api';
import { CTAS, PRODUCT_TOKENS } from '@/launch-ad/lib/constants';
import { useAsync } from '@/launch-ad/lib/hooks';
import { CATALOG_AD_TEXT } from '@/launch-ad/lib/form';
import type { FormState } from '@/launch-ad/lib/types';
import TrackingFields from './TrackingFields';
import { Field, Loading, SearchSelect, Segmented, Select, TextInput, Toggle } from './ui';

interface Page { id: string; name: string; website?: string; link?: string; instagram_business_account?: { id: string; username?: string } }

/** A Page's website field can hold several space-separated sites, with or without https://. */
export function pageWebsite(p?: { website?: string }): string {
  const first = (p?.website || '').split(/[\s,]+/).find(Boolean);
  if (!first) return '';
  return /^https?:\/\//i.test(first) ? first : `https://${first}`;
}

function Tokens({ onInsert }: { onInsert: (t: string) => void }) {
  return (
    <div className="tokens">
      {PRODUCT_TOKENS.map((t) => <button key={t.token} type="button" onClick={() => onInsert(t.token)} title={t.token}>+ {t.label}</button>)}
    </div>
  );
}

/** Catalog ad form: text, format, media and link. (The live preview is in the workspace's side panel.) */
export default function AdSection({ form, setAd }: {
  form: FormState;
  setAd: (p: Partial<FormState['ad']>) => void;
}) {
  const ad = form.ad;
  const pages = useAsync<Page[]>('pages', () => apiGet('pages'));
  const [linkEdited, setLinkEdited] = useState(false);
  const page = pages.data?.find((p) => p.id === ad.pageId);
  const ig = page?.instagram_business_account;

  useEffect(() => {
    if (!ad.message && !ad.headline && !ad.description) setAd({ ...CATALOG_AD_TEXT });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    setAd({ instagramUserId: ig?.id || '' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ad.pageId, ig?.id]);
  useEffect(() => {
    if (!page || linkEdited) return;
    setAd({ link: pageWebsite(page) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ad.pageId, page?.website]);
  useEffect(() => {
    if (ad.format === 'SINGLE' && ad.media === 'SLIDESHOW') setAd({ media: 'IMAGES' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ad.format]);

  return (
    <div className="card">
      <Field label="Ad name">
        <TextInput value={ad.name} onChange={(e) => setAd({ name: e.target.value })} placeholder="e.g. Skin care · Retarget · Carousel" />
      </Field>
      <Field label="Facebook Page">
        {pages.loading ? <Loading /> : pages.error ? <div className="notice bad">{pages.error}</div> : (
          <SearchSelect
            value={ad.pageId}
            onChange={(v) => setAd({ pageId: v })}
            ariaLabel="Facebook Page"
            noun="Pages"
            placeholder="Select a Page..."
            searchPlaceholder={`Search ${(pages.data || []).length.toLocaleString('en-IN')} Pages by name`}
            options={(pages.data || []).map((p) => ({ key: p.id, label: p.name, meta: p.instagram_business_account?.username ? `@${p.instagram_business_account.username}` : '' }))}
          />
        )}
      </Field>
      {page ? (
        <Field>
          {ig ? (
            <Toggle checked={!!ad.instagramUserId} onChange={(v) => setAd({ instagramUserId: v ? ig.id : '' })} label={<>Run on Instagram as <span className="strong">@{ig.username || ig.id}</span></>} />
          ) : <p className="hint" style={{ margin: 0 }}>This Page has no connected Instagram account, so Instagram placements use the Page name.</p>}
        </Field>
      ) : null}

      <div className="subhead">Format</div>
      <Field>
        <Segmented value={ad.format} onChange={(v) => setAd({ format: v })} options={[{ key: 'CAROUSEL', label: 'Carousel' }, { key: 'SINGLE', label: 'Single image or video' }]} />
      </Field>
      <Field
        label="Media"
        hint={ad.media === 'SLIDESHOW' ? 'Each card plays the product’s images from the catalog.' : ad.media === 'VIDEO' ? 'Products with a video in the catalog show it; others show their image.' : 'Each product shows its main catalog image.'}
      >
        <Segmented
          value={ad.media}
          onChange={(v) => setAd({ media: v })}
          options={[
            { key: 'IMAGES', label: 'Images' },
            { key: 'SLIDESHOW', label: 'Slideshow', disabled: ad.format === 'SINGLE', title: ad.format === 'SINGLE' ? 'Carousel only' : 'Multiple images per product' },
            { key: 'VIDEO', label: 'Product videos' },
          ]}
        />
      </Field>

      <div className="subhead">Text</div>
      <Field label="Primary text">
        <textarea className="input" value={ad.message} onChange={(e) => setAd({ message: e.target.value })} rows={3} />
        <Tokens onInsert={(t) => setAd({ message: `${ad.message}${ad.message.endsWith(' ') || !ad.message ? '' : ' '}${t}` })} />
      </Field>
      <div className="row field">
        <Field label="Headline">
          <TextInput value={ad.headline} onChange={(e) => setAd({ headline: e.target.value })} />
          <Tokens onInsert={(t) => setAd({ headline: `${ad.headline}${ad.headline && !ad.headline.endsWith(' ') ? ' ' : ''}${t}` })} />
        </Field>
        <Field label="Description">
          <TextInput value={ad.description} onChange={(e) => setAd({ description: e.target.value })} />
          <Tokens onInsert={(t) => setAd({ description: `${ad.description}${ad.description && !ad.description.endsWith(' ') ? ' ' : ''}${t}` })} />
        </Field>
      </div>
      <Field label="Call to action">
        <Select value={ad.cta} onChange={(v) => setAd({ cta: v })} options={CTAS} />
      </Field>

      <div className="subhead">Where people go</div>
      <Field hint="Each product opens its own page from the catalog.">
        <Segmented value={ad.destination} onChange={(v) => setAd({ destination: v })} options={[{ key: 'WEBSITE', label: 'Website' }, { key: 'APP_WEB', label: 'App, website as backup' }]} />
      </Field>
      <Field label="See more URL" hint={page && !linkEdited ? (pageWebsite(page) ? 'From the Page’s website. Used by the last card and the See more link.' : 'This Page has no website listed; enter one.') : 'Used by the last card and the See more link.'}>
        <TextInput value={ad.link} onChange={(e) => { setLinkEdited(true); setAd({ link: e.target.value }); }} placeholder="https://yourstore.com" />
      </Field>

      <details className="adv">
        <summary>Advanced · tracking and end card</summary>
        {ad.format === 'CAROUSEL' ? (
          <Field>
            <Toggle checked={ad.endCard} onChange={(v) => setAd({ endCard: v })} label="Add a card at the end with your Page profile picture" />
          </Field>
        ) : null}
        <TrackingFields form={form} setAd={setAd} hint="Added to every product link." />
      </details>

    </div>
  );
}
