import { useEffect, useState } from "react";
import Loader from "@/components/Loader";
import { fetchWithTimeout, parseJsonResponse } from "@/lib/fetchJson";
import { useJsonFetch } from "@/lib/catalogAds/useJsonFetch";
import styles from "@/styles/Home.module.css";

const CTAS = [
  { value: "SHOP_NOW", label: "Shop now" },
  { value: "BUY_NOW", label: "Buy now" },
  { value: "ORDER_NOW", label: "Order now" },
  { value: "GET_OFFER", label: "Get offer" },
  { value: "LEARN_MORE", label: "Learn more" },
];

const PRODUCT_TOKENS = [
  { token: "{{product.name}}", label: "Product name" },
  { token: "{{product.price}}", label: "Price" },
  { token: "{{product.current_price}}", label: "Current price" },
  { token: "{{product.brand}}", label: "Brand" },
];

// Catalog, product set, Page, format and ad copy for a catalog ad — ported
// from sr-ads-launch's AdSection.tsx catalog branch + CatalogPanel.tsx's
// pixel-link status card, using this app's own phase-2 endpoints
// (catalogs/product-sets/catalog-health/link-pixel) and /api/fb/targeting-data
// for the pixel list (same source components/AdSetFields.js already uses).
export default function CatalogAdFields({
  accountId,
  pages,
  pixels,
  catalogId,
  onCatalogChange,
  productSetId,
  onProductSetChange,
  pixelId,
  onPixelChange,
  value,
  onChange,
}) {
  function set(patch) {
    onChange({ ...value, ...patch });
  }

  const catalogsRes = useJsonFetch(accountId ? `/api/fb/catalog-ads/catalogs?accountId=${encodeURIComponent(accountId)}` : null);
  const catalogs = catalogsRes.data?.catalogs || [];
  useEffect(() => {
    if (!catalogId && catalogs.length) onCatalogChange(catalogs[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- depends on catalogsRes.data (stable while unchanged), not the freshly-derived `catalogs` array
  }, [catalogsRes.data, catalogId]);

  const setsRes = useJsonFetch(catalogId ? `/api/fb/catalog-ads/product-sets?catalogId=${encodeURIComponent(catalogId)}` : null);
  const productSets = setsRes.data?.productSets || [];

  // `healthTick` busts useJsonFetch's URL-keyed caching after a successful
  // link — without it, the catalog-health request never re-runs (its URL
  // hasn't changed) and "Link pixel to catalog" would keep showing even
  // though the link just succeeded, until some unrelated state change
  // happened to remount this component.
  const [healthTick, setHealthTick] = useState(0);
  const healthRes = useJsonFetch(
    catalogId
      ? `/api/fb/catalog-ads/catalog-health?catalogId=${encodeURIComponent(catalogId)}${pixelId ? `&pixelId=${encodeURIComponent(pixelId)}` : ""}&_t=${healthTick}`
      : null
  );
  const isLinked = !!healthRes.data?.sources?.some?.((s) => s.id === pixelId);
  const [linking, setLinking] = useState(false);
  const [linkError, setLinkError] = useState(null);

  async function linkPixel() {
    setLinking(true);
    setLinkError(null);
    try {
      const res = await fetchWithTimeout("/api/fb/catalog-ads/link-pixel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ catalogId, pixelId }),
      });
      const json = await parseJsonResponse(res);
      if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
      setHealthTick((n) => n + 1);
    } catch (err) {
      setLinkError(err.message);
    } finally {
      setLinking(false);
    }
  }

  const selectedPage = pages.find((p) => p.id === value.pageId);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <p className={styles.sub} style={{ marginBottom: 6 }}>
          Catalog
        </p>
        {catalogsRes.loading ? (
          <Loader label="Loading catalogs…" inline />
        ) : catalogsRes.error ? (
          <div className={styles.error}>{catalogsRes.error}</div>
        ) : (
          <select className={styles.select} style={{ width: "100%" }} value={catalogId} onChange={(e) => onCatalogChange(e.target.value)}>
            {catalogs.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.product_count != null ? ` (${c.product_count.toLocaleString("en-IN")} products)` : ""}
              </option>
            ))}
          </select>
        )}
      </div>

      <div>
        <p className={styles.sub} style={{ marginBottom: 6 }}>
          Product set
        </p>
        {setsRes.loading ? (
          <Loader label="Loading product sets…" inline />
        ) : setsRes.error ? (
          <div className={styles.error}>{setsRes.error}</div>
        ) : (
          <select className={styles.select} style={{ width: "100%" }} value={productSetId} onChange={(e) => onProductSetChange(e.target.value)}>
            <option value="" disabled>
              Select a product set…
            </option>
            {productSets.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.product_count != null ? ` (${s.product_count.toLocaleString("en-IN")} products)` : ""}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* The pixel picked here is never sent in the ad set's own payload
          (see lib/catalogAds/launch.js's comment) — it's only used to check
          and, if needed, create the catalog<->pixel link that actually
          drives conversion tracking for every ad set under this catalog. */}
      <div>
        <p className={styles.sub} style={{ marginBottom: 6 }}>
          Dataset (pixel)
        </p>
        <select className={styles.select} style={{ width: "100%" }} value={pixelId} onChange={(e) => onPixelChange(e.target.value)}>
          <option value="" disabled>
            Select a dataset…
          </option>
          {pixels.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        {pixelId && catalogId && !healthRes.loading && (
          <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 8 }}>
            {isLinked ? (
              <span className={styles.badgeGood}>Dataset linked to this catalog</span>
            ) : (
              <>
                <span className={styles.badgeWarn}>Dataset not linked to this catalog</span>
                <button type="button" className={styles.btnSecondary} onClick={linkPixel} disabled={linking}>
                  {linking ? "Linking…" : "Link pixel to catalog"}
                </button>
              </>
            )}
          </div>
        )}
        {linkError && <div className={styles.error}>{linkError}</div>}
      </div>

      <div>
        <p className={styles.sub} style={{ marginBottom: 6 }}>
          Ad name
        </p>
        <input type="text" className={styles.select} style={{ width: "100%" }} value={value.name} onChange={(e) => set({ name: e.target.value })} />
      </div>

      <div>
        <p className={styles.sub} style={{ marginBottom: 6 }}>
          Facebook Page
        </p>
        <select
          className={styles.select}
          style={{ width: "100%" }}
          value={value.pageId}
          onChange={(e) => {
            const page = pages.find((p) => p.id === e.target.value);
            set({ pageId: e.target.value, instagramUserId: page?.instagram_business_account?.id || "" });
          }}
        >
          <option value="" disabled>
            Select a Page…
          </option>
          {pages.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        {selectedPage?.instagram_business_account && (
          <p className={styles.sub} style={{ fontSize: 11.5, marginTop: 4 }}>
            Also runs as @{selectedPage.instagram_business_account.username} on Instagram.
          </p>
        )}
      </div>

      <div>
        <p className={styles.sub} style={{ marginBottom: 6 }}>
          Format
        </p>
        <div className={styles.tabGroup}>
          <button type="button" className={value.format === "CAROUSEL" ? `${styles.tab} ${styles.tabActive}` : styles.tab} onClick={() => set({ format: "CAROUSEL" })}>
            Carousel
          </button>
          <button type="button" className={value.format === "SINGLE" ? `${styles.tab} ${styles.tabActive}` : styles.tab} onClick={() => set({ format: "SINGLE" })}>
            Single image
          </button>
        </div>
      </div>

      <div>
        <p className={styles.sub} style={{ marginBottom: 6 }}>
          Primary text
        </p>
        <textarea
          className={styles.select}
          style={{ width: "100%", minHeight: 60, resize: "vertical" }}
          value={value.message}
          onChange={(e) => set({ message: e.target.value })}
        />
      </div>

      <div style={{ display: "flex", gap: 16 }}>
        <div style={{ flex: 1 }}>
          <p className={styles.sub} style={{ marginBottom: 6 }}>
            Headline
          </p>
          <input type="text" className={styles.select} style={{ width: "100%" }} value={value.headline} onChange={(e) => set({ headline: e.target.value })} />
        </div>
        <div style={{ flex: 1 }}>
          <p className={styles.sub} style={{ marginBottom: 6 }}>
            Description
          </p>
          <input type="text" className={styles.select} style={{ width: "100%" }} value={value.description} onChange={(e) => set({ description: e.target.value })} />
        </div>
      </div>
      <p className={styles.sub} style={{ fontSize: 11.5, marginTop: -10 }}>
        Meta fills {PRODUCT_TOKENS.map((t) => t.token).join(", ")} in per product.
      </p>

      <div style={{ display: "flex", gap: 16 }}>
        <div style={{ flex: 1 }}>
          <p className={styles.sub} style={{ marginBottom: 6 }}>
            Button
          </p>
          <select className={styles.select} style={{ width: "100%" }} value={value.cta} onChange={(e) => set({ cta: e.target.value })}>
            {CTAS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <div style={{ flex: 2 }}>
          <p className={styles.sub} style={{ marginBottom: 6 }}>
            See more URL
          </p>
          <input
            type="text"
            className={styles.select}
            style={{ width: "100%" }}
            placeholder="https://your-store.com"
            value={value.link}
            onChange={(e) => set({ link: e.target.value })}
          />
        </div>
      </div>
    </div>
  );
}
