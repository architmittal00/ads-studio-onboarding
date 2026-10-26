import { graphGet, graphGetAllPages, graphGetInsights, graphPost } from "@/lib/facebookGraph";

// Catalog Ads' own Graph calls — ported from sr-ads-launch's
// src/app/api/meta/[action]/route.ts (the 'catalogs'/'product-sets'/etc.
// branches), translated onto this app's existing graphGet/graphGetAllPages/
// graphPost (lib/facebookGraph.js) instead of that repo's own graph.ts, so
// these calls get this app's appsecret_proof, pagination, error-shaping and
// /logs integration for free rather than a second copy of any of that.

const LIVE_STATUSES = ["ACTIVE", "PAUSED", "IN_PROCESS", "WITH_ISSUES", "CAMPAIGN_PAUSED", "ADSET_PAUSED"];

export function toAccountId(id) {
  if (!id) throw new Error("Missing ad account");
  return id.startsWith("act_") ? id : `act_${id}`;
}

function need(value, name) {
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

// Wraps a non-essential lookup (e.g. "is this catalog linked to a pixel")
// so one failing sub-call degrades to {unavailable} instead of failing the
// whole response — same convention sr-ads-launch's own `safe()` used.
async function safe(fn) {
  try {
    return await fn();
  } catch (err) {
    return { unavailable: err.message };
  }
}

// Meta has no ad-account→catalog edge: catalogs belong to a Business.
// Scopes them to this ad account by (1) catalogs its campaigns already use,
// (2) catalogs linked to one of its pixels (checked for up to 40 catalogs,
// in parallel), then (3) the rest of its Business — same three-tier
// relevance ranking as the source app, so the most relevant catalogs sort
// first instead of an arbitrary Business-wide order.
export async function fetchCatalogs(token, accountId) {
  const actId = toAccountId(accountId);
  const fields = "id,name,product_count,vertical";

  const [account, campaignsResult, pixelsResult] = await Promise.all([
    graphGet(`/${actId}`, token, { fields: "business{id,name}" }),
    safe(async () => {
      const page = await graphGetAllPages(`/${actId}/campaigns`, token, {
        fields: "promoted_object",
        filtering: [{ field: "effective_status", operator: "IN", value: [...LIVE_STATUSES, "ARCHIVED"] }],
        limit: 200,
      });
      return page.data || [];
    }),
    safe(async () => {
      const page = await graphGetAllPages(`/${actId}/adspixels`, token, { fields: "id", limit: 100 });
      return page.data || [];
    }),
  ]);

  const used = new Set(
    Array.isArray(campaignsResult) ? campaignsResult.map((c) => c.promoted_object?.product_catalog_id).filter(Boolean) : []
  );
  const pixelIds = new Set(Array.isArray(pixelsResult) ? pixelsResult.map((p) => p.id) : []);

  const seen = new Map();
  const business = account.business;
  if (business?.id) {
    for (const edge of ["owned_product_catalogs", "client_product_catalogs"]) {
      const list = await safe(async () => {
        const page = await graphGetAllPages(`/${business.id}/${edge}`, token, { fields, limit: 100 });
        return page.data || [];
      });
      if (Array.isArray(list)) {
        list.forEach((c) => seen.set(c.id, { ...c, business: business.name, shared: edge === "client_product_catalogs" }));
      }
    }
  }
  // Catalogs this account uses but the Business listing didn't return (e.g. shared from elsewhere).
  for (const id of Array.from(used)) {
    if (seen.has(id)) continue;
    const c = await safe(() => graphGet(`/${id}`, token, { fields }));
    if (c && !("unavailable" in c)) seen.set(id, c);
  }
  // Linked to one of this account's pixels (checked for up to 40 catalogs, in parallel).
  const all = Array.from(seen.values());
  const linked = new Set();
  if (pixelIds.size) {
    await Promise.all(
      all.slice(0, 40).map(async (c) => {
        const src = await safe(async () => {
          const page = await graphGetAllPages(`/${c.id}/external_event_sources`, token, { fields: "id", limit: 50 });
          return page.data || [];
        });
        if (Array.isArray(src) && src.some((s) => pixelIds.has(s.id))) linked.add(c.id);
      })
    );
  }
  const rank = (c) => (used.has(c.id) ? 0 : linked.has(c.id) ? 1 : 2);
  return all
    .map((c) => ({ ...c, relevance: used.has(c.id) ? "USED" : linked.has(c.id) ? "LINKED" : "BUSINESS" }))
    .sort((x, y) => rank(x) - rank(y) || String(x.name).localeCompare(String(y.name)));
}

// A few product images per set, in the same request, so sets can be
// recognised at a glance (same shape the source app's Product Sets tab uses).
export async function fetchProductSets(token, catalogId) {
  const page = await graphGetAllPages(`/${need(catalogId, "catalog")}/product_sets`, token, {
    fields: "id,name,product_count,products.limit(4){id,image_url}",
    limit: 100,
  });
  return page.data || [];
}

export async function fetchProducts(token, { catalogId, setId }) {
  const path = setId ? `/${setId}/products` : `/${need(catalogId, "catalog")}/products`;
  const json = await graphGet(path, token, {
    fields: "id,name,price,sale_price,image_url,additional_image_urls,url,brand,availability",
    limit: 25,
  });
  return json.data || [];
}

// Out-of-stock count and a sample of product links opened to check they
// land on a real product page (not a 404 or the catalog's homepage) — the
// same two checks the source app's "View products" screen surfaces.
export async function fetchSetHealth(token, setId) {
  const set = need(setId, "set");
  const [oos, sample] = await Promise.all([
    safe(() =>
      graphGet(`/${set}/products`, token, {
        fields: "id",
        filter: { availability: { eq: "out of stock" } },
        limit: 100,
        summary: true,
      })
    ),
    graphGet(`/${set}/products`, token, { fields: "id,name,url", limit: 8 }),
  ]);
  const outOfStock = "unavailable" in oos ? null : oos.summary?.total_count ?? (oos.data || []).length;

  const links = await Promise.all(
    (sample.data || [])
      .filter((p) => p.url)
      .map(async (p) => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 6000);
        try {
          let res = await fetch(p.url, { method: "HEAD", redirect: "follow", signal: controller.signal, cache: "no-store" });
          if (res.status === 405 || res.status === 403) {
            res = await fetch(p.url, { method: "GET", redirect: "follow", signal: controller.signal, cache: "no-store" });
          }
          const from = new URL(p.url);
          const to = new URL(res.url || p.url);
          const toHome = from.pathname.replace(/\/$/, "") !== "" && (to.pathname === "/" || to.pathname === "");
          return {
            id: p.id,
            name: p.name,
            url: p.url,
            status: res.status,
            ok: res.ok && !toHome,
            reason: !res.ok ? `Returns ${res.status}` : toHome ? "Redirects to the homepage" : "",
          };
        } catch (err) {
          return {
            id: p.id,
            name: p.name,
            url: p.url,
            status: 0,
            ok: false,
            reason: err.name === "AbortError" ? "Took too long to load" : "Could not be opened",
          };
        } finally {
          clearTimeout(timeout);
        }
      })
  );
  return { outOfStock, links, noUrl: (sample.data || []).filter((p) => !p.url).length };
}

// Catalog-level diagnostics + whether a given pixel is linked to it (the
// CatalogPanel status lines: "N products in catalog" / "Pixel linked" with
// a Link pixel to catalog button when it isn't).
export async function fetchCatalogHealth(token, { catalogId, pixelId }) {
  const catalog = need(catalogId, "catalog");
  const [info, sources, stats, diagnostics, checks] = await Promise.all([
    safe(() => graphGet(`/${catalog}`, token, { fields: "id,name,product_count,vertical" })),
    safe(async () => {
      const page = await graphGetAllPages(`/${catalog}/external_event_sources`, token, { fields: "id,name", limit: 50 });
      return page.data || [];
    }),
    safe(() => graphGet(`/${catalog}/event_stats`, token, {})),
    safe(() => graphGet(`/${catalog}/diagnostics`, token, {})),
    pixelId
      ? safe(() => graphGet(`/${pixelId}/da_checks`, token, { fields: "key,title,description,result,action_uri" }))
      : Promise.resolve(null),
  ]);
  return { info, sources, stats, diagnostics, checks };
}

export async function linkPixelToCatalog(token, { catalogId, pixelId }) {
  return graphPost(`/${need(catalogId, "catalog")}/external_event_sources`, token, {
    external_event_sources: [need(pixelId, "pixel")],
  });
}

const PURCHASE_ACTION_TYPES = ["omni_purchase", "purchase", "offsite_conversion.fb_pixel_purchase"];

function pickPurchaseValue(list) {
  for (const type of PURCHASE_ACTION_TYPES) {
    const hit = list?.find((x) => x.action_type === type);
    if (hit) return Number(hit.value) || 0;
  }
  return 0;
}

// Ad-level results for the date range, each ad marked catalog or not. A
// catalog ad has a product set on its creative or ad set, or sits in a
// campaign with a catalog — feeds the Overview/My Catalog Ads/Product Sets
// tabs from one request, same as the source app.
//
// Uses graphGetInsights (not a plain list call, unlike the source app's own
// graph.list here) — this app already has async-report-job polling for
// exactly this situation (see lib/facebookGraph.js's own comment: a
// spend-only query can still come back as `{report_run_id}` for a large
// account), which sr-ads-launch's own graph.ts never handled.
export async function fetchCatalogPerformance(token, { accountId, since, until }) {
  const actId = toAccountId(accountId);
  const rows = await graphGetInsights(`/${actId}/insights`, token, {
    level: "ad",
    time_range: { since: need(since, "since"), until: need(until, "until") },
    limit: 500,
    fields: "ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,spend,reach,impressions,clicks,actions,action_values",
  });
  const data = rows.data || [];
  const ids = Array.from(new Set(data.map((r) => r.ad_id)));
  const meta = {};
  const batches = [];
  for (let i = 0; i < ids.length; i += 50) batches.push(ids.slice(i, i + 50));
  await Promise.all(
    batches.map(async (chunk) => {
      const res = await safe(() =>
        graphGet("", token, {
          ids: chunk.join(","),
          fields: "effective_status,creative{thumbnail_url,product_set_id},adset{promoted_object},campaign{promoted_object}",
        })
      );
      if (!("unavailable" in res)) Object.assign(meta, res);
    })
  );
  return data.map((r) => {
    const m = meta[r.ad_id] || {};
    const productSetId = m.creative?.product_set_id || m.adset?.promoted_object?.product_set_id || "";
    const catalogId = m.campaign?.promoted_object?.product_catalog_id || m.adset?.promoted_object?.product_catalog_id || "";
    return {
      id: r.ad_id,
      name: r.ad_name,
      adset: r.adset_name,
      campaign: r.campaign_name,
      status: m.effective_status || "",
      thumb: m.creative?.thumbnail_url || "",
      productSetId,
      catalogId,
      isCatalog: !!(productSetId || catalogId),
      spend: Number(r.spend) || 0,
      reach: Number(r.reach) || 0,
      impressions: Number(r.impressions) || 0,
      clicks: Number(r.clicks) || 0,
      purchases: pickPurchaseValue(r.actions),
      value: pickPurchaseValue(r.action_values),
    };
  });
}

export async function fetchSavedAudiences(token, accountId) {
  const page = await graphGetAllPages(`/${toAccountId(accountId)}/saved_audiences`, token, {
    fields: "id,name,targeting",
    limit: 100,
  });
  return page.data || [];
}

// Custom audiences and lookalikes of the ad account. Counts and status are
// asked for first and dropped if Meta refuses them (some ad accounts can't
// see those fields on every audience they can still otherwise use).
export async function fetchCustomAudiences(token, accountId) {
  const actId = toAccountId(accountId);
  const ask = async (fields) => {
    const page = await graphGetAllPages(`/${actId}/customaudiences`, token, { fields, limit: 200 });
    return page.data || [];
  };
  try {
    return await ask("id,name,subtype,approximate_count_lower_bound,approximate_count_upper_bound,operation_status");
  } catch {
    return await ask("id,name,subtype");
  }
}

// Interests Meta finds related to the ones already chosen.
export async function fetchInterestSuggestions(token, names) {
  const list = (Array.isArray(names) ? names : [])
    .filter((n) => typeof n === "string" && n.trim())
    .slice(0, 8);
  if (!list.length) return [];
  const res = await graphGet("/search", token, { type: "adinterestsuggestion", interest_list: list, limit: 20 });
  return res.data || [];
}

function mediaItem(m) {
  return m.media_type === "VIDEO" ? { type: "video", url: m.media_url || "", poster: m.thumbnail_url || "" } : { type: "image", url: m.media_url || m.thumbnail_url || "" };
}

// Recent posts to promote as an "existing post" ad — phase 5's standard-ad
// flow. Facebook Page posts need the Page's own token (read server-side,
// never sent to the browser); Instagram media uses the user's own token.
export async function fetchPosts(token, { pageId, source, igId }) {
  need(pageId, "page");
  if (source === "INSTAGRAM") {
    need(igId, "Instagram account");
    const json = await graphGet(`/${igId}/media`, token, {
      fields: "id,caption,media_type,media_product_type,media_url,thumbnail_url,timestamp,permalink,children{media_type,media_url,thumbnail_url}",
      limit: 24,
    });
    return (json.data || []).map((m) => ({
      id: m.id,
      text: m.caption || "",
      image: m.thumbnail_url || m.media_url || "",
      time: m.timestamp,
      link: m.permalink,
      type: m.media_product_type === "REELS" ? "REELS" : m.media_type,
      media: (m.media_type === "CAROUSEL_ALBUM" ? (m.children?.data || []).map(mediaItem) : [mediaItem(m)]).filter((x) => x.url),
    }));
  }
  const page = await graphGet(`/${pageId}`, token, { fields: "access_token" });
  const json = await graphGet(`/${pageId}/published_posts`, page.access_token || token, {
    fields: "id,message,full_picture,created_time,permalink_url,attachments{media_type,media,subattachments{media_type,media}}",
    limit: 24,
  });
  const fbItem = (a) =>
    /video/i.test(a?.media_type || "") && a?.media?.source
      ? { type: "video", url: a.media.source, poster: a.media?.image?.src || "" }
      : { type: "image", url: a?.media?.image?.src || "" };
  return (json.data || []).map((p) => {
    const att = p.attachments?.data?.[0];
    const subs = att?.subattachments?.data || [];
    const media = (subs.length ? subs.map(fbItem) : att ? [fbItem(att)] : []).filter((x) => x.url);
    return {
      id: p.id,
      text: p.message || "",
      image: p.full_picture || "",
      type: media.some((x) => x.type === "video") ? "VIDEO" : subs.length > 1 ? "CAROUSEL_ALBUM" : "POST",
      time: p.created_time,
      link: p.permalink_url,
      media: media.length ? media : p.full_picture ? [{ type: "image", url: p.full_picture }] : [],
    };
  });
}
