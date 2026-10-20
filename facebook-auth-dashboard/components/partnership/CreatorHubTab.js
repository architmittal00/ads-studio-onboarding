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
// data My Partnership Ads already fetches (see lib/partnershipCreatorStats.js),
// over the shared date range (pages/partnership-ads.js, same range Overview
// and My Partnership Ads use). Clicking a creator opens a drawer listing
// their own ads. Deliberately doesn't include the mockup's "New Reach %"/
// "New Purchase %"/"New CPA" period-over-period columns — those would need a
// second, previous-period Insights call per creator subset, more complexity
// than this exploratory view warrants right now; every column shown here is
// a real, single-period number, not a fabricated comparison.
//
// Explicit "Check" action rather than auto-fetching on account-ready, same
// convention as Overview (PR #246) and for the same reason: this is a real
// ad-history walk, not a cheap lookup.
export default function CreatorHubTab({ accountId, businessId, igUserId, ready, currency, range }) {
  const [state, setState] = useState({ loading: false, error: null, ads: [], hasLoaded: false });
  const [openCreator, setOpenCreator] = useState(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reacting to the account changing, not a derived-state anti-pattern
    setState({ loading: false, error: null, ads: [], hasLoaded: false });
  }, [accountId]);

  function loadCreators() {
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

  return (
    <div>
      <div style={{ marginBottom: 14 }}>
        <button type="button" className={styles.btnPrimary} onClick={loadCreators} disabled={!range || state.loading}>
          {state.loading ? "Loading…" : state.hasLoaded ? "Reload" : "Load Creator Hub"}
        </button>
      </div>
      {!state.hasLoaded && !state.loading && (
        <p className={styles.sub} style={{ margin: 0 }}>
          Pick a date range above and click Load Creator Hub to see every creator&apos;s performance, summed across
          their own partnership ads, over that window.
        </p>
      )}
      {state.loading && <Loader label="Looking for partnership ads…" />}
      {state.error && <div className={styles.error}>{state.error}</div>}
      {state.hasLoaded && !state.error && creators.length === 0 && (
        <section className={styles.card} style={{ textAlign: "center", padding: "48px 24px" }}>
          <p style={{ fontWeight: 700, marginBottom: 6 }}>No creators yet</p>
          <p className={styles.sub}>Once you have partnership ads running, their creators show up here.</p>
        </section>
      )}
      {creators.length > 0 && (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <p className={styles.sub} style={{ margin: 0 }}>
              {creators.length} creator{creators.length === 1 ? "" : "s"} · {range.since} to {range.until}
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
        </>
      )}
    </div>
  );
}
