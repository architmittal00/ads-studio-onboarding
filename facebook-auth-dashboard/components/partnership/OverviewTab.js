import { useEffect, useState } from "react";
import Loader from "../Loader";
import { formatMetricValue } from "@/lib/insightsMetrics";
import { fetchWithTimeout, parseJsonResponse } from "@/lib/fetchJson";
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

// `range` ({since, until}) is now owned by the parent page (pages/partnership-ads.js)
// and shared with My Partnership Ads/Creator Hub — one date-range control for
// all three tabs that actually query the same underlying partnership-vs-rest
// ad data, instead of Overview picking its own window independently of the
// other two.
export default function OverviewTab({ accountId, ready, currency, range }) {
  // Deliberately NOT an effect that auto-fires when the account becomes
  // ready — same "explicit action, not a fetch sprung on page load"
  // convention Copy Ads/Explore already use for their own queries. This
  // tab's underlying Graph call is heavier than it looks (a full ad-history
  // walk, see lib/partnershipDetection.js's fetchPartnershipAds), so firing
  // it automatically — for every account the user happens to land on, before
  // they've even looked at the page — was also wasted work, not just a UX
  // preference.
  const [state, setState] = useState({ loading: false, error: null, data: null, hasLoaded: false });

  // Clears a previous account's stale result rather than leaving it on
  // screen (misattributed to the newly-selected account) until the user
  // clicks Check Performance again — same reasoning as Copy Ads' own
  // account-change reset.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reacting to the account changing, not a derived-state anti-pattern
    setState({ loading: false, error: null, data: null, hasLoaded: false });
  }, [accountId]);

  function checkPerformance() {
    if (!ready || !accountId || !range) return;
    setState({ loading: true, error: null, data: null, hasLoaded: false });
    const params = new URLSearchParams({ accountId, since: range.since, until: range.until });
    fetchWithTimeout(`/api/fb/partnership/overview?${params.toString()}`)
      .then(parseJsonResponse)
      .then((json) => {
        if (json.error) setState({ loading: false, error: json.error, data: null, hasLoaded: true });
        else setState({ loading: false, error: null, data: json, hasLoaded: true });
      })
      .catch((err) => setState({ loading: false, error: err.message, data: null, hasLoaded: true }));
  }

  if (!ready) {
    return <p className={styles.sub}>Pick an ad account above to see this.</p>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <button type="button" className={styles.btnPrimary} onClick={checkPerformance} disabled={!range || state.loading}>
          {state.loading ? "Checking…" : "Check Performance"}
        </button>
      </div>

      {!state.hasLoaded && !state.loading && (
        <p className={styles.sub} style={{ margin: 0 }}>
          Pick a date range above and click Check Performance to compare Partnership Ads against your other ads over
          that window.
        </p>
      )}
      {state.loading && <Loader label="Comparing Partnership vs. Normal Ads…" />}
      {state.error && <div className={styles.error}>{state.error}</div>}
      {state.data && <OverviewResult data={state.data} currency={currency} range={range} />}
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
