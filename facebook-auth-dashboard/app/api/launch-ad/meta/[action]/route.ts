import { NextRequest, NextResponse } from 'next/server';
import type { CopyRequest } from '@/launch-ad/lib/ai-types';
import { aiStatus, generateCopy } from '@/launch-ad/lib/ai-copy';
import { graph, graphLog, GraphError } from '@/launch-ad/lib/graph';
import { buildTargeting, launch } from '@/launch-ad/lib/launch';
import { getSession } from '@/launch-ad/lib/session';
import type { FlowContext, FormState, GraphCall, LaunchRequest } from '@/launch-ad/lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/* eslint-disable @typescript-eslint/no-explicit-any */

const LIVE = ['ACTIVE', 'PAUSED', 'IN_PROCESS', 'WITH_ISSUES', 'CAMPAIGN_PAUSED', 'ADSET_PAUSED'];
const act = (id: string | null) => {
  if (!id) throw new GraphError({ message: 'Missing ad account' });
  return id.startsWith('act_') ? id : `act_${id}`;
};
const need = (v: string | null, name: string) => {
  if (!v) throw new GraphError({ message: `Missing ${name}` });
  return v;
};

async function safe<T>(fn: () => Promise<T>): Promise<T | { unavailable: string }> {
  try { return await fn(); } catch (e) { return { unavailable: (e as Error).message }; }
}

async function handleGet(action: string, q: URLSearchParams, token: string): Promise<any> {
  switch (action) {
    case 'adaccounts':
      return graph.list('me/adaccounts', token, { fields: 'id,account_id,name,currency,account_status,timezone_name,business{id,name}', limit: 100 }, 20);

    case 'campaigns':
      return graph.list(`${act(q.get('account'))}/campaigns`, token, {
        fields: 'id,name,objective,status,effective_status,daily_budget,lifetime_budget,bid_strategy,promoted_object,updated_time,adsets.limit(0).summary(true),insights.date_preset(last_7d){spend}',
        filtering: [{ field: 'effective_status', operator: 'IN', value: LIVE }],
        limit: 100,
      });

    case 'adsets': {
      // One campaign's ad sets (loaded when it is expanded), a name search, or the whole account.
      const campaign = q.get('campaign');
      const search = (q.get('search') || '').trim();
      const filtering: any[] = [{ field: 'effective_status', operator: 'IN', value: q.get('archived') ? [...LIVE, 'ARCHIVED'] : LIVE }];
      if (search) filtering.push({ field: 'name', operator: 'CONTAIN', value: search });
      return graph.list(campaign ? `${campaign}/adsets` : `${act(q.get('account'))}/adsets`, token, {
        fields: 'id,name,status,effective_status,campaign{id,name,objective,daily_budget,lifetime_budget,bid_strategy,promoted_object},optimization_goal,billing_event,destination_type,promoted_object,targeting,attribution_spec,daily_budget,lifetime_budget,bid_strategy,bid_amount,start_time,end_time,updated_time,ads.limit(0).summary(true),insights.date_preset(last_7d){spend,actions,purchase_roas}',
        filtering,
        limit: search ? 50 : 100,
      }, search ? 1 : 5);
    }

    case 'pixels':
      return graph.list(`${act(q.get('account'))}/adspixels`, token, { fields: 'id,name', limit: 100 });

    case 'saved-audiences':
      return graph.list(`${act(q.get('account'))}/saved_audiences`, token, { fields: 'id,name,targeting', limit: 100 });

    case 'custom-audiences': {
      // Custom audiences and lookalikes of the ad account. Counts and status are asked for first and dropped if Meta refuses them.
      const actId = act(q.get('account'));
      const ask = (fields: string) => graph.list<any>(`${actId}/customaudiences`, token, { fields, limit: 200 }, 5);
      try { return await ask('id,name,subtype,approximate_count_lower_bound,approximate_count_upper_bound,operation_status'); }
      catch { return await ask('id,name,subtype'); }
    }

    case 'interest-suggestions': {
      // Interests Meta finds related to the ones already chosen.
      let names: unknown = [];
      try { names = JSON.parse(q.get('names') || '[]'); } catch { /* none */ }
      const list = (Array.isArray(names) ? names : []).filter((n): n is string => typeof n === 'string' && !!n.trim()).slice(0, 8);
      if (!list.length) return [];
      const res = await graph.get<{ data: any[] }>('search', token, { type: 'adinterestsuggestion', interest_list: list, limit: 20 });
      return res.data;
    }

    case 'pages':
      return graph.list('me/accounts', token, { fields: 'id,name,website,link,instagram_business_account{id,username}', limit: 100 });

    case 'catalogs': {
      // Meta has no ad-account catalog edge: catalogs belong to a business. Scope them to this ad account by
      // (1) catalogs its campaigns already use, (2) catalogs linked to its datasets, then (3) the rest of its business.
      const actId = act(q.get('account'));
      const fields = 'id,name,product_count,vertical';
      const [account, campaigns, pixels] = await Promise.all([
        graph.get<{ business?: { id: string; name?: string } }>(actId, token, { fields: 'business{id,name}' }),
        safe(() => graph.list<any>(`${actId}/campaigns`, token, {
          fields: 'promoted_object',
          filtering: [{ field: 'effective_status', operator: 'IN', value: [...LIVE, 'ARCHIVED'] }],
          limit: 200,
        }, 3)),
        safe(() => graph.list<{ id: string }>(`${actId}/adspixels`, token, { fields: 'id', limit: 100 })),
      ]);
      const used = new Set<string>(Array.isArray(campaigns) ? campaigns.map((c) => c.promoted_object?.product_catalog_id).filter(Boolean) : []);
      const pixelIds = new Set<string>(Array.isArray(pixels) ? pixels.map((p) => p.id) : []);

      const seen = new Map<string, any>();
      const biz = account.business;
      if (biz?.id) {
        for (const edge of ['owned_product_catalogs', 'client_product_catalogs']) {
          const list = await safe(() => graph.list<any>(`${biz.id}/${edge}`, token, { fields, limit: 100 }));
          if (Array.isArray(list)) list.forEach((c) => seen.set(c.id, { ...c, business: biz.name, shared: edge === 'client_product_catalogs' }));
        }
      }
      // Catalogs this account uses but the business listing didn't return (e.g. shared from elsewhere).
      for (const id of Array.from(used)) {
        if (seen.has(id)) continue;
        const c = await safe(() => graph.get<any>(id, token, { fields }));
        if (c && !('unavailable' in c)) seen.set(id, c);
      }
      // Linked to one of this account's datasets (checked for up to 40 catalogs, in parallel).
      const all = Array.from(seen.values());
      const linked = new Set<string>();
      if (pixelIds.size) {
        await Promise.all(all.slice(0, 40).map(async (c) => {
          const src = await safe(() => graph.list<{ id: string }>(`${c.id}/external_event_sources`, token, { fields: 'id', limit: 50 }, 1));
          if (Array.isArray(src) && src.some((s) => pixelIds.has(s.id))) linked.add(c.id);
        }));
      }
      const rank = (c: any) => (used.has(c.id) ? 0 : linked.has(c.id) ? 1 : 2);
      return all
        .map((c) => ({ ...c, relevance: used.has(c.id) ? 'USED' : linked.has(c.id) ? 'LINKED' : 'BUSINESS' }))
        .sort((x, y) => rank(x) - rank(y) || String(x.name).localeCompare(String(y.name)));
    }

    case 'product-sets':
      // A few product images per set, in the same request, so sets can be recognised at a glance.
      return graph.list(`${need(q.get('catalog'), 'catalog')}/product_sets`, token, { fields: 'id,name,product_count,products.limit(4){id,image_url}', limit: 100 });

    case 'set-health': {
      // Out-of-stock count and a sample of product links opened to check they land on a real product page.
      const set = need(q.get('set'), 'set');
      const [oos, sample] = await Promise.all([
        safe(() => graph.get<{ data: any[]; summary?: { total_count?: number } }>(`${set}/products`, token, { fields: 'id', filter: { availability: { eq: 'out of stock' } }, limit: 100, summary: true })),
        graph.get<{ data: { id: string; name: string; url?: string }[] }>(`${set}/products`, token, { fields: 'id,name,url', limit: 8 }),
      ]);
      const outOfStock = 'unavailable' in oos ? null : (oos.summary?.total_count ?? oos.data.length);
      const links = await Promise.all(sample.data.filter((p) => p.url).map(async (p) => {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 6000);
        try {
          let res = await fetch(p.url!, { method: 'HEAD', redirect: 'follow', signal: ctrl.signal, cache: 'no-store' });
          if (res.status === 405 || res.status === 403) res = await fetch(p.url!, { method: 'GET', redirect: 'follow', signal: ctrl.signal, cache: 'no-store' });
          const from = new URL(p.url!); const to = new URL(res.url || p.url!);
          const toHome = from.pathname.replace(/\/$/, '') !== '' && (to.pathname === '/' || to.pathname === '');
          return { id: p.id, name: p.name, url: p.url, status: res.status, ok: res.ok && !toHome, reason: !res.ok ? `Returns ${res.status}` : toHome ? 'Redirects to the homepage' : '' };
        } catch (e) {
          return { id: p.id, name: p.name, url: p.url, status: 0, ok: false, reason: (e as Error).name === 'AbortError' ? 'Took too long to load' : 'Could not be opened' };
        } finally { clearTimeout(t); }
      }));
      return { outOfStock, links, noUrl: sample.data.filter((p) => !p.url).length };
    }

    case 'products': {
      const set = q.get('set');
      const path = set ? `${set}/products` : `${need(q.get('catalog'), 'catalog')}/products`;
      const res = await graph.get<{ data: any[] }>(path, token, { fields: 'id,name,price,sale_price,image_url,additional_image_urls,url,brand,availability', limit: 25 });
      return res.data;
    }

    case 'health': {
      const catalog = need(q.get('catalog'), 'catalog');
      const pixel = q.get('pixel');
      const [info, sources, stats, diagnostics, checks] = await Promise.all([
        safe(() => graph.get<any>(catalog, token, { fields: 'id,name,product_count,vertical' })),
        safe(() => graph.list<any>(`${catalog}/external_event_sources`, token, { fields: 'id,name', limit: 50 })),
        safe(() => graph.get<any>(`${catalog}/event_stats`, token)),
        safe(() => graph.get<any>(`${catalog}/diagnostics`, token)),
        pixel ? safe(() => graph.get<any>(`${pixel}/da_checks`, token, { fields: 'key,title,description,result,action_uri' })) : Promise.resolve(null),
      ]);
      return { info, sources, stats, diagnostics, checks };
    }

    case 'search': {
      const type = need(q.get('type'), 'type');
      if (!['adgeolocation', 'adlocale', 'adinterest'].includes(type)) throw new GraphError({ message: 'Unsupported search type' });
      const params: any = { type, q: q.get('q') || '', limit: 10 };
      if (type === 'adgeolocation') params.location_types = ['country', 'region', 'city'];
      const res = await graph.get<{ data: any[] }>('search', token, params);
      return res.data;
    }

    case 'posts': {
      // Recent posts to promote as an existing-post ad.
      const page = need(q.get('page'), 'page');
      // Each post carries its playable media: images, videos (with poster) and every item of a carousel.
      if (q.get('source') === 'INSTAGRAM') {
        const ig = need(q.get('ig'), 'Instagram account');
        const res = await graph.get<{ data: any[] }>(`${ig}/media`, token, { fields: 'id,caption,media_type,media_product_type,media_url,thumbnail_url,timestamp,permalink,children{media_type,media_url,thumbnail_url}', limit: 24 });
        const item = (m: any) => (m.media_type === 'VIDEO' ? { type: 'video', url: m.media_url || '', poster: m.thumbnail_url || '' } : { type: 'image', url: m.media_url || m.thumbnail_url || '' });
        return res.data.map((m) => ({
          id: m.id, text: m.caption || '', image: m.thumbnail_url || m.media_url || '', time: m.timestamp, link: m.permalink,
          type: m.media_product_type === 'REELS' ? 'REELS' : m.media_type,
          media: (m.media_type === 'CAROUSEL_ALBUM' ? (m.children?.data || []).map(item) : [item(m)]).filter((x: any) => x.url),
        }));
      }
      // Page posts need the Page's own token, read server-side and never sent to the browser.
      const pg = await graph.get<{ access_token?: string }>(page, token, { fields: 'access_token' });
      const res = await graph.get<{ data: any[] }>(`${page}/published_posts`, pg.access_token || token, { fields: 'id,message,full_picture,created_time,permalink_url,attachments{media_type,media,subattachments{media_type,media}}', limit: 24 });
      const fbItem = (a: any) => (/video/i.test(a?.media_type || '') && a?.media?.source
        ? { type: 'video', url: a.media.source, poster: a.media?.image?.src || '' }
        : { type: 'image', url: a?.media?.image?.src || '' });
      return res.data.map((p) => {
        const att = p.attachments?.data?.[0];
        const subs = att?.subattachments?.data || [];
        const media = (subs.length ? subs.map(fbItem) : att ? [fbItem(att)] : []).filter((x: any) => x.url);
        return { id: p.id, text: p.message || '', image: p.full_picture || '', type: media.some((x: any) => x.type === 'video') ? 'VIDEO' : subs.length > 1 ? 'CAROUSEL_ALBUM' : 'POST', time: p.created_time, link: p.permalink_url, media: media.length ? media : p.full_picture ? [{ type: 'image', url: p.full_picture }] : [] };
      });
    }

    case 'catalog-performance': {
      // Ad-level results for the date range, each ad marked catalog or not. A catalog ad has a product set on
      // its creative or ad set, or sits in a campaign with a catalog.
      const actId = act(q.get('account'));
      const time_range = { since: need(q.get('since'), 'since'), until: need(q.get('until'), 'until') };
      const rows = await graph.list<any>(`${actId}/insights`, token, {
        level: 'ad', time_range, limit: 500,
        fields: 'ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,spend,reach,impressions,clicks,actions,action_values',
      }, 10);
      const ids = Array.from(new Set(rows.map((r) => r.ad_id)));
      const meta: Record<string, any> = {};
      const batches: string[][] = [];
      for (let i = 0; i < ids.length; i += 50) batches.push(ids.slice(i, i + 50));
      await Promise.all(batches.map(async (chunk) => {
        const res = await safe(() => graph.get<Record<string, any>>('', token, { ids: chunk.join(','), fields: 'effective_status,creative{thumbnail_url,product_set_id},adset{promoted_object},campaign{promoted_object}' }));
        if (!('unavailable' in res)) Object.assign(meta, res);
      }));
      const PURCHASE = ['omni_purchase', 'purchase', 'offsite_conversion.fb_pixel_purchase'];
      const pick = (list?: { action_type: string; value: string }[]) => {
        for (const t of PURCHASE) { const hit = list?.find((x) => x.action_type === t); if (hit) return Number(hit.value) || 0; }
        return 0;
      };
      return rows.map((r) => {
        const m = meta[r.ad_id] || {};
        const productSetId = m.creative?.product_set_id || m.adset?.promoted_object?.product_set_id || '';
        const catalogId = m.campaign?.promoted_object?.product_catalog_id || m.adset?.promoted_object?.product_catalog_id || '';
        return {
          id: r.ad_id, name: r.ad_name, adset: r.adset_name, campaign: r.campaign_name,
          status: m.effective_status || '', thumb: m.creative?.thumbnail_url || '',
          productSetId, catalogId, isCatalog: !!(productSetId || catalogId),
          spend: Number(r.spend) || 0, reach: Number(r.reach) || 0, impressions: Number(r.impressions) || 0, clicks: Number(r.clicks) || 0,
          purchases: pick(r.actions), value: pick(r.action_values),
        };
      });
    }

    case 'video-status': {
      // Meta processes uploaded videos before they can be used in an ad.
      const v = await graph.get<{ status?: { video_status?: string; processing_progress?: number } }>(need(q.get('video'), 'video'), token, { fields: 'status' });
      return { status: v.status?.video_status || 'processing', progress: v.status?.processing_progress ?? null };
    }

    case 'ai-status':
      // Whether AI writing is set up on this server (the button stays hidden when it isn't).
      return aiStatus();

    case 'me':
      return graph.get('me', token, { fields: 'id,name' });
  }
  throw new GraphError({ message: `Unknown action ${action}` }, 404);
}

async function handlePost(action: string, body: any, token: string): Promise<any> {
  switch (action) {
    case 'link-pixel':
      return graph.post(`${need(body.catalog, 'catalog')}/external_event_sources`, token, {
        external_event_sources: [need(body.pixel, 'pixel')],
      });
    case 'upload-image': {
      // Image for a new ad: stored in the ad account's image library, referenced by hash.
      const bytes = need(body.bytes, 'image');
      if (bytes.length > 4_200_000) throw new GraphError({ message: 'Image is too large. Use an image under 3 MB.' });
      const res = await graph.post<{ images: Record<string, { hash: string; url: string }> }>(`${act(body.account)}/adimages`, token, { bytes, name: body.name || 'image' });
      const first = Object.values(res.images || {})[0];
      if (!first) throw new GraphError({ message: 'Facebook did not return an image hash.' });
      return { hash: first.hash, url: first.url };
    }
    case 'upload-video': {
      // Resumable upload to the ad account's video library: start, (chunks via upload-video-chunk), finish.
      const actId = act(body.account);
      if (body.phase === 'start') {
        const size = Number(body.size);
        if (!(size > 0) || size > 1_000_000_000) throw new GraphError({ message: 'Use a video under 1 GB.' });
        return graph.post<{ upload_session_id: string; video_id: string; start_offset: string; end_offset: string }>(`${actId}/advideos`, token, { upload_phase: 'start', file_size: size });
      }
      if (body.phase === 'finish') {
        return graph.post(`${actId}/advideos`, token, { upload_phase: 'finish', upload_session_id: need(body.session, 'upload session'), title: body.name || 'Video' });
      }
      throw new GraphError({ message: 'Unknown upload phase' });
    }
    case 'audience-estimate': {
      // Meta's estimate of how many people match the audience as it would be launched.
      const form = body.form as FormState; const ctx = body.ctx as FlowContext;
      if (ctx.isCatalog && form.adset.catalogAudience !== 'BROAD') return { available: false, reason: 'Retargeting audiences have no size estimate.' };
      let saved: any;
      if (form.adset.audienceType === 'SAVED' && form.adset.savedAudienceId) saved = (await graph.get<{ targeting: any }>(form.adset.savedAudienceId, token, { fields: 'targeting' })).targeting;
      const spec = buildTargeting(form, ctx, saved);
      if (!spec.geo_locations || !Object.keys(spec.geo_locations).length) return { available: false, reason: 'Add a location to see the estimate.' };
      // The estimate takes a plain spec: Advantage+ settings are removed and its age range becomes a plain one.
      delete spec.targeting_automation; delete spec.targeting_optimization; delete spec.targeting_relaxation_types;
      if (spec.age_range) { spec.age_min = spec.age_range[0]; spec.age_max = spec.age_range[1]; delete spec.age_range; }
      if (!spec.age_max) spec.age_max = 65;
      const res = await graph.get<{ data: any[] }>(`${act(body.accountId)}/delivery_estimate`, token, { targeting_spec: spec, optimization_goal: 'REACH' });
      const e = res.data?.[0];
      if (!e) return { available: false, reason: 'Meta returned no estimate.' };
      return { available: true, ready: e.estimate_ready !== false, daily: e.estimate_dau ?? null, lower: e.estimate_mau_lower_bound ?? e.estimate_mau ?? null, upper: e.estimate_mau_upper_bound ?? e.estimate_mau ?? null };
    }
    case 'ai-copy':
      return generateCopy(body as CopyRequest, token);
    case 'launch':
      return launch(body as LaunchRequest, token);
  }
  throw new GraphError({ message: `Unknown action ${action}` }, 404);
}

function errorResponse(e: unknown, log: GraphCall[]) {
  if (e instanceof GraphError) return NextResponse.json({ error: e.meta, log }, { status: e.status });
  return NextResponse.json({ error: { message: (e as Error).message || 'Unexpected error' }, log }, { status: 500 });
}

// Every response carries `log`: the Graph API calls made to answer it (shown in the API log panel).
export async function GET(req: NextRequest, ctx: { params: Promise<{ action: string }> }) {
  const params = await ctx.params;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: { message: 'Not logged in' }, log: [] }, { status: 401 });
  const log: GraphCall[] = [];
  try {
    const data = await graphLog.run(log, () => handleGet(params.action, req.nextUrl.searchParams, session.token));
    return NextResponse.json({ data, log });
  } catch (e) {
    return errorResponse(e, log);
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ action: string }> }) {
  const params = await ctx.params;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: { message: 'Not logged in' }, log: [] }, { status: 401 });
  const log: GraphCall[] = [];
  try {
    // Video chunks arrive as raw bytes (each under the 4.5 MB request limit) and go to Meta as multipart.
    if (params.action === 'upload-video-chunk') {
      const q = req.nextUrl.searchParams;
      const chunk = new Blob([await req.arrayBuffer()]);
      const data = await graphLog.run(log, () => graph.postFile<{ start_offset: string; end_offset: string }>(`${act(q.get('account'))}/advideos`, session.token, {
        upload_phase: 'transfer', upload_session_id: need(q.get('session'), 'upload session'), start_offset: need(q.get('offset'), 'offset'),
      }, { field: 'video_file_chunk', data: chunk, name: 'chunk' }));
      return NextResponse.json({ data, log });
    }
    const body = await req.json();
    const data = await graphLog.run(log, () => handlePost(params.action, body, session.token));
    return NextResponse.json({ data, log });
  } catch (e) {
    return errorResponse(e, log);
  }
}
