import { useEffect, useState } from "react";
import Loader from "../Loader";
import SortableTable from "../SortableTable";
import { formatMetricValue, humanizeStatus } from "@/lib/insightsMetrics";
import { fetchWithTimeout, parseJsonResponse } from "@/lib/fetchJson";
import styles from "@/styles/Home.module.css";

const COLUMNS = (currency) => [
  {
    key: "name",
    label: "Ad",
    maxWidth: 220,
    render: (row) => (
      <div>
        <p style={{ margin: 0, fontWeight: 700 }}>{row.name}</p>
        <p className={styles.muted} style={{ margin: 0, fontSize: 11 }}>
          {row.campaignName} · {row.adsetName}
        </p>
      </div>
    ),
  },
  {
    key: "creatorUsername",
    label: "Creator",
    render: (row) => (row.creatorUsername ? `@${row.creatorUsername}` : "—"),
  },
  {
    key: "status",
    label: "Status",
    render: (row) => <span className={row.status === "ACTIVE" ? styles.badgeGood : styles.badgeInfo}>{humanizeStatus(row.status)}</span>,
  },
  { key: "spend", label: "Spend", align: "right", render: (row) => formatMetricValue(row.spend, "currency", currency) },
  { key: "roas", label: "ROAS", align: "right", render: (row) => formatMetricValue(row.roas, "decimal") },
  { key: "cpr", label: "CPR", align: "right", render: (row) => formatMetricValue(row.cpr, "currency", currency) },
  { key: "cpm", label: "CPM", align: "right", render: (row) => formatMetricValue(row.cpm, "currency", currency) },
  { key: "ctr", label: "CTR", align: "right", render: (row) => formatMetricValue(row.ctr, "percent") },
  { key: "purchases", label: "Purchases", align: "right", render: (row) => formatMetricValue(row.purchases, "number") },
  { key: "purchaseValue", label: "Purchase Value", align: "right", render: (row) => formatMetricValue(row.purchaseValue, "currency", currency) },
];

// My Partnership Ads: every ad on this account detected as branded content
// (see lib/partnershipDetection.js) with its own performance over the shared
// date range (pages/partnership-ads.js, same range Overview and Creator Hub
// use) — including ads created manually in Ads Manager, not just ones
// launched through this app, since detection is a live Graph check, not a
// local log. No row-selection/queue actions in this round (unlike Explore
// Ads) — these ads are already live, "add to queue" doesn't apply the same
// way.
//
// Explicit "Check" action rather than auto-fetching on account-ready, same
// convention as Overview (PR #246) and for the same reason: this is a real
// ad-history walk, not a cheap lookup.
export default function MyAdsTab({ accountId, businessId, igUserId, ready, currency, range }) {
  const [state, setState] = useState({ loading: false, error: null, ads: [], hasLoaded: false });

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reacting to the account changing, not a derived-state anti-pattern
    setState({ loading: false, error: null, ads: [], hasLoaded: false });
  }, [accountId]);

  function loadAds() {
    if (!ready || !accountId || !range) return;
    setState({ loading: true, error: null, ads: [], hasLoaded: false });
    const params = new URLSearchParams({ accountId, since: range.since, until: range.until });
    if (businessId) params.set("businessId", businessId);
    if (igUserId) params.set("igUserId", igUserId);
    fetchWithTimeout(`/api/fb/partnership/mine?${params.toString()}`)
      .then(parseJsonResponse)
      .then((json) => {
        if (json.error) setState({ loading: false, error: json.error, ads: [], hasLoaded: true });
        else setState({ loading: false, error: null, ads: json.ads || [], hasLoaded: true });
      })
      .catch((err) => setState({ loading: false, error: err.message, ads: [], hasLoaded: true }));
  }

  if (!ready) {
    return <p className={styles.sub}>Pick an ad account and Instagram Business Account above to see this.</p>;
  }

  return (
    <div>
      <div style={{ marginBottom: 14 }}>
        <button type="button" className={styles.btnPrimary} onClick={loadAds} disabled={!range || state.loading}>
          {state.loading ? "Loading…" : state.hasLoaded ? "Reload" : "Load Partnership Ads"}
        </button>
      </div>
      {!state.hasLoaded && !state.loading && (
        <p className={styles.sub} style={{ margin: 0 }}>
          Pick a date range above and click Load Partnership Ads to see every branded-content ad with delivery in that
          window.
        </p>
      )}
      {state.loading && <Loader label="Looking for partnership ads…" />}
      {state.error && <div className={styles.error}>{state.error}</div>}
      {state.hasLoaded && !state.error && state.ads.length === 0 && (
        <section className={styles.card} style={{ textAlign: "center", padding: "48px 24px" }}>
          <p style={{ fontWeight: 700, marginBottom: 6 }}>No partnership ads found</p>
          <p className={styles.sub}>Ads with a branded-content creative (launched here or in Ads Manager) will show up here.</p>
        </section>
      )}
      {state.ads.length > 0 && (
        <>
          <p className={styles.sub} style={{ marginTop: 0 }}>
            {state.ads.length} partnership ad{state.ads.length === 1 ? "" : "s"} · {range.since} to {range.until}
          </p>
          <SortableTable
            columns={COLUMNS(currency)}
            rows={state.ads}
            defaultSortKey="spend"
            defaultSortDir="desc"
            searchable
            searchKeys={["name", "campaignName", "adsetName"]}
            maxHeight={520}
          />
        </>
      )}
    </div>
  );
}
