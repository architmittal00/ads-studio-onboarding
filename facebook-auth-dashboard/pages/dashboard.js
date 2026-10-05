import Head from "next/head";
import { getServerSession } from "next-auth/next";
import { useEffect, useState } from "react";
import { authOptions } from "./api/auth/[...nextauth]";
import Nav from "@/components/Nav";
import { getLastAccountId, setLastAccountId } from "@/lib/clientStorage";
import styles from "@/styles/Home.module.css";

export default function Dashboard({ user }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [insights, setInsights] = useState(null);
  const [insightsError, setInsightsError] = useState(null);
  const [insightsLoading, setInsightsLoading] = useState(false);

  useEffect(() => {
    fetch("/api/fb/data")
      .then((res) => res.json())
      .then((json) => {
        if (json.error) {
          setError(json.error);
        } else {
          setData(json);
          if (json.adAccounts?.length) {
            const lastId = getLastAccountId();
            const stillExists = json.adAccounts.some((a) => a.id === lastId);
            setSelectedAccountId(stillExists ? lastId : json.adAccounts[0].id);
          }
        }
      })
      .catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    if (selectedAccountId) setLastAccountId(selectedAccountId);
  }, [selectedAccountId]);

  function checkPerformance() {
    if (!selectedAccountId) return;
    setInsightsLoading(true);
    setInsightsError(null);
    setInsights(null);

    fetch(`/api/fb/insights?accountId=${encodeURIComponent(selectedAccountId)}`)
      .then((res) => res.json())
      .then((json) => {
        if (json.error) setInsightsError(json.error);
        else setInsights(json);
      })
      .catch((err) => setInsightsError(err.message))
      .finally(() => setInsightsLoading(false));
  }

  return (
    <>
      <Head>
        <title>Dashboard · Facebook Auth Dashboard</title>
      </Head>
      <div className={styles.page}>
        <main className={styles.main} style={{ maxWidth: 720, margin: "0 auto" }}>
          <Nav />
          <h1 className={styles.h1}>Raw Data</h1>

          {error && <div className={styles.error}>Error: {error}</div>}
          {!data && !error && <p className={styles.sub}>Loading your Facebook data…</p>}

          {data && (
            <section style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              <div className={styles.card}>
                <h2 className={styles.h2}>Profile</h2>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  {data.profile.picture?.data?.url && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      className={styles.avatar}
                      src={data.profile.picture.data.url}
                      alt={data.profile.name}
                      width={56}
                      height={56}
                    />
                  )}
                  <div>
                    <p style={{ fontWeight: 700, fontSize: 14 }}>{data.profile.name}</p>
                    <p className={styles.sub}>
                      {data.profile.email || user?.email || "No email permission granted"}
                    </p>
                  </div>
                </div>
              </div>

              <div className={styles.card}>
                <h2 className={styles.h2}>Pages ({data.pages.length})</h2>
                {data.pages.length === 0 ? (
                  <p className={styles.sub}>No Pages found, or permission not granted.</p>
                ) : (
                  <ul className={styles.list}>
                    {data.pages.map((page) => (
                      <li key={page.id} className={styles.listItem}>
                        {page.name}
                        <span className={styles.pill}>{page.category}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className={styles.card}>
                <h2 className={styles.h2}>Ad Accounts ({data.adAccounts.length})</h2>
                {data.adAccounts.length === 0 ? (
                  <p className={styles.sub}>No Ad Accounts found, or permission not granted.</p>
                ) : (
                  <ul className={styles.list}>
                    {data.adAccounts.map((acc) => (
                      <li key={acc.id} className={styles.listItem}>
                        {acc.name}
                        <span className={styles.muted}>
                          {acc.currency} · status {acc.account_status}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {data.adAccounts.length > 0 && (
                <div className={styles.card}>
                  <h2 className={styles.h2}>Ad Account Performance (Last 30 Days)</h2>
                  <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 16 }}>
                    <select
                      className={styles.select}
                      value={selectedAccountId}
                      onChange={(e) => setSelectedAccountId(e.target.value)}
                    >
                      {data.adAccounts.map((acc) => (
                        <option key={acc.id} value={acc.id}>
                          {acc.name}
                        </option>
                      ))}
                    </select>
                    <button className={styles.btnPrimary} onClick={checkPerformance} disabled={insightsLoading}>
                      {insightsLoading ? "Checking…" : "Check ROAS"}
                    </button>
                  </div>

                  {insightsError && <div className={styles.error}>Error: {insightsError}</div>}

                  {insights && (
                    <>
                      <div className={styles.statBar}>
                        <Stat label="ROAS" value={`${insights.roas.toFixed(2)}x`} />
                        <Stat
                          label="Spend"
                          value={formatCurrency(
                            insights.spend,
                            data.adAccounts.find((a) => a.id === selectedAccountId)?.currency
                          )}
                        />
                        <Stat
                          label="Revenue"
                          value={formatCurrency(
                            insights.revenue,
                            data.adAccounts.find((a) => a.id === selectedAccountId)?.currency
                          )}
                        />
                        <Stat label="CTR" value={`${insights.ctr.toFixed(2)}%`} />
                        <Stat label="Conversions" value={insights.conversions.toFixed(0)} />
                      </div>
                      {!insights.hasData && (
                        <p className={styles.sub} style={{ marginTop: 10 }}>
                          No activity in the last 30 days.
                        </p>
                      )}
                    </>
                  )}
                </div>
              )}
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

function formatCurrency(amount, currency) {
  if (!currency) return amount.toFixed(2);
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

export async function getServerSideProps(context) {
  const session = await getServerSession(context.req, context.res, authOptions);

  if (!session) {
    return { redirect: { destination: "/", permanent: false } };
  }

  return { props: { user: session.user || null } };
}
