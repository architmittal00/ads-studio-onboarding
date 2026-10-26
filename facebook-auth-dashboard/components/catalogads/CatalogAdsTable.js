import Loader from "@/components/Loader";
import SortableTable from "@/components/SortableTable";
import Thumb from "@/components/Thumb";
import { formatMetricValue, humanizeStatus } from "@/lib/insightsMetrics";
import { rowMetrics } from "@/lib/catalogAds/catalogAdsMetrics";
import styles from "@/styles/Home.module.css";

function statusBadgeClass(status) {
  if (status === "ACTIVE") return styles.badgeGood;
  if (status === "WITH_ISSUES" || status === "DISAPPROVED") return styles.badgeDanger;
  return styles.badgeInfo;
}

// A function of `money` rather than a static array — these columns need
// the account's own currency to format Spend/CPR/CPM/Purchase value, and
// SortableTable's `render(row)` only ever receives the row itself.
function buildColumns(money) {
  return [
    {
      key: "name",
      label: "Ad",
      maxWidth: 260,
      render: (r) => (
        <div style={{ display: "flex", alignItems: "center", gap: 8, overflow: "hidden" }}>
          <Thumb src={r.thumb} />
          <div style={{ minWidth: 0 }}>
            <div title={r.name} className={styles.clamp3}>
              {r.name}
            </div>
            <div className={styles.sub} style={{ margin: 0 }} title={`${r.campaign} › ${r.adset}`}>
              {r.campaign} › {r.adset}
            </div>
          </div>
        </div>
      ),
    },
    {
      key: "status",
      label: "Status",
      render: (r) => <span className={statusBadgeClass(r.status)}>{humanizeStatus(r.status) || "–"}</span>,
    },
    { key: "spend", label: "Spend", align: "right", render: (r) => money(r.spend) },
    { key: "roas", label: "ROAS", align: "right", sortValue: (r) => rowMetrics(r).roas, render: (r) => rowMetrics(r).roas.toFixed(2) },
    {
      key: "cpr",
      label: "CPR",
      align: "right",
      sortValue: (r) => rowMetrics(r).cpr,
      render: (r) => (r.purchases ? money(rowMetrics(r).cpr) : "–"),
    },
    { key: "cpm", label: "CPM", align: "right", sortValue: (r) => rowMetrics(r).cpm, render: (r) => money(rowMetrics(r).cpm) },
    {
      key: "ctr",
      label: "CTR",
      align: "right",
      sortValue: (r) => rowMetrics(r).ctr,
      render: (r) => `${rowMetrics(r).ctr.toFixed(2)}%`,
    },
    { key: "purchases", label: "Purchases", align: "right", render: (r) => formatMetricValue(r.purchases, "number") },
    { key: "value", label: "Purchase value", align: "right", render: (r) => money(r.value) },
  ];
}

// My Catalog Ads: every catalog ad that delivered in the chosen window,
// searchable and sortable — ported from sr-ads-launch's own CatalogAdsTable,
// using this app's SortableTable instead of a hand-rolled <table>.
export default function CatalogAdsTable({ rows, loading, error, currency }) {
  if (loading) {
    return (
      <div className={styles.card}>
        <Loader label="Loading catalog ads…" />
      </div>
    );
  }
  if (error) {
    return <div className={styles.error}>{error}</div>;
  }

  const money = (n) => formatMetricValue(n, "currency", currency);
  const catalogAds = rows.filter((r) => r.isCatalog);

  return (
    <>
      <p className={styles.sub} style={{ marginTop: 0 }}>
        {catalogAds.length} catalog {catalogAds.length === 1 ? "ad" : "ads"}
      </p>
      <SortableTable
        columns={buildColumns(money)}
        rows={catalogAds}
        defaultSortKey="spend"
        defaultSortDir="desc"
        searchable
        searchKeys={["name", "campaign", "adset"]}
        searchPlaceholder="Search ads, ad sets or campaigns…"
        emptyMessage="No catalog ads delivered in this range."
      />
    </>
  );
}
