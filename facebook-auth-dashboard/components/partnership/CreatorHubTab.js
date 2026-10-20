import { useMemo, useState } from "react";
import Loader from "../Loader";
import SortableTable from "../SortableTable";
import CreatorAdsDrawer from "./CreatorAdsDrawer";
import { groupByCreator } from "@/lib/partnershipCreatorStats";
import { formatMetricValue } from "@/lib/insightsMetrics";
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
// Pure display component — no fetch, no local loading/error/data state of
// its own (aside from the creator-drawer's own open/closed state). See
// pages/partnership-ads.js's own comment on `checkPerformance` for why this
// (and My Partnership Ads) now share one fetch+cache with Overview instead
// of each independently calling /api/fb/partnership/mine.
export default function CreatorHubTab({ ready, currency, ads, loading, error, hasLoaded, range }) {
  const [openCreator, setOpenCreator] = useState(null);

  const creators = useMemo(() => groupByCreator(ads || []), [ads]);

  const columns = [
    { key: "creatorUsername", label: "Creator", render: (row) => `@${row.creatorUsername || row.key}` },
    { key: "adCount", label: "Ads", align: "right" },
    { key: "spend", label: "Spend", align: "right", render: (row) => formatMetricValue(row.spend, "currency", currency) },
    { key: "purchases", label: "Purchases", align: "right", render: (row) => formatMetricValue(row.purchases, "number") },
    { key: "roas", label: "Avg ROAS", align: "right", render: (row) => formatMetricValue(row.roas, "decimal") },
    { key: "cpr", label: "Avg CPR", align: "right", render: (row) => formatMetricValue(row.cpr, "currency", currency) },
  ];

  if (!ready) {
    return <p className={styles.sub}>Pick an ad account above to see this.</p>;
  }

  return (
    <div>
      {!hasLoaded && !loading && (
        <p className={styles.sub} style={{ margin: 0 }}>
          Pick a date range on the right and click Check Performance to see every creator&apos;s performance, summed
          across their own partnership ads, over that window.
        </p>
      )}
      {loading && <Loader label="Looking for partnership ads…" />}
      {error && <div className={styles.error}>{error}</div>}
      {hasLoaded && !error && creators.length === 0 && (
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
