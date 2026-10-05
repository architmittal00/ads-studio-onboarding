import Head from "next/head";
import { getServerSession } from "next-auth/next";
import { useEffect, useState } from "react";
import { authOptions } from "./api/auth/[...nextauth]";
import Nav from "@/components/Nav";
import SectionNav from "@/components/SectionNav";
import SortableTable from "@/components/SortableTable";
import { getLastAccountId, setLastAccountId } from "@/lib/clientStorage";
import styles from "@/styles/Home.module.css";

const SECTIONS = [
  { id: "overview", label: "Overview" },
  { id: "trends", label: "Best Week / Month" },
  { id: "top-campaigns", label: "Top Campaigns" },
  { id: "pareto", label: "Revenue Concentration" },
  { id: "pixel-health", label: "Pixel Health" },
  { id: "structure", label: "Account Structure" },
  { id: "high-frequency", label: "High-Frequency Ads" },
  { id: "budget-utilization", label: "Budget Utilization" },
  { id: "creative-recommendations", label: "Creative Recommendations" },
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

    fetch(`/api/fb/report?accountId=${encodeURIComponent(selectedAccountId)}`)
      .then((res) => res.json())
      .then((json) => {
        if (json.error) setReportError(json.error);
        else setReport(json);
      })
      .catch((err) => setReportError(err.message))
      .finally(() => setReportLoading(false));
  }, [selectedAccountId]);

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

          {reportLoading && <p className={styles.sub}>Building the report…</p>}
          {reportError && <div className={styles.error}>Error: {reportError}</div>}

          {report && (
            <div className={styles.reportLayout}>
              <SectionNav sections={SECTIONS} />

              <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
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
                      { key: "name", label: "Campaign" },
                      { key: "spend", label: "Spend", align: "right", render: (r) => money(r.spend) },
                      { key: "revenue", label: "Revenue", align: "right", render: (r) => money(r.revenue) },
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
                          { key: "name", label: "Creative" },
                          { key: "campaignName", label: "Campaign", render: (r) => <span className={styles.muted}>{r.campaignName}</span> },
                          { key: "spend", label: "Spend", align: "right", render: (r) => money(r.spend) },
                          { key: "revenue", label: "Revenue", align: "right", render: (r) => money(r.revenue) },
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
                  <h2 className={styles.h2}>
                    Account Structure ({report.structure.campaignCount} campaigns, {report.structure.adsetCount} ad
                    sets)
                  </h2>
                  {report.structure.campaigns.length === 0 ? (
                    <p className={styles.sub}>No campaigns found.</p>
                  ) : (
                    <div>
                      {report.structure.campaigns.map((c) => (
                        <div key={c.id} id={`campaign-${c.id}`} className={styles.accordionItem}>
                          <div className={styles.accordionHeader} onClick={() => toggleCampaign(c.id)}>
                            <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              {c.name} <span className={styles.muted}>({c.adsets.length} ad sets)</span>
                            </span>
                            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                              <BudgetTypeBadge type={c.budgetType} />
                              <span className={styles.muted}>{money(c.spend30d)}</span>
                              <span className={styles.pill}>{c.status}</span>
                            </span>
                          </div>
                          {expandedCampaigns[c.id] && (
                            <div className={styles.accordionBody}>
                              <p className={styles.sub}>
                                Objective: {c.objective || "—"} · ROAS: {c.roas30d.toFixed(2)}x · Creatives:{" "}
                                {c.creativeCount}
                                {c.budgetType === "CBO" && c.dailyBudget
                                  ? ` · Daily budget: ${money(c.dailyBudget)}`
                                  : ""}
                              </p>
                              {c.adsets.length === 0 ? (
                                <p className={styles.sub}>No ad sets.</p>
                              ) : (
                                c.adsets.map((a) => (
                                  <div key={a.id} className={styles.accordionItem} style={{ marginBottom: 6 }}>
                                    <div className={styles.accordionHeader} onClick={() => toggleAdset(a.id)}>
                                      <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                        {a.name} <span className={styles.muted}>({a.ads.length} ads)</span>
                                      </span>
                                      <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                        <span className={styles.muted}>{money(a.spend30d)}</span>
                                        <span className={styles.pill}>{a.status}</span>
                                      </span>
                                    </div>
                                    {expandedAdsets[a.id] && (
                                      <div className={styles.accordionBody}>
                                        <p className={styles.sub}>
                                          ROAS: {a.roas30d.toFixed(2)}x · Creatives: {a.creativeCount}
                                          {c.budgetType === "ABO" && a.dailyBudget
                                            ? ` · Daily budget: ${money(a.dailyBudget)}`
                                            : ""}
                                        </p>
                                        {a.ads.length === 0 ? (
                                          <p className={styles.sub}>No ads with delivery in the last 30 days.</p>
                                        ) : (
                                          a.ads.map((ad) => (
                                            <div key={ad.id} className={styles.listItem}>
                                              {ad.name}
                                              <span className={styles.muted}>
                                                {money(ad.spend)} · {ad.roas.toFixed(2)}x · freq {ad.frequency.toFixed(2)}
                                              </span>
                                            </div>
                                          ))
                                        )}
                                      </div>
                                    )}
                                  </div>
                                ))
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                {/* High frequency ads */}
                <section id="high-frequency" className={styles.card}>
                  <h2 className={styles.h2}>High-Frequency Ads (&gt;3, excluding retargeting)</h2>
                  <SortableTable
                    defaultSortKey="frequency"
                    maxHeight={360}
                    emptyMessage="No ads over frequency 3 outside retargeting campaigns/ad sets."
                    rows={report.highFrequencyAds}
                    columns={[
                      { key: "name", label: "Ad" },
                      { key: "campaignName", label: "Campaign", render: (r) => <span className={styles.muted}>{r.campaignName}</span> },
                      { key: "adsetName", label: "Ad Set", render: (r) => <span className={styles.muted}>{r.adsetName}</span> },
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
                  <h2 className={styles.h2}>Budget Utilization (Spend Below Daily Budget)</h2>
                  <p className={styles.sub} style={{ marginBottom: 12 }}>
                    CBO campaigns are judged at the campaign level; ABO campaigns are judged ad set by ad set, since
                    that is where the budget actually lives.
                  </p>

                  <h3 className={styles.sub} style={{ fontWeight: 700, color: "var(--t1)", marginBottom: 8 }}>
                    CBO Campaigns
                  </h3>
                  <SortableTable
                    defaultSortKey="utilizationPct"
                    defaultSortDir="asc"
                    maxHeight={280}
                    emptyMessage="No active CBO campaigns spending below their daily budget."
                    rows={report.underutilized.cboCampaigns}
                    columns={[
                      { key: "name", label: "Campaign" },
                      { key: "dailyBudget", label: "Daily Budget", align: "right", render: (r) => money(r.dailyBudget) },
                      { key: "avgDailySpend7d", label: "Avg Daily Spend (7d)", align: "right", render: (r) => money(r.avgDailySpend7d) },
                      {
                        key: "utilizationPct",
                        label: "Utilization",
                        align: "right",
                        render: (r) => <span className={styles.badgeWarn}>{r.utilizationPct.toFixed(0)}%</span>,
                      },
                    ]}
                  />

                  <h3 className={styles.sub} style={{ fontWeight: 700, color: "var(--t1)", margin: "16px 0 8px" }}>
                    ABO Ad Sets
                  </h3>
                  <SortableTable
                    defaultSortKey="utilizationPct"
                    defaultSortDir="asc"
                    maxHeight={280}
                    emptyMessage="No active ad sets spending below their daily budget."
                    rows={report.underutilized.aboAdsets}
                    columns={[
                      { key: "name", label: "Ad Set" },
                      { key: "campaignName", label: "Campaign", render: (r) => <span className={styles.muted}>{r.campaignName}</span> },
                      { key: "dailyBudget", label: "Daily Budget", align: "right", render: (r) => money(r.dailyBudget) },
                      { key: "avgDailySpend7d", label: "Avg Daily Spend (7d)", align: "right", render: (r) => money(r.avgDailySpend7d) },
                      {
                        key: "utilizationPct",
                        label: "Utilization",
                        align: "right",
                        render: (r) => <span className={styles.badgeWarn}>{r.utilizationPct.toFixed(0)}%</span>,
                      },
                    ]}
                  />
                </section>

                {/* Creative recommendations, split by CBO / ABO */}
                <section id="creative-recommendations" className={styles.card}>
                  <h2 className={styles.h2}>Creative Count Recommendations</h2>
                  <p className={styles.sub} style={{ marginBottom: 12 }}>
                    Benchmark: this account&apos;s own average spend per active creative over the last 30 days —{" "}
                    <strong style={{ color: "var(--t1)" }}>
                      {money(report.creativeRecommendations.accountAvgSpendPerCreative)}
                    </strong>
                    . Campaigns/ad sets spending more than that per creative are flagged as needing more.
                  </p>

                  <h3 className={styles.sub} style={{ fontWeight: 700, color: "var(--t1)", marginBottom: 8 }}>
                    CBO Campaigns
                  </h3>
                  <SortableTable
                    defaultSortKey="additionalNeeded"
                    maxHeight={280}
                    emptyMessage="No CBO campaigns need more creatives right now."
                    rows={report.creativeRecommendations.cboCampaigns}
                    columns={[
                      { key: "name", label: "Campaign" },
                      { key: "spend30d", label: "Spend (30d)", align: "right", render: (r) => money(r.spend30d) },
                      { key: "creativeCount", label: "Current", align: "right" },
                      { key: "recommendedCreatives", label: "Recommended", align: "right" },
                      {
                        key: "additionalNeeded",
                        label: "Additional Needed",
                        align: "right",
                        render: (r) => <span className={styles.badgeWarn}>+{r.additionalNeeded}</span>,
                      },
                    ]}
                  />

                  <h3 className={styles.sub} style={{ fontWeight: 700, color: "var(--t1)", margin: "16px 0 8px" }}>
                    ABO Ad Sets
                  </h3>
                  <SortableTable
                    defaultSortKey="additionalNeeded"
                    maxHeight={280}
                    emptyMessage="No ad sets need more creatives right now."
                    rows={report.creativeRecommendations.aboAdsets}
                    columns={[
                      { key: "name", label: "Ad Set" },
                      { key: "campaignName", label: "Campaign", render: (r) => <span className={styles.muted}>{r.campaignName}</span> },
                      { key: "spend30d", label: "Spend (30d)", align: "right", render: (r) => money(r.spend30d) },
                      { key: "creativeCount", label: "Current", align: "right" },
                      { key: "recommendedCreatives", label: "Recommended", align: "right" },
                      {
                        key: "additionalNeeded",
                        label: "Additional Needed",
                        align: "right",
                        render: (r) => <span className={styles.badgeWarn}>+{r.additionalNeeded}</span>,
                      },
                    ]}
                  />
                </section>
              </div>
            </div>
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
