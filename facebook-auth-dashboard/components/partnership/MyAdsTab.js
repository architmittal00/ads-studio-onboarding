import { useEffect, useState } from "react";
import Loader from "../Loader";
import SortableTable from "../SortableTable";
import { formatMetricValue, humanizeStatus } from "@/lib/insightsMetrics";
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
// (see lib/partnershipDetection.js) with its own last-30-days performance —
// including ads created manually in Ads Manager, not just ones launched
// through this app, since detection is a live Graph check, not a local log.
// No row-selection/queue actions in this round (unlike Explore Ads) — these
// ads are already live, "add to queue" doesn't apply the same way.
export default function MyAdsTab({ accountId, businessId, igUserId, ready, currency }) {
  const [state, setState] = useState({ loading: false, error: null, ads: [] });

  useEffect(() => {
    if (!ready || !accountId) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- kicks off an async fetch that itself sets loading/error/result state, not a derived-state anti-pattern
    setState({ loading: true, error: null, ads: [] });
    const params = new URLSearchParams({ accountId });
    if (businessId) params.set("businessId", businessId);
    if (igUserId) params.set("igUserId", igUserId);
    fetch(`/api/fb/partnership/mine?${params.toString()}`)
      .then((res) => res.json())
      .then((json) => {
        if (cancelled) return;
        if (json.error) setState({ loading: false, error: json.error, ads: [] });
        else setState({ loading: false, error: null, ads: json.ads || [] });
      })
      .catch((err) => {
        if (!cancelled) setState({ loading: false, error: err.message, ads: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [accountId, businessId, igUserId, ready]);

  if (!ready) {
    return <p className={styles.sub}>Pick an ad account and Instagram Business Account above to see this.</p>;
  }
  if (state.loading) return <Loader label="Looking for partnership ads…" />;
  if (state.error) return <div className={styles.error}>{state.error}</div>;
  if (state.ads.length === 0) {
    return (
      <section className={styles.card} style={{ textAlign: "center", padding: "48px 24px" }}>
        <p style={{ fontWeight: 700, marginBottom: 6 }}>No partnership ads found</p>
        <p className={styles.sub}>Ads with a branded-content creative (launched here or in Ads Manager) will show up here.</p>
      </section>
    );
  }

  return (
    <div>
      <p className={styles.sub} style={{ marginTop: 0 }}>
        {state.ads.length} partnership ad{state.ads.length === 1 ? "" : "s"} · last 30 days
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
    </div>
  );
}
