import Head from "next/head";
import { getServerSession } from "next-auth/next";
import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import { authOptions } from "./api/auth/[...nextauth]";
import { publicSession } from "@/lib/publicSession";
import Layout from "@/components/Layout";
import CacheStatus from "@/components/CacheStatus";
import AccountSelect from "@/components/AccountSelect";
import { CopyIcon, CheckIcon } from "@/components/icons";
import { useAccounts } from "@/components/AccountProvider";
import { cachedGet } from "@/lib/cachedGet";
import { getCachedEntry, setCachedEntry } from "@/lib/clientCache";
import styles from "@/styles/Home.module.css";

function formatMoney(amount, currency) {
  try {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency: currency || "INR", maximumFractionDigits: 2 }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency || ""}`;
  }
}

const ACCOUNT_STATUS = {
  1: ["Active", "badgeGood"],
  2: ["Disabled", "badgeDanger"],
  3: ["Unsettled", "badgeWarn"],
  7: ["In review", "badgeWarn"],
  8: ["Settling", "badgeWarn"],
  9: ["Grace period", "badgeWarn"],
  100: ["Closing", "badgeDanger"],
  101: ["Closed", "badgeDanger"],
  201: ["Any active", "badgeInfo"],
  202: ["Any closed", "badgeDanger"],
};

const GRID = { display: "grid", gridTemplateColumns: "minmax(220px, 2.2fr) 110px minmax(150px, 1.2fr) minmax(170px, 1.4fr)", gap: 12, alignItems: "center", minWidth: 640 };

function insightsCacheKey(accountId) {
  return `insights:${accountId}`;
}

export default function Dashboard({ user }) {
  const {
    profile,
    pages,
    adAccounts,
    accountsLoading,
    accountsError: error,
    pagesError,
    adAccountsError,
    accountsFetchedAt,
    refreshAccounts,
    selectedAccountId,
    setSelectedAccountId,
  } = useAccounts();
  const data = profile ? { profile, pages, adAccounts } : null;

  // Balances load after the list so a slow or refused balance call never holds the accounts back.
  const [balances, setBalances] = useState(null);
  const [balancesError, setBalancesError] = useState(null);
  const [accountQuery, setAccountQuery] = useState("");
  const hasAccounts = adAccounts.length > 0;
  useEffect(() => {
    if (!hasAccounts) return;
    let cancelled = false;
    cachedGet("/api/fb/account-balances", { ttlMs: 60000 })
      .then((json) => {
        if (cancelled) return;
        if (json.error) setBalancesError(json.error);
        else setBalances(json.balances || {});
      })
      .catch((err) => !cancelled && setBalancesError(err.message));
    return () => {
      cancelled = true;
    };
  }, [hasAccounts]);

  // Client-visible copy of the token every API route is using server-side
  // for Graph calls (pages/api/auth/[...nextauth].js's own `session`
  // callback already puts it here) — surfaced so a user whose account/Page
  // list looks wrong can paste it straight into Meta's own Graph API
  // Explorer and check what Meta itself returns for this exact token,
  // without this app's own account-data cache (see the Hard Refresh button
  // below) in the way.
  const { data: session } = useSession();
  const accessToken = session?.accessToken || "";
  const [tokenVisible, setTokenVisible] = useState(false);
  const [tokenCopied, setTokenCopied] = useState(false);

  function copyToken() {
    navigator.clipboard?.writeText(accessToken).catch(() => {});
    setTokenCopied(true);
    setTimeout(() => setTokenCopied(false), 1500);
  }

  const [insights, setInsights] = useState(null);
  const [insightsError, setInsightsError] = useState(null);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insightsFetchedAt, setInsightsFetchedAt] = useState(null);

  function checkPerformance(force) {
    if (!selectedAccountId) return;
    const cacheKey = insightsCacheKey(selectedAccountId);

    if (!force) {
      const cached = getCachedEntry(cacheKey);
      if (cached) {
        setInsights(cached.data);
        setInsightsFetchedAt(cached.fetchedAt);
        setInsightsError(null);
        return;
      }
    }

    setInsightsLoading(true);
    setInsightsError(null);
    setInsights(null);

    fetch(`/api/fb/insights?accountId=${encodeURIComponent(selectedAccountId)}`)
      .then((res) => res.json())
      .then((json) => {
        if (json.error) {
          setInsightsError(json.error);
        } else {
          setInsights(json);
          setInsightsFetchedAt(Date.now());
          setCachedEntry(cacheKey, json);
        }
      })
      .catch((err) => setInsightsError(err.message))
      .finally(() => setInsightsLoading(false));
  }

  return (
    <Layout>
      <Head>
        <title>Dashboard · Facebook Auth Dashboard</title>
      </Head>
      <div className={styles.page}>
        <main className={styles.main} style={{ maxWidth: 1100, margin: "0 auto" }}>
          <h1 className={styles.h1}>Raw Data</h1>

          {/* Reported by the user: a newly-connected Meta ad account didn't
              show up in the Ad Accounts list below even after several
              sign-out/sign-in cycles, because AccountProvider's own
              30-minute cache (lib/clientCache.js) isn't tied to the session
              at all — signing out never cleared it (now fixed separately in
              components/Sidebar.js), but this button covers the more common
              case of the account list changing on Meta's side mid-session,
              with no need to sign out at all. */}
          {(accountsFetchedAt || accountsLoading) && (
            <div style={{ marginTop: -8, marginBottom: 16 }}>
              <CacheStatus label="Account data" fetchedAt={accountsFetchedAt} loading={accountsLoading} onRefresh={refreshAccounts} />
            </div>
          )}

          {error && <div className={styles.error}>Error: {error}</div>}
          {!data && !error && <p className={styles.sub}>Loading your Facebook data…</p>}

          {data && (
            <section style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              {accessToken && (
                <div className={styles.card}>
                  <h2 className={styles.h2}>Access Token</h2>
                  <p className={styles.sub} style={{ marginTop: -4, marginBottom: 10 }}>
                    The exact token every call above is using. If an account or Page you expect isn&apos;t showing up here, paste
                    this into Meta&apos;s own{" "}
                    <a href="https://developers.facebook.com/tools/explorer/" target="_blank" rel="noreferrer">
                      Graph API Explorer
                    </a>{" "}
                    and query it directly — that tells you whether Meta itself isn&apos;t returning it for this token, or
                    whether it&apos;s this app not picking it up.
                  </p>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <input
                      type={tokenVisible ? "text" : "password"}
                      readOnly
                      value={accessToken}
                      className={styles.select}
                      style={{ flex: 1, fontFamily: "monospace", fontSize: 12 }}
                      onFocus={(e) => e.target.select()}
                    />
                    <button type="button" className={styles.btnSecondary} onClick={() => setTokenVisible((v) => !v)}>
                      {tokenVisible ? "Hide" : "Show"}
                    </button>
                    <button type="button" className={styles.btnSecondary} onClick={copyToken}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                        {tokenCopied ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
                        {tokenCopied ? "Copied" : "Copy"}
                      </span>
                    </button>
                  </div>
                </div>
              )}

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
                  pagesError ? (
                    // Distinct from the empty-but-no-error case below — this
                    // means Meta's own Graph API rejected the call (most
                    // often `pages_show_list` needing App Review/Advanced
                    // Access, or this user not being an Admin/Developer/
                    // Tester on this Meta App — see README.md), not that the
                    // user genuinely has zero Pages.
                    <div className={styles.error}>Couldn&apos;t load Pages: {pagesError}</div>
                  ) : (
                    <p className={styles.sub}>No Pages found, or permission not granted.</p>
                  )
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
                  adAccountsError ? (
                    <div className={styles.error}>Couldn&apos;t load Ad Accounts: {adAccountsError}</div>
                  ) : (
                    <p className={styles.sub}>No Ad Accounts found, or permission not granted.</p>
                  )
                ) : (
                  <div style={{ overflowX: "auto" }}>
                    <input
                      type="text"
                      className={styles.select}
                      style={{ width: "100%", maxWidth: 320, marginBottom: 12 }}
                      placeholder="Search accounts…"
                      value={accountQuery}
                      onChange={(e) => setAccountQuery(e.target.value)}
                    />
                    <div style={{ ...GRID, padding: "0 14px 8px", borderBottom: "1px solid var(--border)" }}>
                      <span className={styles.muted}>Account</span>
                      <span className={styles.muted}>Status</span>
                      <span className={styles.muted}>Payment</span>
                      <span className={styles.muted} style={{ textAlign: "right" }}>Spend cap left</span>
                    </div>
                    {data.adAccounts
                      .filter((acc) => !accountQuery.trim() || `${acc.name} ${acc.id}`.toLowerCase().includes(accountQuery.trim().toLowerCase()))
                      .map((acc) => {
                        const b = balances?.[acc.id];
                        const [statusLabel, statusClass] = ACCOUNT_STATUS[acc.account_status] || [`Status ${acc.account_status}`, "badgeInfo"];
                        const payment = (b?.fundingText || "").replace(/\s*\([^)]*\)\s*$/, "") || (balances ? "—" : "");
                        return (
                          <div key={acc.id} style={{ ...GRID, padding: "10px 14px", borderBottom: "1px solid var(--border)" }}>
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontWeight: 600, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{acc.name}</div>
                              <span className={styles.muted} style={{ fontSize: 11 }}>
                                {acc.id.replace(/^act_/, "")} · {acc.currency}
                              </span>
                            </div>
                            <span>
                              <span className={styles[statusClass]}>{statusLabel}</span>
                            </span>
                            <span className={styles.sub} style={{ textTransform: "capitalize" }}>{payment}</span>
                            <div style={{ textAlign: "right" }}>
                              {!balances ? (
                                <span className={styles.muted}>{balancesError ? "Unavailable" : "Loading…"}</span>
                              ) : b?.spendCapRemaining != null ? (
                                <>
                                  <div style={{ fontWeight: 700, fontSize: 14, color: b.spendCapRemaining === 0 ? "var(--red)" : "var(--t1)" }}>
                                    {formatMoney(b.spendCapRemaining, b.currency || acc.currency)}
                                  </div>
                                  <span className={styles.muted} style={{ fontSize: 11 }}>
                                    of {formatMoney(b.spendCap, b.currency || acc.currency)} cap
                                  </span>
                                </>
                              ) : (
                                <span className={styles.muted}>No spend cap</span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                  </div>
                )}
              </div>

              {data.adAccounts.length > 0 && (
                <div className={styles.card}>
                  <h2 className={styles.h2}>Ad Account Performance (Last 30 Days)</h2>
                  <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 16 }}>
                    <AccountSelect accounts={data.adAccounts} value={selectedAccountId} onChange={setSelectedAccountId} style={{ minWidth: 240 }} loading={accountsLoading} />
                    <button className={styles.btnPrimary} onClick={() => checkPerformance(false)} disabled={insightsLoading}>
                      {insightsLoading ? "Checking…" : "Check ROAS"}
                    </button>
                  </div>

                  {insightsFetchedAt && (
                    <CacheStatus
                      label="ROAS"
                      fetchedAt={insightsFetchedAt}
                      loading={insightsLoading}
                      onRefresh={() => checkPerformance(true)}
                    />
                  )}

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
    </Layout>
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
    return new Intl.NumberFormat("en-IN", { style: "currency", currency }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

export async function getServerSideProps(context) {
  const session = await getServerSession(context.req, context.res, authOptions);

  if (!session) {
    return { redirect: { destination: "/", permanent: false } };
  }

  return { props: { user: session.user || null, session: publicSession(session) } };
}
