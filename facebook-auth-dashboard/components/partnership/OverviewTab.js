import Loader from "../Loader";
import { formatMetricValue } from "@/lib/insightsMetrics";
import styles from "@/styles/Home.module.css";

// One rollup's own stat grid — used for both the Partnership and Normal
// Ads cards below, identical layout, different data and accent color.
function RollupCard({ title, subtitle, data, currency, accent }) {
  return (
    <div className={styles.card} style={{ padding: 18, flex: 1, minWidth: 260 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: accent, flexShrink: 0 }} />
        <div>
          <p style={{ fontWeight: 700, fontSize: 13.5, margin: 0 }}>{title}</p>
          <p className={styles.muted} style={{ margin: 0, fontSize: 11 }}>
            {subtitle}
          </p>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 12 }}>
        {/* "All Ads" (not "Active Ads") — the count of ads with real delivery
            in the chosen window, i.e. the same denominator the metrics below
            it are actually computed over. The live count is a DIFFERENT,
            current-moment-in-time number (an ad can have delivered in the
            window but be paused right now, or vice versa) — shown alongside
            in parens rather than as the headline figure, so the two aren't
            conflated the way a single "Active Ads" label previously implied. */}
        <Stat
          label="All Ads"
          value={data.allAds != null ? `${data.allAds}${data.activeAds != null ? ` (${data.activeAds} live)` : ""}` : "—"}
        />
        <Stat label="Reach" value={formatMetricValue(data.reach, "number")} />
        <Stat label="Spend" value={formatMetricValue(data.spend, "currency", currency)} />
        <Stat label="Avg ROAS" value={formatMetricValue(data.roas, "decimal")} highlight />
        <Stat label="CTR" value={formatMetricValue(data.ctr, "percent")} />
        <Stat label="Purchases" value={formatMetricValue(data.purchases, "number")} />
        <Stat label="New CPA" value={formatMetricValue(data.cpa, "currency", currency)} />
        <Stat label="Frequency" value={formatMetricValue(data.frequency, "decimal")} />
      </div>
    </div>
  );
}

function Stat({ label, value, highlight }) {
  return (
    <div style={{ minWidth: 0 }}>
      <p className={styles.muted} style={{ margin: 0, fontSize: 10.5, textTransform: "uppercase", letterSpacing: 0.3 }}>
        {label}
      </p>
      {/* overflowWrap/wordBreak — a long formatted value (a currency amount
          in the lakhs/crores, or "N (M live)") previously had no way to wrap
          within its own grid cell and visibly bled into the next column
          instead, reported as unreadable overlapping numbers on a real
          account. Letting it wrap onto a second line keeps it inside its own
          cell at any width instead of relying on the grid column being wide
          enough for every possible value, which it never reliably is for a
          rupee amount in crores. */}
      <p style={{ margin: "2px 0 0", fontSize: 15, fontWeight: 800, color: highlight ? "var(--green)" : "var(--t1)", overflowWrap: "anywhere", wordBreak: "break-word" }}>
        {value}
      </p>
    </div>
  );
}

// %-better/worse of `partnership` vs `normal` for one metric — higher-is-
// better by default, flip with `lowerIsBetter` for cost metrics.
function DeltaCard({ label, partnership, normal, format, currency, lowerIsBetter }) {
  if (typeof partnership !== "number" || typeof normal !== "number" || normal === 0) {
    return (
      <div className={styles.card} style={{ padding: 14 }}>
        <p className={styles.muted} style={{ margin: 0, fontSize: 11 }}>
          {label}
        </p>
        <p style={{ margin: "4px 0 0", fontSize: 13 }}>Not enough data</p>
      </div>
    );
  }
  const pct = ((partnership - normal) / Math.abs(normal)) * 100;
  const better = lowerIsBetter ? pct < 0 : pct > 0;
  return (
    <div className={styles.card} style={{ padding: 14 }}>
      <p className={styles.muted} style={{ margin: 0, fontSize: 11 }}>
        {label}
      </p>
      <p style={{ margin: "4px 0 2px", fontSize: 18, fontWeight: 800, color: better ? "var(--green)" : "var(--t2)" }}>
        {pct > 0 ? "+" : ""}
        {pct.toFixed(0)}%
      </p>
      <p className={styles.muted} style={{ margin: 0, fontSize: 11, overflowWrap: "anywhere" }}>
        Partnership {formatMetricValue(partnership, format, currency)} vs. Normal {formatMetricValue(normal, format, currency)}
      </p>
    </div>
  );
}

// Pure display component — no fetch, no local loading/error/data state of
// its own. `pages/partnership-ads.js` now owns one shared fetch (+ a 5-min
// client-side cache) for Overview/My Partnership Ads/Creator Hub together,
// since all three ultimately read the same underlying per-ad data, just
// aggregated differently; a user switching between these three tabs should
// see the already-fetched result immediately, not trigger another "Load"
// (and another round of Graph calls) per tab. See pages/partnership-ads.js's
// own comment on `checkPerformance` for the full reasoning.
export default function OverviewTab({ ready, currency, range, loading, error, data }) {
  if (!ready) {
    return <p className={styles.sub}>Pick an ad account above to see this.</p>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {!data && !loading && !error && (
        <p className={styles.sub} style={{ margin: 0 }}>
          Pick a date range on the right and click Check Performance to compare Partnership Ads against your other
          ads over that window.
        </p>
      )}
      {loading && <Loader label="Comparing Partnership vs. Normal Ads…" />}
      {error && <div className={styles.error}>{error}</div>}
      {data && <OverviewResult data={data} currency={currency} range={range} />}
    </div>
  );
}

function OverviewResult({ data, currency, range }) {
  const { partnership, normal } = data;
  return (
    <>
      <p className={styles.sub} style={{ margin: 0 }}>
        {range.since} to {range.until}, live from Meta.
      </p>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
        <RollupCard title="Partnership Ads" subtitle="Creator-collaborated" data={partnership} currency={currency} accent="var(--purple)" />
        <RollupCard title="Normal Ads" subtitle="Standard campaigns" data={normal} currency={currency} accent="var(--t3)" />
      </div>
      <div>
        <p style={{ fontWeight: 700, fontSize: 13, marginBottom: 10 }}>How Partnership Ads compare</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
          <DeltaCard label="ROAS" partnership={partnership.roas} normal={normal.roas} format="decimal" />
          <DeltaCard label="New CPA" partnership={partnership.cpa} normal={normal.cpa} format="currency" currency={currency} lowerIsBetter />
          <DeltaCard label="CTR" partnership={partnership.ctr} normal={normal.ctr} format="percent" />
          <DeltaCard label="Frequency" partnership={partnership.frequency} normal={normal.frequency} format="decimal" />
          <DeltaCard label="Reach" partnership={partnership.reach} normal={normal.reach} format="number" />
          <DeltaCard label="Spend" partnership={partnership.spend} normal={normal.spend} format="currency" currency={currency} />
        </div>
      </div>
    </>
  );
}
