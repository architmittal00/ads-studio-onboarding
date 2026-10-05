import Head from "next/head";
import { getServerSession } from "next-auth/next";
import { useEffect, useState } from "react";
import { authOptions } from "./api/auth/[...nextauth]";
import Nav from "@/components/Nav";
import SectionNav from "@/components/SectionNav";
import SortableTable from "@/components/SortableTable";
import Thumb from "@/components/Thumb";
import { getLastAccountId, setLastAccountId } from "@/lib/clientStorage";
import styles from "@/styles/Home.module.css";

const NAME_COL_WIDTH = 240;

const STRUCTURE_SORT_OPTIONS = [
  { key: "name", label: "Name" },
  { key: "spend", label: "Spend" },
  { key: "purchases", label: "Purchases" },
  { key: "roas", label: "ROAS" },
];

// campaigns/ad sets use *30d-suffixed field names, ads use bare ones —
// this maps a chosen metric to the right field at each tree level.
const STRUCTURE_SORT_FIELD = {
  name: { campaign: "name", adset: "name", ad: "name" },
  spend: { campaign: "spend30d", adset: "spend30d", ad: "spend" },
  purchases: { campaign: "purchases30d", adset: "purchases30d", ad: "purchases" },
  roas: { campaign: "roas30d", adset: "roas30d", ad: "roas" },
};

// Thumbnail + name, truncating the name with an ellipsis instead of
// stretching the column. The name span needs minWidth:0 + flex:1 — a flex
// child's default min-width is its own content size, which silently
// defeats text-overflow:ellipsis unless overridden.
function CreativeCell({ src, name, maxWidth = NAME_COL_WIDTH }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, maxWidth, overflow: "hidden" }}>
      <Thumb src={src} />
      <span
        title={name}
        style={{ minWidth: 0, flex: "1 1 auto", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
      >
        {name}
      </span>
    </div>
  );
}

function sortByField(list, field, dir) {
  const copy = [...list];
  copy.sort((a, b) => {
    const av = a[field];
    const bv = b[field];
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === "string") return dir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
    return dir === "asc" ? av - bv : bv - av;
  });
  return copy;
}

async function fetchReportData(accountId, force) {
  const url = `/api/fb/report?accountId=${encodeURIComponent(accountId)}${force ? "&force=true" : ""}`;
  const res = await fetch(url);
  return res.json();
}

function formatAge(ms) {
  const mins = Math.round(ms / 60000);
  if (mins < 1) return "just now";
  if (mins === 1) return "1 minute ago";
  if (mins < 60) return `${mins} minutes ago`;
  const hours = Math.round(mins / 60);
  return `${hours} hour${hours > 1 ? "s" : ""} ago`;
}

const SECTIONS = [
  { id: "overview", label: "Overview" },
  { id: "trends", label: "Best Week / Month" },
  { id: "top-campaigns", label: "Top Campaigns" },
  { id: "pareto", label: "Revenue Concentration" },
  { id: "pixel-health", label: "Pixel Health" },
  { id: "structure", label: "Account Structure" },
  { id: "high-frequency", label: "High-Frequency Ads" },
  { id: "budget-utilization", label: "Budget & Creatives" },
];

export default function Report() {
  const [accounts, setAccounts] = useState([]);
  const [accountsError, setAccountsError] = useState(null);
  const [selectedAccountId, setSelectedAccountId] = useState("");

  const [report, setReport] = useState(null);
  const [reportError, setReportError] = useState(null);
  const [reportLoading, setReportLoading] = useState(false);

  const [expandedCampaigns, setExpandedCampaigns] = useState({});
  const [expandedAdsets, setExpandedAdsets] = useState({});
  const [structureSortKey, setStructureSortKey] = useState("spend");
  const [structureSortDir, setStructureSortDir] = useState("desc");

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(interval);
  }, []);

  const currency = accounts.find((a) => a.id === selectedAccountId)?.currency;

  useEffect(() => {
    fetch("/api/fb/data")
      .then((res) => res.json())
      .then((json) => {
        if (json.error) {
          setAccountsError(json.error);
        } else {
          setAccounts(json.adAccounts || []);
          if (json.adAccounts?.length) {
            const lastId = getLastAccountId();
            const stillExists = json.adAccounts.some((a) => a.id === lastId);
            setSelectedAccountId(stillExists ? lastId : json.adAccounts[0].id);
          }
        }
      })
      .catch((err) => setAccountsError(err.message));
  }, []);

  useEffect(() => {
    if (!selectedAccountId) return;
    setLastAccountId(selectedAccountId);

    // Standard fetch-on-param-change pattern (react.dev/learn/synchronizing-with-effects#fetching-data):
    // resetting loading/error/data state synchronously here is intentional, not a sync-derived-state bug.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReportLoading(true);
    setReportError(null);
    setReport(null);
    setExpandedCampaigns({});
    setExpandedAdsets({});

    let ignore = false;
    fetchReportData(selectedAccountId, false)
      .then((json) => {
        if (ignore) return;
        if (json.error) setReportError(json.error);
        else setReport(json);
      })
      .catch((err) => {
        if (!ignore) setReportError(err.message);
      })
      .finally(() => {
        if (!ignore) setReportLoading(false);
      });

    return () => {
      ignore = true;
    };
  }, [selectedAccountId]);

  function handleHardRefresh() {
    if (!selectedAccountId) return;
    setReportLoading(true);
    setReportError(null);
    fetchReportData(selectedAccountId, true)
      .then((json) => {
        if (json.error) setReportError(json.error);
        else setReport(json);
      })
      .catch((err) => setReportError(err.message))
      .finally(() => setReportLoading(false));
  }

  function money(amount) {
    if (!currency) return amount.toFixed(2);
    try {
      return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(
        amount
      );
    } catch {
      return `${amount.toFixed(0)} ${currency}`;
    }
  }

  function toggleCampaign(id) {
    setExpandedCampaigns((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  function toggleAdset(id) {
    setExpandedAdsets((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  function jumpToCampaignInStructure(campaignId) {
    setExpandedCampaigns((prev) => ({ ...prev, [campaignId]: true }));
    document.getElementById("structure")?.scrollIntoView({ behavior: "smooth", block: "start" });
    window.requestAnimationFrame(() => {
      document.getElementById(`campaign-${campaignId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }

  function BudgetTypeBadge({ type }) {
    if (type === "CBO") return <span className={styles.pill}>CBO</span>;
    if (type === "ABO") return <span className={styles.badgeInfo}>ABO</span>;
    return <span className={styles.muted}>NO BUDGET</span>;
  }

  function StatusDot({ status }) {
    const color = status === "ACTIVE" ? "var(--green)" : status === "PAUSED" ? "var(--t3)" : "var(--red)";
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: color, flexShrink: 0 }} />
        <span style={{ fontSize: 11, fontWeight: 600, color: "var(--t2)" }}>{status}</span>
      </span>
    );
  }

  function expandAllStructure() {
    if (!report) return;
    const allCampaigns = {};
    const allAdsets = {};
    for (const c of report.structure.campaigns) {
      allCampaigns[c.id] = true;
      for (const a of c.adsets) {
        allAdsets[a.id] = true;
      }
    }
    setExpandedCampaigns(allCampaigns);
    setExpandedAdsets(allAdsets);
  }

  function collapseAllStructure() {
    setExpandedCampaigns({});
    setExpandedAdsets({});
  }

  // Flattens the campaign → ad set → ad tree into Ads-Manager-style rows:
  // one indented table, consistent columns at every level, driven by the
  // current expand/collapse state. Siblings at each level are sorted by the
  // chosen metric (mapped to that level's field name) — the hierarchy stays
  // intact, only the order within each level changes.
  function buildStructureRows() {
    if (!report) return [];
    const field = STRUCTURE_SORT_FIELD[structureSortKey];
    const rows = [];
    const sortedCampaigns = sortByField(report.structure.campaigns, field.campaign, structureSortDir);

    for (const c of sortedCampaigns) {
      rows.push({
        key: `c-${c.id}`,
        anchorId: `campaign-${c.id}`,
        level: 0,
        hasChildren: c.adsets.length > 0,
        expanded: !!expandedCampaigns[c.id],
        onToggle: () => toggleCampaign(c.id),
        name: c.name,
        thumbnailUrl: null,
        countLabel: `${c.adsets.length} ad sets`,
        status: c.status,
        budgetText: c.budgetType === "CBO" ? money(c.dailyBudget) : c.budgetType === "ABO" ? "Ad set level" : "—",
        budgetBadge: c.budgetType,
        spend: c.spend30d,
        purchases: c.purchases30d,
        roas: c.roas30d,
        frequency: null,
        creativesText: c.additionalNeeded > 0 ? `${c.creativeCount} (+${c.additionalNeeded})` : `${c.creativeCount}`,
      });

      if (expandedCampaigns[c.id]) {
        const sortedAdsets = sortByField(c.adsets, field.adset, structureSortDir);
        for (const a of sortedAdsets) {
          rows.push({
            key: `a-${a.id}`,
            level: 1,
            hasChildren: a.ads.length > 0,
            expanded: !!expandedAdsets[a.id],
            onToggle: () => toggleAdset(a.id),
            name: a.name,
            thumbnailUrl: null,
            countLabel: `${a.ads.length} ads`,
            status: a.status,
            budgetText: c.budgetType === "ABO" ? money(a.dailyBudget) : "—",
            budgetBadge: null,
            spend: a.spend30d,
            purchases: a.purchases30d,
            roas: a.roas30d,
            frequency: null,
            creativesText:
              a.additionalNeeded > 0 ? `${a.creativeCount} (+${a.additionalNeeded})` : `${a.creativeCount}`,
          });

          if (expandedAdsets[a.id]) {
            const sortedAds = sortByField(a.ads, field.ad, structureSortDir);
            for (const ad of sortedAds) {
              rows.push({
                key: `ad-${ad.id}`,
                level: 2,
                hasChildren: false,
                expanded: false,
                onToggle: null,
                name: ad.name,
                thumbnailUrl: ad.thumbnailUrl,
                countLabel: null,
                status: null,
                budgetText: "—",
                budgetBadge: null,
                spend: ad.spend,
                purchases: ad.purchases,
                roas: ad.roas,
                frequency: ad.frequency,
                creativesText: "—",
              });
            }
          }
        }
      }
    }
    return rows;
  }

  return (
    <>
      <Head>
        <title>Account Handover Report · Facebook Auth Dashboard</title>
      </Head>
      <div className={styles.page}>
        <main className={styles.main} style={{ maxWidth: 1440, margin: "0 auto" }}>
          <Nav />

          <div className={styles.sectionRow}>
            <h1 className={styles.h1}>Account Handover Report</h1>
            {accounts.length > 0 && (
              <select
                className={styles.select}
                value={selectedAccountId}
                onChange={(e) => setSelectedAccountId(e.target.value)}
              >
                {accounts.map((acc) => (
                  <option key={acc.id} value={acc.id}>
                    {acc.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          {accountsError && <div className={styles.error}>Error loading ad accounts: {accountsError}</div>}
          {!accountsError && accounts.length === 0 && !reportLoading && (
            <p className={styles.sub}>No Ad Accounts found, or permission not granted.</p>
          )}

          {reportLoading && !report && <p className={styles.sub}>Building the report…</p>}
          {reportError && <div className={styles.error}>Error: {reportError}</div>}

          {report && (
            <>
              <div className={styles.sectionRow} style={{ marginTop: -8 }}>
                <p className={styles.sub}>
                  Last 30 days: {report.dateRange30d.since} → {report.dateRange30d.until} ·{" "}
                  {report.fromCache ? "cached" : "freshly fetched"}, updated {formatAge(now - report.cachedAt)}
                  {reportLoading && " · refreshing…"}
                </p>
                <button className={styles.btnSecondary} onClick={handleHardRefresh} disabled={reportLoading}>
                  {reportLoading ? "Refreshing…" : "Hard Refresh"}
                </button>
              </div>

              <div className={styles.reportLayout}>
                <SectionNav sections={SECTIONS} />

                <div className={styles.reportContent} style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                {report.warnings?.length > 0 && (
                  <div className={styles.card} style={{ borderColor: "rgba(245,158,11,.25)" }}>
                    <h2 className={styles.h2}>Some data could not be loaded</h2>
                    <ul className={styles.list}>
                      {report.warnings.map((w, i) => (
                        <li key={i} className={styles.sub}>
                          · {w}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Overview */}
                <section id="overview">
                  <h2 className={styles.h2}>Last 30 Days</h2>
                  <div className={styles.statBar}>
                    <Stat label="Spend" value={money(report.overview.spend)} />
                    <Stat label="Purchases" value={report.overview.purchases.toFixed(0)} />
                    <Stat label="ROAS" value={`${report.overview.roas.toFixed(2)}x`} />
                    <Stat label="CTR" value={`${report.overview.ctr.toFixed(2)}%`} />
                    <Stat label="CVR" value={`${report.overview.cvr.toFixed(2)}%`} />
                  </div>
                </section>

                {/* Best week / month */}
                <section id="trends" style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                  <div className={styles.card} style={{ flex: 1, minWidth: 260 }}>
                    <h2 className={styles.h2}>Best Week (ROAS, last 90 days)</h2>
                    {report.bestWeek ? (
                      <>
                        <p className={styles.statValue}>{report.bestWeek.roas.toFixed(2)}x</p>
                        <p className={styles.sub}>
                          {report.bestWeek.since} → {report.bestWeek.until} · spend {money(report.bestWeek.spend)}
                        </p>
                      </>
                    ) : (
                      <p className={styles.sub}>No weeks with spend in this window.</p>
                    )}
                  </div>
                  <div className={styles.card} style={{ flex: 1, minWidth: 260 }}>
                    <h2 className={styles.h2}>Best Month (ROAS, last 6 months)</h2>
                    {report.bestMonth ? (
                      <>
                        <p className={styles.statValue}>{report.bestMonth.roas.toFixed(2)}x</p>
                        <p className={styles.sub}>
                          {report.bestMonth.since} → {report.bestMonth.until} · spend{" "}
                          {money(report.bestMonth.spend)}
                        </p>
                      </>
                    ) : (
                      <p className={styles.sub}>No months with spend in this window.</p>
                    )}
                  </div>
                </section>

                {/* Top spending campaigns */}
                <section id="top-campaigns" className={styles.card}>
                  <h2 className={styles.h2}>Top Spending Campaigns (Last 30 Days)</h2>
                  <p className={styles.sub} style={{ marginBottom: 12 }}>
                    Click a row to jump to it in Account Structure.
                  </p>
                  <SortableTable
                    defaultSortKey="spend"
                    maxHeight={360}
                    emptyMessage="No campaign spend in this window."
                    rows={report.topCampaigns}
                    onRowClick={(r) => jumpToCampaignInStructure(r.id)}
                    columns={[
                      { key: "name", label: "Campaign", maxWidth: NAME_COL_WIDTH },
                      { key: "spend", label: "Spend", align: "right", render: (r) => money(r.spend) },
                      { key: "revenue", label: "Revenue", align: "right", render: (r) => money(r.revenue) },
                      {
                        key: "revenueSharePct",
                        label: "% Revenue",
                        align: "right",
                        render: (r) => `${r.revenueSharePct.toFixed(1)}%`,
                      },
                      { key: "roas", label: "ROAS", align: "right", render: (r) => `${r.roas.toFixed(2)}x` },
                    ]}
                  />
                </section>

                {/* 80% pareto */}
                <section id="pareto" className={styles.card}>
                  <h2 className={styles.h2}>Where 80% of Purchase Revenue Comes From</h2>
                  {report.pareto.totalAdCount === 0 ? (
                    <p className={styles.sub}>No ad-level purchase data in this window.</p>
                  ) : (
                    <>
                      <p className={styles.sub} style={{ marginBottom: 12 }}>
                        <strong style={{ color: "var(--t1)" }}>
                          {report.pareto.contributorCount} of {report.pareto.totalAdCount} ads
                        </strong>{" "}
                        ({report.pareto.revenueSharePct.toFixed(0)}% of purchase revenue) account for{" "}
                        <strong style={{ color: "var(--t1)" }}>
                          {report.pareto.spendSharePct.toFixed(0)}% of spend
                        </strong>
                        .
                      </p>
                      <SortableTable
                        defaultSortKey="revenue"
                        maxHeight={360}
                        rows={report.pareto.contributors}
                        columns={[
                          {
                            key: "name",
                            label: "Creative",
                            render: (r) => <CreativeCell src={r.thumbnailUrl} name={r.name} />,
                          },
                          {
                            key: "campaignName",
                            label: "Campaign",
                            maxWidth: 180,
                            render: (r) => <span className={styles.muted}>{r.campaignName}</span>,
                          },
                          { key: "spend", label: "Spend", align: "right", render: (r) => money(r.spend) },
                          { key: "revenue", label: "Revenue", align: "right", render: (r) => money(r.revenue) },
                          {
                            key: "revenueSharePct",
                            label: "% Revenue",
                            align: "right",
                            render: (r) => `${r.revenueSharePct.toFixed(1)}%`,
                          },
                          { key: "roas", label: "ROAS", align: "right", render: (r) => `${r.roas.toFixed(2)}x` },
                          { key: "purchases", label: "Purchases", align: "right", render: (r) => r.purchases.toFixed(0) },
                        ]}
                      />
                    </>
                  )}
                </section>

                {/* Pixel health */}
                <section id="pixel-health" className={styles.card}>
                  <h2 className={styles.h2}>Pixel Event Health</h2>
                  {report.pixelHealth.pixels.length === 0 && report.pixelHealth.concerns.length === 0 ? (
                    <p className={styles.sub}>No pixel data available.</p>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {report.pixelHealth.pixels.map((p) => (
                        <div key={p.id} className={styles.listItem}>
                          {p.name}
                          <span
                            className={
                              p.status === "healthy"
                                ? styles.badgeGood
                                : p.status === "stale"
                                ? styles.badgeWarn
                                : styles.badgeDanger
                            }
                          >
                            {p.status === "healthy"
                              ? "Firing normally"
                              : p.status === "stale"
                              ? `Stale (${p.daysSinceFired.toFixed(1)}d)`
                              : "Never fired"}
                          </span>
                        </div>
                      ))}
                      {report.pixelHealth.concerns
                        .filter((c) => c.status === "missing")
                        .map((c, i) => (
                          <div key={`missing-${i}`} className={styles.listItem}>
                            {c.name}
                            <span className={styles.badgeDanger}>Missing</span>
                          </div>
                        ))}
                    </div>
                  )}
                </section>

                {/* Account structure: campaign → ad set → ad drill-down */}
                <section id="structure" className={styles.card}>
                  <div className={styles.sectionRow}>
                    <div>
                      <h2 className={styles.h2} style={{ marginBottom: 2 }}>
                        Account Structure ({report.structure.campaignCount} campaigns, {report.structure.adsetCount}{" "}
                        ad sets)
                      </h2>
                      <p className={styles.sub}>Only campaigns/ad sets with spend in the last 30 days are shown.</p>
                    </div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <span className={styles.muted}>Sort by</span>
                      <select
                        className={styles.select}
                        value={structureSortKey}
                        onChange={(e) => setStructureSortKey(e.target.value)}
                      >
                        {STRUCTURE_SORT_OPTIONS.map((opt) => (
                          <option key={opt.key} value={opt.key}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                      <button
                        className={styles.btnSecondary}
                        onClick={() => setStructureSortDir((d) => (d === "asc" ? "desc" : "asc"))}
                      >
                        {structureSortDir === "asc" ? "▲ Asc" : "▼ Desc"}
                      </button>
                      <button className={styles.btnSecondary} onClick={expandAllStructure}>
                        Expand All
                      </button>
                      <button className={styles.btnSecondary} onClick={collapseAllStructure}>
                        Collapse All
                      </button>
                    </div>
                  </div>
                  {report.structure.campaigns.length === 0 ? (
                    <p className={styles.sub}>No campaigns with spend in this window.</p>
                  ) : (
                    <div className={styles.tableScroll} style={{ maxHeight: 520 }}>
                      <table className={styles.table}>
                        <thead>
                          <tr>
                            <th>Name</th>
                            <th>Status</th>
                            <th style={{ textAlign: "right" }}>Budget</th>
                            <th style={{ textAlign: "right" }}>Spend (30d)</th>
                            <th style={{ textAlign: "right" }}>Purchases</th>
                            <th style={{ textAlign: "right" }}>ROAS</th>
                            <th style={{ textAlign: "right" }}>Frequency</th>
                            <th style={{ textAlign: "right" }}>Creatives</th>
                          </tr>
                        </thead>
                        <tbody>
                          {buildStructureRows().map((row) => (
                            <tr
                              key={row.key}
                              id={row.anchorId}
                              onClick={row.onToggle || undefined}
                              style={row.onToggle ? { cursor: "pointer" } : undefined}
                            >
                              <td>
                                <div
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 6,
                                    paddingLeft: row.level * 20,
                                    maxWidth: NAME_COL_WIDTH + row.level * 20,
                                    overflow: "hidden",
                                  }}
                                >
                                  <span style={{ width: 14, display: "inline-block", color: "var(--t3)", flexShrink: 0 }}>
                                    {row.hasChildren ? (row.expanded ? "▾" : "▸") : ""}
                                  </span>
                                  {row.level === 2 && <Thumb src={row.thumbnailUrl} size={24} />}
                                  <span
                                    title={row.name}
                                    style={{
                                      fontWeight: row.level === 0 ? 700 : row.level === 1 ? 600 : 400,
                                      color: row.level === 2 ? "var(--t2)" : "var(--t1)",
                                      minWidth: 0,
                                      flex: "1 1 auto",
                                      overflow: "hidden",
                                      textOverflow: "ellipsis",
                                      whiteSpace: "nowrap",
                                    }}
                                  >
                                    {row.name}
                                  </span>
                                  {row.countLabel && (
                                    <span className={styles.muted} style={{ flexShrink: 0 }}>
                                      ({row.countLabel})
                                    </span>
                                  )}
                                  {row.budgetBadge && <BudgetTypeBadge type={row.budgetBadge} />}
                                </div>
                              </td>
                              <td>{row.status ? <StatusDot status={row.status} /> : <span className={styles.muted}>—</span>}</td>
                              <td style={{ textAlign: "right" }}>{row.budgetText}</td>
                              <td style={{ textAlign: "right" }}>{money(row.spend)}</td>
                              <td style={{ textAlign: "right" }}>{row.purchases.toFixed(0)}</td>
                              <td style={{ textAlign: "right" }}>{row.roas.toFixed(2)}x</td>
                              <td style={{ textAlign: "right" }}>
                                {row.frequency != null ? row.frequency.toFixed(2) : "—"}
                              </td>
                              <td style={{ textAlign: "right" }}>{row.creativesText}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>

                {/* High frequency ads */}
                <section id="high-frequency" className={styles.card}>
                  <h2 className={styles.h2}>High-Frequency Ads (&gt;3, excluding retargeting)</h2>
                  <p className={styles.sub} style={{ marginBottom: 12 }}>
                    Frequency here is per-ad over the last 30 days ({report.dateRange30d.since} →{" "}
                    {report.dateRange30d.until}) — it will not match a campaign- or ad-set-level frequency column in
                    Ads Manager, since reach is deduplicated differently at each level. Compare against Ads
                    Manager&apos;s own per-ad frequency for the same dates.
                  </p>
                  <SortableTable
                    defaultSortKey="frequency"
                    maxHeight={360}
                    emptyMessage="No ads over frequency 3 outside retargeting campaigns/ad sets."
                    rows={report.highFrequencyAds}
                    columns={[
                      { key: "name", label: "Ad", render: (r) => <CreativeCell src={r.thumbnailUrl} name={r.name} /> },
                      {
                        key: "campaignName",
                        label: "Campaign",
                        maxWidth: 180,
                        render: (r) => <span className={styles.muted}>{r.campaignName}</span>,
                      },
                      {
                        key: "adsetName",
                        label: "Ad Set",
                        maxWidth: 180,
                        render: (r) => <span className={styles.muted}>{r.adsetName}</span>,
                      },
                      {
                        key: "frequency",
                        label: "Frequency",
                        align: "right",
                        render: (r) => <span className={styles.badgeWarn}>{r.frequency.toFixed(2)}</span>,
                      },
                    ]}
                  />
                </section>

                {/* Budget utilization, split by CBO / ABO */}
                <section id="budget-utilization" className={styles.card}>
                  <h2 className={styles.h2}>Budget Utilization &amp; Creative Count</h2>
                  <p className={styles.sub} style={{ marginBottom: 12 }}>
                    CBO campaigns are judged at the campaign level; ABO campaigns are judged ad set by ad set, since
                    that is where the budget actually lives. Creative recommendations benchmark against this
                    account&apos;s own average spend per active creative over the last 30 days —{" "}
                    <strong style={{ color: "var(--t1)" }}>
                      {money(report.budgetUtilization.accountAvgSpendPerCreative)}
                    </strong>
                    . Sort by Utilization to find underspend, or by Additional Needed to find creative gaps.
                  </p>

                  <h3 className={styles.sub} style={{ fontWeight: 700, color: "var(--t1)", marginBottom: 8 }}>
                    CBO Campaigns
                  </h3>
                  <SortableTable
                    defaultSortKey="utilizationPct"
                    defaultSortDir="asc"
                    maxHeight={320}
                    emptyMessage="No active CBO campaigns."
                    rows={report.budgetUtilization.cboCampaigns}
                    columns={[
                      { key: "name", label: "Campaign", maxWidth: NAME_COL_WIDTH },
                      {
                        key: "dailyBudget",
                        label: "Daily Budget",
                        align: "right",
                        render: (r) => (r.dailyBudget != null ? money(r.dailyBudget) : "—"),
                      },
                      { key: "avgDailySpend7d", label: "Avg Daily Spend (7d)", align: "right", render: (r) => money(r.avgDailySpend7d) },
                      {
                        key: "utilizationPct",
                        label: "Utilization",
                        align: "right",
                        render: (r) =>
                          r.utilizationPct == null ? (
                            "—"
                          ) : (
                            <span className={r.utilizationPct < 100 ? styles.badgeWarn : styles.badgeGood}>
                              {r.utilizationPct.toFixed(0)}%
                            </span>
                          ),
                      },
                      { key: "creativeCount", label: "Creatives", align: "right" },
                      { key: "recommendedCreatives", label: "Recommended", align: "right" },
                      {
                        key: "additionalNeeded",
                        label: "Additional Needed",
                        align: "right",
                        render: (r) =>
                          r.additionalNeeded > 0 ? (
                            <span className={styles.badgeWarn}>+{r.additionalNeeded}</span>
                          ) : (
                            "—"
                          ),
                      },
                    ]}
                  />

                  <h3 className={styles.sub} style={{ fontWeight: 700, color: "var(--t1)", margin: "16px 0 8px" }}>
                    ABO Ad Sets
                  </h3>
                  <SortableTable
                    defaultSortKey="utilizationPct"
                    defaultSortDir="asc"
                    maxHeight={320}
                    emptyMessage="No active ad sets in ABO campaigns."
                    rows={report.budgetUtilization.aboAdsets}
                    columns={[
                      { key: "name", label: "Ad Set", maxWidth: NAME_COL_WIDTH },
                      {
                        key: "campaignName",
                        label: "Campaign",
                        maxWidth: 180,
                        render: (r) => <span className={styles.muted}>{r.campaignName}</span>,
                      },
                      {
                        key: "dailyBudget",
                        label: "Daily Budget",
                        align: "right",
                        render: (r) => (r.dailyBudget != null ? money(r.dailyBudget) : "—"),
                      },
                      { key: "avgDailySpend7d", label: "Avg Daily Spend (7d)", align: "right", render: (r) => money(r.avgDailySpend7d) },
                      {
                        key: "utilizationPct",
                        label: "Utilization",
                        align: "right",
                        render: (r) =>
                          r.utilizationPct == null ? (
                            "—"
                          ) : (
                            <span className={r.utilizationPct < 100 ? styles.badgeWarn : styles.badgeGood}>
                              {r.utilizationPct.toFixed(0)}%
                            </span>
                          ),
                      },
                      { key: "creativeCount", label: "Creatives", align: "right" },
                      { key: "recommendedCreatives", label: "Recommended", align: "right" },
                      {
                        key: "additionalNeeded",
                        label: "Additional Needed",
                        align: "right",
                        render: (r) =>
                          r.additionalNeeded > 0 ? (
                            <span className={styles.badgeWarn}>+{r.additionalNeeded}</span>
                          ) : (
                            "—"
                          ),
                      },
                    ]}
                  />
                </section>
                </div>
              </div>
            </>
          )}
        </main>
      </div>
    </>
  );
}

function Stat({ label, value }) {
  return (
    <div className={styles.stat}>
      <p className={styles.statLabel}>{label}</p>
      <p className={styles.statValue}>{value}</p>
    </div>
  );
}

export async function getServerSideProps(context) {
  const session = await getServerSession(context.req, context.res, authOptions);

  if (!session) {
    return { redirect: { destination: "/", permanent: false } };
  }

  return { props: {} };
}
