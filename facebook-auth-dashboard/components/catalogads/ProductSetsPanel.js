import { useEffect, useState } from "react";
import Loader from "@/components/Loader";
import SortableTable from "@/components/SortableTable";
import Thumb from "@/components/Thumb";
import { formatMetricValue } from "@/lib/insightsMetrics";
import { totals } from "@/lib/catalogAds/catalogAdsMetrics";
import { useJsonFetch } from "@/lib/catalogAds/useJsonFetch";
import styles from "@/styles/Home.module.css";

// The products in one set (first 25, as Meta returns them), plus its health
// checks (out-of-stock count, a sample of product links opened to confirm
// they land on a real page) — rendered inside the expanded row for a set.
function SetProductsDetail({ setId }) {
  const products = useJsonFetch(`/api/fb/catalog-ads/products?setId=${encodeURIComponent(setId)}`);
  const health = useJsonFetch(`/api/fb/catalog-ads/set-health?setId=${encodeURIComponent(setId)}`);

  if (products.loading) return <Loader label="Loading products…" inline />;
  if (products.error) return <div className={styles.error}>{products.error}</div>;

  const list = products.data?.products || [];
  if (!list.length) return <p className={styles.sub}>This product set has no products.</p>;

  return (
    <div style={{ padding: "12px 4px" }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
          gap: 10,
          marginBottom: 12,
        }}
      >
        {list.map((p) => {
          const onSale = p.sale_price && p.sale_price !== p.price;
          const outOfStock = /out of stock/i.test(p.availability || "");
          return (
            <a
              key={p.id}
              href={p.url || undefined}
              target="_blank"
              rel="noreferrer"
              title={p.url ? `Opens ${p.url}` : undefined}
              className={styles.card}
              style={{ padding: 8, textDecoration: "none", color: "inherit" }}
            >
              <div
                style={{
                  width: "100%",
                  aspectRatio: "1 / 1",
                  borderRadius: 6,
                  background: p.image_url ? `center/cover no-repeat url("${p.image_url}")` : "var(--card2)",
                  marginBottom: 6,
                }}
              />
              <div className={styles.clamp3} style={{ fontSize: 12, fontWeight: 600 }}>
                {p.name}
              </div>
              <div style={{ fontSize: 12 }}>
                {onSale ? (
                  <>
                    <b>{p.sale_price}</b> <s className={styles.sub}>{p.price}</s>
                  </>
                ) : (
                  p.price || "–"
                )}
              </div>
              <div className={styles.sub} style={{ margin: 0, fontSize: 11 }}>
                {[p.brand, outOfStock ? "Out of stock" : ""].filter(Boolean).join(" · ")}
              </div>
            </a>
          );
        })}
      </div>
      {health.loading ? (
        <Loader label="Checking product links…" inline />
      ) : health.error ? (
        <div className={styles.error}>{health.error}</div>
      ) : health.data ? (
        <div className={styles.sub} style={{ margin: 0 }}>
          {health.data.outOfStock != null && (
            <span>
              {health.data.outOfStock.toLocaleString("en-IN")} out of stock
              {health.data.links?.length ? " · " : ""}
            </span>
          )}
          {health.data.links?.length ? (
            <span>
              {health.data.links.filter((l) => l.ok).length}/{health.data.links.length} sampled product links open
              correctly
              {health.data.links.some((l) => !l.ok)
                ? ` (${health.data.links
                    .filter((l) => !l.ok)
                    .map((l) => l.reason)
                    .join(", ")})`
                : ""}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// Product Sets: pick a catalog, browse its product sets with each set's
// in-range catalog-ad results, and start a catalog ad from one. Ported from
// sr-ads-launch's own ProductSets component, using SortableTable's
// renderRowExtra for the expandable "View products" row instead of a
// hand-rolled <table> with manually interleaved detail rows.
export default function ProductSetsPanel({ accountId, currency, perfRows, perfLoading, onCreateAd }) {
  const catalogsRes = useJsonFetch(accountId ? `/api/fb/catalog-ads/catalogs?accountId=${encodeURIComponent(accountId)}` : null);
  const [catalogId, setCatalogId] = useState("");
  const [expandedSetId, setExpandedSetId] = useState("");

  const catalogs = catalogsRes.data?.catalogs || [];

  // No reset-on-accountId-change effect here: the caller remounts this
  // component with `key={accountId}` (see pages/catalog-ads.js), which gives
  // catalogId/expandedSetId a fresh initial value for free on account
  // switch — the idiomatic React alternative to an effect that exists only
  // to reset state (https://react.dev/learn/you-might-not-need-an-effect).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time seed from fetched data, same justified pattern as AccountProvider's own default-selection effects
    if (!catalogId && catalogs.length) setCatalogId(catalogs[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- depends on catalogsRes.data (stable while unchanged), not the freshly-derived `catalogs` array, to avoid re-running every render
  }, [catalogsRes.data, catalogId]);

  const setsRes = useJsonFetch(catalogId ? `/api/fb/catalog-ads/product-sets?catalogId=${encodeURIComponent(catalogId)}` : null);
  const sets = setsRes.data?.productSets || [];

  // In-range results of catalog ads, grouped by the product set they show.
  const bySet = new Map();
  (perfRows || [])
    .filter((r) => r.isCatalog && r.productSetId)
    .forEach((r) => bySet.set(r.productSetId, [...(bySet.get(r.productSetId) || []), r]));

  const money = (n) => formatMetricValue(n, "currency", currency);

  if (catalogsRes.loading) {
    return (
      <div className={styles.card}>
        <Loader label="Loading catalogs…" />
      </div>
    );
  }
  if (catalogsRes.error) {
    return <div className={styles.error}>{catalogsRes.error}</div>;
  }
  if (!catalogs.length) {
    return (
      <div className={styles.card}>
        No catalogs found for this ad account. Create one in Commerce Manager, or connect your store through the
        Facebook &amp; Instagram app.
      </div>
    );
  }

  const columns = [
    {
      key: "name",
      label: "Product set",
      maxWidth: 260,
      render: (set) => (
        <div style={{ display: "flex", alignItems: "center", gap: 8, overflow: "hidden" }}>
          <Thumb src={set.products?.data?.[0]?.image_url} />
          <div style={{ minWidth: 0 }}>
            <div className={styles.clamp3}>{set.name}</div>
            <div className={styles.sub} style={{ margin: 0 }}>
              {set.id}
            </div>
          </div>
        </div>
      ),
    },
    {
      key: "product_count",
      label: "Products",
      align: "right",
      render: (set) => (set.product_count != null ? set.product_count.toLocaleString("en-IN") : "–"),
    },
    {
      key: "ads",
      label: "Catalog ads",
      align: "right",
      sortValue: (set) => totals(bySet.get(set.id) || []).ads,
      render: (set) => {
        const t = totals(bySet.get(set.id) || []);
        if (perfLoading) return "…";
        return t.ads ? `${t.ads} (${t.live} live)` : "0";
      },
    },
    {
      key: "spend",
      label: "Spend",
      align: "right",
      sortValue: (set) => totals(bySet.get(set.id) || []).spend,
      render: (set) => {
        const t = totals(bySet.get(set.id) || []);
        if (perfLoading) return "…";
        return t.ads ? money(t.spend) : "–";
      },
    },
    {
      key: "roas",
      label: "ROAS",
      align: "right",
      sortValue: (set) => totals(bySet.get(set.id) || []).roas,
      render: (set) => {
        const t = totals(bySet.get(set.id) || []);
        if (perfLoading) return "…";
        return t.ads ? t.roas.toFixed(2) : "–";
      },
    },
    {
      key: "purchases",
      label: "Purchases",
      align: "right",
      sortValue: (set) => totals(bySet.get(set.id) || []).purchases,
      render: (set) => {
        const t = totals(bySet.get(set.id) || []);
        if (perfLoading) return "…";
        return t.ads ? t.purchases.toLocaleString("en-IN") : "–";
      },
    },
    {
      key: "actions",
      label: "",
      render: (set) => (
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button type="button" className={styles.btnSecondary} onClick={() => setExpandedSetId(expandedSetId === set.id ? "" : set.id)}>
            {expandedSetId === set.id ? "Hide products" : "View products"}
          </button>
          <button type="button" className={styles.btnPrimary} onClick={() => onCreateAd(catalogId, set.id)}>
            Create ad
          </button>
        </div>
      ),
    },
  ];

  return (
    <>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 8 }}>
        <div style={{ minWidth: 240 }}>
          <p className={styles.sub} style={{ marginBottom: 6 }}>
            Catalog
          </p>
          <select className={styles.select} value={catalogId} onChange={(e) => setCatalogId(e.target.value)}>
            {catalogs.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.product_count != null ? ` (${c.product_count.toLocaleString("en-IN")} products)` : ""}
              </option>
            ))}
          </select>
        </div>
      </div>
      <p className={styles.sub}>
        Pick a product set to create a catalog ad from it. Results are for catalog ads showing that set in the
        selected date range.
      </p>

      {setsRes.loading ? (
        <div className={styles.card}>
          <Loader label="Loading product sets…" />
        </div>
      ) : setsRes.error ? (
        <div className={styles.error}>{setsRes.error}</div>
      ) : !sets.length ? (
        <div className={styles.card}>This catalog has no product sets yet. Create one in Commerce Manager.</div>
      ) : (
        <SortableTable
          columns={columns}
          rows={sets}
          defaultSortKey="ads"
          defaultSortDir="desc"
          searchable
          searchKeys={["name"]}
          searchPlaceholder="Search product sets…"
          emptyMessage="No product sets match your search."
          renderRowExtra={(set) =>
            expandedSetId === set.id ? (
              <tr key={`${set.id}-detail`}>
                <td colSpan={columns.length}>
                  <SetProductsDetail setId={set.id} />
                </td>
              </tr>
            ) : null
          }
        />
      )}
    </>
  );
}
