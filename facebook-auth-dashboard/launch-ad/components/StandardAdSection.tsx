'use client';
import { Play } from 'lucide-react';
import { useEffect, useState } from 'react';
import { apiGet } from '@/launch-ad/lib/client-api';
import { CTAS } from '@/launch-ad/lib/constants';
import { useAiStatus } from '@/launch-ad/lib/ai-client';
import { useAsync } from '@/launch-ad/lib/hooks';
import type { FormState, PostMedia } from '@/launch-ad/lib/types';
import AdCopyEditor from './AdCopyEditor';
import AdMediaSection from './AdMediaSection';
import { MediaModal } from './PostMedia';
import TrackingFields from './TrackingFields';
import { Field, Loading, SearchSelect, Segmented, Select, TextInput, Toggle } from './ui';

interface Page { id: string; name: string; website?: string; instagram_business_account?: { id: string; username?: string } }
interface Post { id: string; text: string; image: string; type: string; time: string; link?: string; media?: PostMedia[] }

function pageWebsite(p?: Page): string {
  const first = (p?.website || '').split(/[\s,]+/).find(Boolean);
  if (!first) return '';
  return /^https?:\/\//i.test(first) ? first : `https://${first}`;
}

/** Normal (non-catalog) ad: upload an image or video, or promote an existing Facebook / Instagram post. */
export default function StandardAdSection({ form, setAd, accountId, openDrive = 0 }: {
  form: FormState;
  setAd: (p: Partial<FormState['ad']>) => void;
  accountId: string;
  /** Changes each time the "From Google Drive" card is clicked: opens Drive's picker */
  openDrive?: number;
}) {
  const ad = form.ad;
  const pages = useAsync<Page[]>('pages', () => apiGet('pages'));
  const ai = useAiStatus();
  const page = pages.data?.find((p) => p.id === ad.pageId);
  const ig = page?.instagram_business_account;
  const [linkEdited, setLinkEdited] = useState(false);
  const [playing, setPlaying] = useState<Post | null>(null);

  const posts = useAsync<Post[]>(
    ad.kind === 'POST' && ad.pageId && (ad.postSource === 'FACEBOOK' || ig?.id) ? `posts-${ad.pageId}-${ad.postSource}` : null,
    () => apiGet('posts', { page: ad.pageId, source: ad.postSource, ig: ig?.id }),
  );

  // Product tokens only work in catalog ads; clear them if the text came from a catalog setup.
  useEffect(() => {
    const strip = (t: string) => (t.includes('{{product.') ? '' : t);
    if ([ad.message, ad.headline, ad.description].some((t) => t.includes('{{product.'))) {
      setAd({ message: strip(ad.message), headline: strip(ad.headline), description: strip(ad.description) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ad.kind]);

  useEffect(() => {
    setAd({ instagramUserId: ig?.id || '' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ad.pageId, ig?.id]);

  useEffect(() => {
    if (!page || linkEdited) return;
    setAd({ link: pageWebsite(page) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ad.pageId, page?.website]);

  return (
    <div className="card">
      <Field label="Ad name">
        <TextInput value={ad.name} onChange={(e) => setAd({ name: e.target.value })} placeholder={ad.kind === 'POST' ? 'e.g. Diwali post · Boost' : 'e.g. Diwali sale · Image'} />
      </Field>
      <Field label="Facebook Page">
        {pages.loading ? <Loading /> : pages.error ? <div className="notice bad">{pages.error}</div> : (
          <SearchSelect
            value={ad.pageId}
            onChange={(v) => setAd({ pageId: v, postId: '', postPreview: '' })}
            ariaLabel="Facebook Page"
            noun="Pages"
            placeholder="Select a Page..."
            searchPlaceholder={`Search ${(pages.data || []).length.toLocaleString('en-IN')} Pages by name or ID`}
            options={(pages.data || []).map((p) => ({ key: p.id, label: p.name, meta: [p.id, p.instagram_business_account?.username ? `@${p.instagram_business_account.username}` : ''].filter(Boolean).join(' · ') }))}
          />
        )}
      </Field>
      {page && ad.kind === 'UPLOAD' ? (
        <Field>
          {ig ? (
            <Toggle checked={!!ad.instagramUserId} onChange={(v) => setAd({ instagramUserId: v ? ig.id : '' })} label={<>Run on Instagram as <span className="strong">@{ig.username || ig.id}</span></>} />
          ) : (
            <p className="hint" style={{ margin: 0 }}>This Page has no connected Instagram account, so Instagram placements use the Page name.</p>
          )}
        </Field>
      ) : null}


      {ad.kind === 'UPLOAD' ? (
        <>
          <AdMediaSection ad={ad} setAd={setAd} accountId={accountId} aiVideo={!!(ai?.enabled && ai.videoCopy)} openDrive={openDrive} />
          <AdCopyEditor ad={ad} setAd={setAd} accountId={accountId} pageName={page?.name || ''} />
          <div className="row field">
            <Field label="Call to action"><Select value={ad.cta} onChange={(v) => setAd({ cta: v })} options={CTAS} /></Field>
            <Field label="Website URL" hint={page && !linkEdited ? (pageWebsite(page) ? 'From the Page’s website.' : 'This Page has no website listed; enter one.') : undefined}>
              <TextInput value={ad.link} onChange={(e) => { setLinkEdited(true); setAd({ link: e.target.value }); }} placeholder="https://yourstore.com" />
            </Field>
          </div>
        </>
      ) : (
        <>
          <Field label="Post from">
            <Segmented
              value={ad.postSource}
              onChange={(v) => setAd({ postSource: v, postId: '', postPreview: '' })}
              options={[{ key: 'FACEBOOK', label: 'Facebook Page' }, { key: 'INSTAGRAM', label: 'Instagram account', disabled: !ig, title: !ig ? 'This Page has no connected Instagram account' : undefined }]}
            />
          </Field>
          <Field label="Select post" hint="The post keeps its own text, media and engagement. Its call to action can't be changed.">
            {!ad.pageId ? <div className="note">Select a Page first.</div> : posts.loading ? <Loading /> : posts.error ? <div className="notice bad">{posts.error}</div> : !posts.data?.length ? (
              <div className="note">No recent posts found.</div>
            ) : (
              <div className="post-grid" role="radiogroup" aria-label="Posts">
                {posts.data.map((p) => {
                  const pick = () => setAd({ postId: p.id, postPreview: p.image, postMedia: p.media || [] });
                  const isVideo = (p.media || []).some((m) => m.type === 'video');
                  const many = (p.media || []).length > 1;
                  return (
                    <div key={p.id} role="radio" tabIndex={0} aria-checked={ad.postId === p.id} className={`post ${ad.postId === p.id ? 'on' : ''}`} onClick={pick} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } }}>
                      <span className="thumb" style={{ backgroundImage: p.image ? `url("${p.image}")` : undefined }}>
                        {isVideo || many ? (
                          <button type="button" className="play-chip" onClick={(e) => { e.stopPropagation(); setPlaying(p); }} aria-label={isVideo ? 'Play video' : 'View all items'}>
                            {isVideo ? <><Play size={12} fill="#fff" color="#fff" /> Play</> : `View ${p.media!.length}`}
                          </button>
                        ) : null}
                      </span>
                      <span className="cap">{p.text ? p.text.slice(0, 70) : 'No caption'}</span>
                      <span className="when">{p.time ? new Date(p.time).toLocaleDateString('en-IN') : ''}{p.type === 'REELS' ? ' · Reel' : isVideo ? ' · Video' : many ? ' · Carousel' : ''}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </Field>
        </>
      )}

      <details className="adv">
        <summary>Advanced · tracking</summary>
        <TrackingFields form={form} setAd={setAd} hint="Added to the ad's link." />
      </details>

      {playing?.media?.length ? <MediaModal media={playing.media} caption={playing.text} onClose={() => setPlaying(null)} /> : null}
    </div>
  );
}
