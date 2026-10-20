import { useEffect, useMemo, useState } from "react";
import Loader from "../Loader";
import SortableTable from "../SortableTable";
import CreatorAdsDrawer from "./CreatorAdsDrawer";
import { groupByCreator } from "@/lib/partnershipCreatorStats";
import { formatMetricValue } from "@/lib/insightsMetrics";
import { fetchWithTimeout, parseJsonResponse } from "@/lib/fetchJson";
import styles from "@/styles/Home.module.css";

function buildCsv(rows, currency) {
  const header = ["Creator", "Ads", "Spend", "Purchases", "Purchase Value", "ROAS", "CPR"];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(
      [
        `"@${(r.creatorUsername || r.key).replace(/"/g, '""')}"`,
        r.adCount,
        r.spend.toFixed(2),
        r.purchases,
        r.purchaseValue.toFixed(2),
        r.roas.toFixed(2),
        r.cpr != null ? r.cpr.toFixed(2) : "",
      ].join(",")
    );
  }
  return lines.join("\n");
}

function downloadCsv(csv, filename) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// Creator Hub: per-creator performance, grouped client-side from the same
// data My Partnership Ads already fetches (see lib/partnershipCreatorStats.js).
// Clicking a creator opens a drawer listing their own ads. Deliberately
// doesn't include the mockup's "New Reach %"/"New Purchase %"/"New CPA"
// period-over-period columns — those would need a second, previous-period
// Insights call per creator subset, more complexity than this exploratory
// view warrants right now; every column shown here is a real, single-period
// number, not a fabricated comparison.
export default function CreatorHubTab({ accountId, businessId, igUserId, ready, currency }) {
  const [state, setState] = useState({ loading: false, error: null, ads: [] });
  const [openCreator, setOpenCreator] = useState(null);

  useEffect(() => {
    if (!ready || !accountId) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- kicks off an async fetch that itself sets loading/error/result state, not a derived-state anti-pattern
    setState({ loading: true, error: null, ads: [] });
    const params = new URLSearchParams({ accountId });
    if (businessId) params.set("businessId", businessId);
    if (igUserId) params.set("igUserId", igUserId);
    fetchWithTimeout(`/api/fb/partnership/mine?${params.toString()}`)
      .then(parseJsonResponse)
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

  const creators = useMemo(() => groupByCreator(state.ads), [state.ads]);

  const columns = [
    { key: "creatorUsername", label: "Creator", render: (row) => `@${row.creatorUsername || row.key}` },
    { key: "adCount", label: "Ads", align: "right" },
    { key: "spend", label: "Spend", align: "right", render: (row) => formatMetricValue(row.spend, "currency", currency) },
    { key: "purchases", label: "Purchases", align: "right", render: (row) => formatMetricValue(row.purchases, "number") },
    { key: "roas", label: "Avg ROAS", align: "right", render: (row) => formatMetricValue(row.roas, "decimal") },
    { key: "cpr", label: "Avg CPR", align: "right", render: (row) => formatMetricValue(row.cpr, "currency", currency) },
  ];

  if (!ready) {
    return <p className={styles.sub}>Pick an ad account and Instagram Business Account above to see this.</p>;
  }
  if (state.loading) return <Loader label="Looking for partnership ads…" />;
  if (state.error) return <div className={styles.error}>{state.error}</div>;
  if (creators.length === 0) {
    return (
      <section className={styles.card} style={{ textAlign: "center", padding: "48px 24px" }}>
        <p style={{ fontWeight: 700, marginBottom: 6 }}>No creators yet</p>
        <p className={styles.sub}>Once you have partnership ads running, their creators show up here.</p>
      </section>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <p className={styles.sub} style={{ margin: 0 }}>
          {creators.length} creator{creators.length === 1 ? "" : "s"} · last 30 days
        </p>
        <button type="button" className={styles.btnSecondary} onClick={() => downloadCsv(buildCsv(creators, currency), "creator-hub.csv")}>
          Export CSV
        </button>
      </div>
      <SortableTable
        columns={columns}
        rows={creators}
        defaultSortKey="spend"
        defaultSortDir="desc"
        searchable
        searchKeys={["creatorUsername"]}
        onRowClick={setOpenCreator}
        maxHeight={520}
      />
      <CreatorAdsDrawer creator={openCreator} currency={currency} onClose={() => setOpenCreator(null)} />
    </div>
  );
}
