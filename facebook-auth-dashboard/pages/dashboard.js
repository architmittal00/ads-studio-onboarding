import Head from "next/head";
import { getServerSession } from "next-auth/next";
import { signOut } from "next-auth/react";
import { useEffect, useState } from "react";
import { authOptions } from "./api/auth/[...nextauth]";
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
            setSelectedAccountId(json.adAccounts[0].id);
          }
        }
      })
      .catch((err) => setError(err.message));
  }, []);

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
        <main className={styles.main} style={{ width: "100%", maxWidth: 720 }}>
          <div style={{ display: "flex", justifyContent: "space-between", width: "100%", alignItems: "center" }}>
            <h1>Dashboard</h1>
            <button onClick={() => signOut({ callbackUrl: "/" })}>Sign out</button>
          </div>

          {error && <p style={{ color: "crimson" }}>Error: {error}</p>}
          {!data && !error && <p>Loading your Facebook data…</p>}

          {data && (
            <section style={{ width: "100%", display: "flex", flexDirection: "column", gap: 24 }}>
              <div>
                <h2>Profile</h2>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  {data.profile.picture?.data?.url && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={data.profile.picture.data.url}
                      alt={data.profile.name}
                      width={56}
                      height={56}
                      style={{ borderRadius: "50%" }}
                    />
                  )}
                  <div>
                    <p style={{ margin: 0, fontWeight: 600 }}>{data.profile.name}</p>
                    <p style={{ margin: 0, opacity: 0.7 }}>{data.profile.email || user?.email || "No email permission granted"}</p>
                  </div>
                </div>
              </div>

              <div>
                <h2>Pages ({data.pages.length})</h2>
                {data.pages.length === 0 ? (
                  <p style={{ opacity: 0.7 }}>No Pages found, or permission not granted.</p>
                ) : (
                  <ul>
                    {data.pages.map((page) => (
                      <li key={page.id}>
                        {page.name} <span style={{ opacity: 0.6 }}>({page.category})</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div>
                <h2>Ad Accounts ({data.adAccounts.length})</h2>
                {data.adAccounts.length === 0 ? (
                  <p style={{ opacity: 0.7 }}>No Ad Accounts found, or permission not granted.</p>
                ) : (
                  <ul>
                    {data.adAccounts.map((acc) => (
                      <li key={acc.id}>
                        {acc.name} <span style={{ opacity: 0.6 }}>({acc.currency}, status {acc.account_status})</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {data.adAccounts.length > 0 && (
                <div>
                  <h2>Ad Account Performance (Last 30 Days)</h2>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <select
                      value={selectedAccountId}
                      onChange={(e) => setSelectedAccountId(e.target.value)}
                    >
                      {data.adAccounts.map((acc) => (
                        <option key={acc.id} value={acc.id}>
                          {acc.name}
                        </option>
                      ))}
                    </select>
                    <button onClick={checkPerformance} disabled={insightsLoading}>
                      {insightsLoading ? "Checking…" : "Check ROAS"}
                    </button>
                  </div>

                  {insightsError && (
                    <p style={{ color: "crimson" }}>Error: {insightsError}</p>
                  )}

                  {insights && (
                    <div
                      style={{
                        marginTop: 12,
                        display: "flex",
                        gap: 24,
                        flexWrap: "wrap",
                      }}
                    >
                      <Stat label="ROAS" value={`${insights.roas.toFixed(2)}x`} />
                      <Stat
                        label="Spend"
                        value={formatCurrency(
                          insights.spend,
                          data.adAccounts.find((a) => a.id === selectedAccountId)?.currency
                        )}
                      />
                      <Stat
                        label="Purchase Revenue"
                        value={formatCurrency(
                          insights.revenue,
                          data.adAccounts.find((a) => a.id === selectedAccountId)?.currency
                        )}
                      />
                      <Stat label="CTR" value={`${insights.ctr.toFixed(2)}%`} />
                      <Stat label="Conversions" value={insights.conversions.toFixed(0)} />
                      {!insights.hasData && (
                        <p style={{ opacity: 0.7 }}>No activity in the last 30 days.</p>
                      )}
                    </div>
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
    <div>
      <p style={{ margin: 0, opacity: 0.7, fontSize: 13 }}>{label}</p>
      <p style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>{value}</p>
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
