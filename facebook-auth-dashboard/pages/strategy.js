import Head from "next/head";
import { getServerSession } from "next-auth/next";
import { useEffect, useState } from "react";
import { authOptions } from "./api/auth/[...nextauth]";
import Layout from "@/components/Layout";
import Loader from "@/components/Loader";
import { STRATEGIES, recommendStrategies, explainMismatch, roundBudgetAmount } from "@/lib/strategyEngine";
import styles from "@/styles/Home.module.css";

const FRESH_ACCOUNT = "__fresh__";

function formatMoney(amount, currency) {
  if (!currency) return amount.toFixed(0);
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${amount.toFixed(0)} ${currency}`;
  }
}

export default function Strategy() {
  const [accounts, setAccounts] = useState([]);
  const [accountsError, setAccountsError] = useState(null);

  const [dailyBudget, setDailyBudget] = useState("");
  const [currency, setCurrency] = useState("");
  const [experimentOpen, setExperimentOpen] = useState(null);
  const [accountChoice, setAccountChoice] = useState("");
  const [showAllStrategies, setShowAllStrategies] = useState(false);

  const [historySignal, setHistorySignal] = useState(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState(null);

  useEffect(() => {
    fetch("/api/fb/data")
      .then((res) => res.json())
      .then((json) => {
        if (json.error) setAccountsError(json.error);
        else setAccounts(json.adAccounts || []);
      })
      .catch((err) => setAccountsError(err.message));
  }, []);

  function handleAccountChoice(id) {
    setAccountChoice(id);
    if (id !== FRESH_ACCOUNT) {
      const acc = accounts.find((a) => a.id === id);
      if (acc?.currency) setCurrency(acc.currency);
    }
  }

  const budgetNumber = parseFloat(dailyBudget);
  const hasBudget = !isNaN(budgetNumber) && budgetNumber > 0;
  const isRealAccount = accountChoice && accountChoice !== FRESH_ACCOUNT;

  // Whether a connected account has "enough history" to justify a
  // retargeting-led strategy isn't something the user declares — it's
  // calculated from the account's own last-30-day numbers (see
  // /api/fb/strategy-signal). A fresh/new account has nothing to calculate
  // from, so it's false immediately with no fetch needed.
  useEffect(() => {
    if (!isRealAccount || !hasBudget) {
      // Standard fetch-on-param-change pattern, same as the report page's
      // date-range effect — resetting state synchronously when the guard
      // condition isn't met is intentional, not a sync-derived-state bug.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setHistorySignal(null);
      setHistoryError(null);
      return;
    }

    let ignore = false;
    setHistoryLoading(true);
    setHistoryError(null);

    // Light debounce — typing a budget fires this on every keystroke
    // otherwise, each one a real Graph API call.
    const timer = setTimeout(() => {
      fetch(
        `/api/fb/strategy-signal?accountId=${encodeURIComponent(accountChoice)}&dailyBudget=${budgetNumber}`
      )
        .then((res) => res.json())
        .then((json) => {
          if (ignore) return;
          if (json.error) setHistoryError(json.error);
          else setHistorySignal(json);
        })
        .catch((err) => {
          if (!ignore) setHistoryError(err.message);
        })
        .finally(() => {
          if (!ignore) setHistoryLoading(false);
        });
    }, 500);

    return () => {
      ignore = true;
      clearTimeout(timer);
      setHistoryLoading(false);
    };
  }, [isRealAccount, accountChoice, hasBudget, budgetNumber]);

  const hasHistory = isRealAccount ? historySignal?.hasEnoughHistory ?? false : false;

  const ready =
    experimentOpen !== null &&
    accountChoice !== "" &&
    hasBudget &&
    !historyLoading &&
    (accountChoice === FRESH_ACCOUNT || historySignal !== null || historyError !== null);

  const inputs = { experimentOpen, hasHistory };
  const recommendations = ready ? recommendStrategies(inputs) : [];
  const recommendedIds = new Set(recommendations.map((s) => s.id));
  const otherStrategies = ready ? STRATEGIES.filter((s) => !recommendedIds.has(s.id)) : [];

  return (
    <Layout>
      <Head>
        <title>Figure Out Strategy · Facebook Auth Dashboard</title>
      </Head>
      <div className={styles.page}>
        <main className={styles.main} style={{ maxWidth: 820, margin: "0 auto" }}>
          <h1 className={styles.h1}>Figure Out Strategy</h1>
          <p className={styles.sub} style={{ marginTop: -8 }}>
            Answer a few questions about the account and we&apos;ll recommend a campaign structure from the
            agency&apos;s playbook. For now this just recommends — launching the campaigns/ad sets directly from
            here is coming later.
          </p>

          {accountsError && <div className={styles.error}>Error loading ad accounts: {accountsError}</div>}

          <section className={styles.card} style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <div>
              <h2 className={styles.h2}>Daily budget</h2>
              <p className={styles.sub} style={{ marginBottom: 10 }}>
                Shows each campaign/ad set&apos;s share in real currency, and — for a connected account — is used to
                check whether it has enough of a retargeting pool to build a strategy around (see below).
                Recommendations wait until this is filled in.
              </p>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  type="number"
                  min="0"
                  className={styles.select}
                  style={{ width: 160 }}
                  placeholder="e.g. 5000"
                  value={dailyBudget}
                  onChange={(e) => setDailyBudget(e.target.value)}
                />
                <input
                  type="text"
                  className={styles.select}
                  style={{ width: 90 }}
                  placeholder="INR"
                  maxLength={3}
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                />
              </div>
            </div>

            <div>
              <h2 className={styles.h2}>Is the owner comfortable experimenting?</h2>
              <p className={styles.sub} style={{ marginBottom: 10 }}>
                Or do they want to stay focused on Bottom-of-Funnel only?
              </p>
              <div className={styles.tabGroup}>
                <button
                  className={experimentOpen === true ? `${styles.tab} ${styles.tabActive}` : styles.tab}
                  onClick={() => setExperimentOpen(true)}
                >
                  Open to experimenting (TOF/MOF/BOF)
                </button>
                <button
                  className={experimentOpen === false ? `${styles.tab} ${styles.tabActive}` : styles.tab}
                  onClick={() => setExperimentOpen(false)}
                >
                  Wants BOF only
                </button>
              </div>
            </div>

            <div>
              <h2 className={styles.h2}>Account</h2>
              <p className={styles.sub} style={{ marginBottom: 10 }}>
                Pick a connected ad account — we&apos;ll check its last 30 days of activity to see if it has a
                retargeting pool worth building a strategy around. Or mark this as a fresh/new account with no
                prior data.
              </p>
              <select
                className={styles.select}
                style={{ width: "100%", maxWidth: 420 }}
                value={accountChoice}
                onChange={(e) => handleAccountChoice(e.target.value)}
              >
                <option value="" disabled>
                  Select an account…
                </option>
                {accounts.map((acc) => (
                  <option key={acc.id} value={acc.id}>
                    {acc.name}
                  </option>
                ))}
                <option value={FRESH_ACCOUNT}>Fresh / new account (no prior data)</option>
              </select>

              {isRealAccount && hasBudget && (
                <div style={{ marginTop: 12 }}>
                  {historyLoading && <Loader inline label="Checking the account's last 30 days…" />}
                  {historyError && (
                    <p className={styles.sub} style={{ color: "#ff7070" }}>
                      Couldn&apos;t check this account&apos;s history ({historyError}) — treating it as a fresh
                      account for now.
                    </p>
                  )}
                  {!historyLoading && historySignal && (
                    <p className={styles.sub}>
                      <strong style={{ color: "var(--t1)" }}>
                        {historySignal.hasEnoughHistory ? "Has enough history." : "Not enough history yet."}
                      </strong>{" "}
                      {historySignal.reason}
                    </p>
                  )}
                </div>
              )}
            </div>
          </section>

          {!ready && experimentOpen !== null && accountChoice !== "" && !hasBudget && (
            <p className={styles.sub}>Enter a daily budget above to see recommended strategies.</p>
          )}

          {ready && (
            <section style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <h2 className={styles.h2} style={{ marginBottom: -8 }}>
                Recommended {recommendations.length > 1 ? "strategies" : "strategy"}
              </h2>
              {recommendations.length === 0 ? (
                <p className={styles.sub}>No matching strategy — this shouldn&apos;t happen; check the inputs above.</p>
              ) : (
                recommendations.map((strategy, i) => (
                  <StrategyCard
                    key={strategy.id}
                    strategy={strategy}
                    rank={i}
                    budget={hasBudget ? budgetNumber : null}
                    currency={currency}
                  />
                ))
              )}

              <button
                type="button"
                className={styles.btnSecondary}
                style={{ alignSelf: "flex-start" }}
                onClick={() => setShowAllStrategies((v) => !v)}
              >
                {showAllStrategies ? "Hide" : "See"} the other {otherStrategies.length} strategies
              </button>

              {showAllStrategies && (
                <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                  {otherStrategies.map((strategy) => (
                    <StrategyCard
                      key={strategy.id}
                      strategy={strategy}
                      budget={hasBudget ? budgetNumber : null}
                      currency={currency}
                      mismatchReason={explainMismatch(strategy, inputs)}
                    />
                  ))}
                </div>
              )}
            </section>
          )}
        </main>
      </div>
    </Layout>
  );
}

function StrategyCard({ strategy, rank, budget, currency, mismatchReason }) {
  const notRecommended = mismatchReason !== undefined;

  return (
    <div className={styles.card} style={notRecommended ? { opacity: 0.8 } : undefined}>
      <div className={styles.sectionRow} style={{ marginBottom: 12 }}>
        <h3 className={styles.h2} style={{ marginBottom: 0 }}>
          Strategy {strategy.id}
        </h3>
        {notRecommended ? (
          <span className={styles.muted}>Not recommended here</span>
        ) : (
          <span className={rank === 0 ? styles.badgeGood : styles.badgeInfo}>
            {rank === 0 ? "Recommended" : "Also consider"}
          </span>
        )}
      </div>

      <p className={styles.sub} style={{ marginBottom: 14 }}>
        {notRecommended ? mismatchReason || "Doesn't match the current inputs." : strategy.rationale}
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {strategy.campaigns.map((c, i) => (
          <div key={i} style={{ borderLeft: "2px solid var(--border)", paddingLeft: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
              <p style={{ fontWeight: 700, fontSize: 13, color: "var(--t1)" }}>{c.name}</p>
              <p style={{ fontWeight: 800, fontSize: 13, color: "var(--purple)" }}>
                {c.pct}%
                {budget ? ` · ${formatMoney(roundBudgetAmount((budget * c.pct) / 100, budget), currency)}/day` : ""}
              </p>
            </div>
            <p className={styles.sub}>{c.structure}</p>
            {c.note && <p className={styles.sub}>{c.note}</p>}
            {c.adsets && (
              <ul className={styles.list} style={{ marginTop: 8 }}>
                {c.adsets.map((a, j) => (
                  <li key={j} className={styles.listItem} style={{ fontWeight: 500 }}>
                    {a}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
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
