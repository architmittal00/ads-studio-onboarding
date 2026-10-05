import Head from "next/head";
import { getServerSession } from "next-auth/next";
import { useEffect, useState } from "react";
import { authOptions } from "./api/auth/[...nextauth]";
import Nav from "@/components/Nav";
import styles from "@/styles/Home.module.css";

export default function Report() {
  const [accounts, setAccounts] = useState([]);
  const [accountsError, setAccountsError] = useState(null);
  const [selectedAccountId, setSelectedAccountId] = useState("");

  const [report, setReport] = useState(null);
  const [reportError, setReportError] = useState(null);
  const [reportLoading, setReportLoading] = useState(false);

  const [expandedCampaigns, setExpandedCampaigns] = useState({});

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
            setSelectedAccountId(json.adAccounts[0].id);
          }
        }
      })
      .catch((err) => setAccountsError(err.message));
  }, []);

  useEffect(() => {
    if (!selectedAccountId) return;

    // Standard fetch-on-param-change pattern (react.dev/learn/synchronizing-with-effects#fetching-data):
    // resetting loading/error/data state synchronously here is intentional, not a sync-derived-state bug.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReportLoading(true);
    setReportError(null);
    setReport(null);

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
      return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
    } catch {
      return `${amount.toFixed(2)} ${currency}`;
    }
  }

  function toggleCampaign(id) {
    setExpandedCampaigns((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  return (
    <>
      <Head>
        <title>Account Handover Report · Facebook Auth Dashboard</title>
      </Head>
      <div className={styles.page}>
        <main className={styles.main} style={{ maxWidth: 920, margin: "0 auto" }}>
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
            <section style={{ display: "flex", flexDirection: "column", gap: 20 }}>
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
              <div>
                <h2 className={styles.h2}>Last 30 Days</h2>
                <div className={styles.statBar}>
                  <Stat label="Spend" value={money(report.overview.spend)} />
                  <Stat label="Purchases" value={report.overview.purchases.toFixed(0)} />
                  <Stat label="ROAS" value={`${report.overview.roas.toFixed(2)}x`} />
                  <Stat label="CTR" value={`${report.overview.ctr.toFixed(2)}%`} />
                  <Stat label="CVR" value={`${report.overview.cvr.toFixed(2)}%`} />
                </div>
              </div>

              {/* Best week / month */}
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
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
                        {report.bestMonth.since} → {report.bestMonth.until} · spend {money(report.bestMonth.spend)}
                      </p>
                    </>
                  ) : (
                    <p className={styles.sub}>No months with spend in this window.</p>
                  )}
                </div>
              </div>

              {/* Top spending campaigns */}
              <div className={styles.card}>
                <h2 className={styles.h2}>Top Spending Campaigns (Last 30 Days)</h2>
                {report.topCampaigns.length === 0 ? (
                  <p className={styles.sub}>No campaign spend in this window.</p>
                ) : (
                  <div style={{ overflowX: "auto" }}>
                    <table className={styles.table}>
                      <thead>
                        <tr>
                          <th>Campaign</th>
                          <th>Spend</th>
                          <th>Revenue</th>
                          <th>ROAS</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.topCampaigns.map((c) => (
                          <tr key={c.id}>
                            <td>{c.name}</td>
                            <td>{money(c.spend)}</td>
                            <td>{money(c.revenue)}</td>
                            <td>{c.roas.toFixed(2)}x</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* 80% pareto */}
              <div className={styles.card}>
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
                      <strong style={{ color: "var(--t1)" }}>{report.pareto.spendSharePct.toFixed(0)}% of spend</strong>.
                    </p>
                    <div style={{ overflowX: "auto" }}>
                      <table className={styles.table}>
                        <thead>
                          <tr>
                            <th>Creative</th>
                            <th>Campaign</th>
                            <th>Spend</th>
                            <th>Revenue</th>
                            <th>ROAS</th>
                            <th>Purchases</th>
                          </tr>
                        </thead>
                        <tbody>
                          {report.pareto.contributors.map((c, i) => (
                            <tr key={i}>
                              <td>{c.name}</td>
                              <td className={styles.muted}>{c.campaignName}</td>
                              <td>{money(c.spend)}</td>
                              <td>{money(c.revenue)}</td>
                              <td>{c.roas.toFixed(2)}x</td>
                              <td>{c.purchases.toFixed(0)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </div>

              {/* Pixel health */}
              <div className={styles.card}>
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
              </div>

              {/* Account structure */}
              <div className={styles.card}>
                <h2 className={styles.h2}>
                  Account Structure ({report.structure.campaignCount} campaigns, {report.structure.adsetCount} ad
                  sets)
                </h2>
                {report.structure.campaigns.length === 0 ? (
                  <p className={styles.sub}>No campaigns found.</p>
                ) : (
                  <div>
                    {report.structure.campaigns.map((c) => (
                      <div key={c.id} className={styles.accordionItem}>
                        <div className={styles.accordionHeader} onClick={() => toggleCampaign(c.id)}>
                          <span>
                            {c.name} <span className={styles.muted}>({c.adsets.length} ad sets)</span>
                          </span>
                          <span className={styles.pill}>{c.status}</span>
                        </div>
                        {expandedCampaigns[c.id] && (
                          <div className={styles.accordionBody}>
                            <p className={styles.sub}>
                              Objective: {c.objective || "—"} · Daily budget:{" "}
                              {c.dailyBudget ? money(c.dailyBudget) : "—"}
                            </p>
                            {c.adsets.length === 0 ? (
                              <p className={styles.sub}>No ad sets.</p>
                            ) : (
                              c.adsets.map((a) => (
                                <div key={a.id} className={styles.listItem}>
                                  {a.name}
                                  <span className={styles.muted}>
                                    {a.status} · {a.dailyBudget ? money(a.dailyBudget) : "no daily budget"}
                                  </span>
                                </div>
                              ))
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* High frequency ads */}
              <div className={styles.card}>
                <h2 className={styles.h2}>High-Frequency Ads (&gt;3, excluding retargeting)</h2>
                {report.highFrequencyAds.length === 0 ? (
                  <p className={styles.sub}>No ads over frequency 3 outside retargeting campaigns/ad sets.</p>
                ) : (
                  <div style={{ overflowX: "auto" }}>
                    <table className={styles.table}>
                      <thead>
                        <tr>
                          <th>Ad</th>
                          <th>Campaign</th>
                          <th>Ad Set</th>
                          <th>Frequency</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.highFrequencyAds.map((a, i) => (
                          <tr key={i}>
                            <td>{a.name}</td>
                            <td className={styles.muted}>{a.campaignName}</td>
                            <td className={styles.muted}>{a.adsetName}</td>
                            <td>
                              <span className={styles.badgeWarn}>{a.frequency.toFixed(2)}</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Underutilized campaigns */}
              <div className={styles.card}>
                <h2 className={styles.h2}>Underutilized Campaigns (Spend Below Daily Budget)</h2>
                {report.underutilized.length === 0 ? (
                  <p className={styles.sub}>No active campaigns spending below their daily budget.</p>
                ) : (
                  <div style={{ overflowX: "auto" }}>
                    <table className={styles.table}>
                      <thead>
                        <tr>
                          <th>Campaign</th>
                          <th>Daily Budget</th>
                          <th>Avg Daily Spend (7d)</th>
                          <th>Utilization</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.underutilized.map((c) => (
                          <tr key={c.id}>
                            <td>{c.name}</td>
                            <td>{money(c.effectiveBudget)}</td>
                            <td>{money(c.avgDailySpend)}</td>
                            <td>
                              <span className={styles.badgeWarn}>{c.utilizationPct.toFixed(0)}%</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </section>
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
