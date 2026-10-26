import Loader from "@/components/Loader";
import { ChartIcon } from "@/components/icons";
import { formatMetricValue } from "@/lib/insightsMetrics";
import { totals } from "@/lib/catalogAds/catalogAdsMetrics";
import styles from "@/styles/Home.module.css";

function Metric({ label, value, tone }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "6px 0" }}>
      <span className={styles.sub} style={{ margin: 0 }}>
        {label}
      </span>
      <span className={tone ? styles.badgeGood : undefined} style={tone ? undefined : { fontWeight: 600 }}>
        {value}
      </span>
    </div>
  );
}

function SummaryCard({ title, subtitle, t, currency }) {
  const money = (n) => formatMetricValue(n, "currency", currency);
  return (
    <div className={styles.card} style={{ flex: "1 1 280px" }}>
      <p style={{ fontWeight: 700, marginBottom: 2 }}>{title}</p>
      <p className={styles.sub} style={{ marginBottom: 12 }}>
        {subtitle}
      </p>
      <Metric label="All ads" value={`${t.ads.toLocaleString("en-IN")} (${t.live.toLocaleString("en-IN")} live)`} />
      <Metric label="Reach" value={formatMetricValue(t.reach, "number")} />
      <Metric label="Spend" value={money(t.spend)} />
      <Metric label="Avg ROAS" value={t.roas.toFixed(2)} tone />
      <Metric label="CTR" value={`${t.ctr.toFixed(2)}%`} />
      <Metric label="Purchases" value={formatMetricValue(t.purchases, "number")} />
      <Metric label="CPA" value={t.purchases ? money(t.cpa) : "–"} />
      <Metric label="Frequency" value={t.frequency.toFixed(2)} />
    </div>
  );
}

// `better` says which direction is an improvement for this metric ("none"
// for metrics like Reach/Spend where neither direction is inherently
// better) — mirrors sr-ads-launch's own delta() in CatalogAdsApp.tsx.
function Delta({ label, a, b, show, better }) {
  const d = b ? ((a - b) / b) * 100 : 0;
  const flat = !b || Math.abs(d) < 0.5;
  const good = better === "none" || flat ? null : better === "higher" ? d > 0 : d < 0;
  const toneClass = good == null ? undefined : good ? styles.badgeGood : styles.badgeDanger;
  return (
    <div className={styles.card} style={{ flex: "1 1 160px", textAlign: "center" }}>
      <p className={styles.sub} style={{ margin: 0 }}>
        {label}
      </p>
      <p style={{ fontSize: 22, fontWeight: 800, margin: "4px 0" }}>
        {b ? (
          <span className={toneClass}>{flat ? "0%" : `${d > 0 ? "+" : ""}${d.toFixed(0)}%`}</span>
        ) : (
          "–"
        )}
      </p>
      <p className={styles.sub} style={{ margin: 0 }}>
        Catalog {show(a)} vs. Normal {show(b)}
      </p>
    </div>
  );
}

// Compares catalog ads against every other ad over the chosen window — the
// Overview tab. `rows` is the full, unfiltered /catalog-ads/performance
// result; this slices it into catalog vs. normal itself so the caller
// doesn't need to know about `isCatalog`.
export default function CatalogOverview({ rows, loading, error, currency, since, until }) {
  if (loading) {
    return (
      <div className={styles.card}>
        <Loader label="Loading catalog performance…" />
      </div>
    );
  }
  if (error) {
    return <div className={styles.error}>{error}</div>;
  }

  const money = (n) => formatMetricValue(n, "currency", currency);
  const cat = totals(rows.filter((r) => r.isCatalog));
  const norm = totals(rows.filter((r) => !r.isCatalog));

  if (!rows.length) {
    return (
      <div className={styles.card}>
        No ads delivered between {since} and {until}. Pick a longer date range.
      </div>
    );
  }

  return (
    <>
      <p className={styles.sub} style={{ marginTop: 0 }}>
        {since} to {until}, live from Meta. Catalog ads are ads that show products from a catalog.
      </p>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 24 }}>
        <SummaryCard title="Catalog Ads" subtitle="Products from a catalog" t={cat} currency={currency} />
        <SummaryCard title="Normal Ads" subtitle="Image, video and post ads" t={norm} currency={currency} />
      </div>
      <h3 className={styles.h2} style={{ marginBottom: 12 }}>
        <ChartIcon size={16} style={{ marginRight: 6, verticalAlign: "-2px" }} />
        How Catalog Ads compare
      </h3>
      {!cat.ads ? (
        <div className={styles.card}>
          No catalog ads delivered in this range, so there&apos;s nothing to compare yet. Create one from the Product
          Sets tab.
        </div>
      ) : (
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 12 }}>
          <Delta label="ROAS" a={cat.roas} b={norm.roas} show={(x) => x.toFixed(2)} better="higher" />
          <Delta label="CPA" a={cat.cpa} b={norm.cpa} show={money} better="lower" />
          <Delta label="CTR" a={cat.ctr} b={norm.ctr} show={(x) => `${x.toFixed(2)}%`} better="higher" />
          <Delta label="Frequency" a={cat.frequency} b={norm.frequency} show={(x) => x.toFixed(2)} better="lower" />
          <Delta label="Reach" a={cat.reach} b={norm.reach} show={(x) => formatMetricValue(x, "number")} better="none" />
          <Delta label="Spend" a={cat.spend} b={norm.spend} show={money} better="none" />
        </div>
      )}
      <p className={styles.sub}>
        Reach is added up across ads, so someone reached by several ads counts more than once; frequency is
        impressions divided by that reach.
      </p>
    </>
  );
}
