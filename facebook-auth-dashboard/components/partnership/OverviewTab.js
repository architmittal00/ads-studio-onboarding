import { useEffect, useState } from "react";
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
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(90px, 1fr))", gap: 12 }}>
        <Stat label="Active Ads" value={data.activeAds != null ? String(data.activeAds) : "—"} />
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
    <div>
      <p className={styles.muted} style={{ margin: 0, fontSize: 10.5, textTransform: "uppercase", letterSpacing: 0.3 }}>
        {label}
      </p>
      <p style={{ margin: "2px 0 0", fontSize: 15, fontWeight: 800, color: highlight ? "var(--green)" : "var(--t1)" }}>{value}</p>
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
      <p className={styles.muted} style={{ margin: 0, fontSize: 11 }}>
        Partnership {formatMetricValue(partnership, format, currency)} vs. Normal {formatMetricValue(normal, format, currency)}
      </p>
    </div>
  );
}

export default function OverviewTab({ accountId, ready, currency }) {
  const [state, setState] = useState({ loading: false, error: null, data: null });

  useEffect(() => {
    if (!ready || !accountId) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- kicks off an async fetch that itself sets loading/error/result state, not a derived-state anti-pattern
    setState({ loading: true, error: null, data: null });
    fetch(`/api/fb/partnership/overview?accountId=${encodeURIComponent(accountId)}`)
      .then((res) => res.json())
      .then((json) => {
        if (cancelled) return;
        if (json.error) setState({ loading: false, error: json.error, data: null });
        else setState({ loading: false, error: null, data: json });
      })
      .catch((err) => {
        if (!cancelled) setState({ loading: false, error: err.message, data: null });
      });
    return () => {
      cancelled = true;
    };
  }, [accountId, ready]);

  if (!ready) {
    return <p className={styles.sub}>Pick an ad account and Instagram Business Account above to see this.</p>;
  }
  if (state.loading) return <Loader label="Loading the last 30 days…" />;
  if (state.error) return <div className={styles.error}>{state.error}</div>;
  if (!state.data) return null;

  const { partnership, normal } = state.data;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <p className={styles.sub} style={{ margin: 0 }}>
        Last 30 days, live from Meta.
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
    </div>
  );
}
