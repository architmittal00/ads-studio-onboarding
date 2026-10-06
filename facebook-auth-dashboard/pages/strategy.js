import Head from "next/head";
import { getServerSession } from "next-auth/next";
import { useEffect, useState } from "react";
import { authOptions } from "./api/auth/[...nextauth]";
import Layout from "@/components/Layout";
import { recommendStrategies } from "@/lib/strategyEngine";
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

  const hasHistory = accountChoice && accountChoice !== FRESH_ACCOUNT;
  const budgetNumber = parseFloat(dailyBudget);
  const hasBudget = !isNaN(budgetNumber) && budgetNumber > 0;

  const ready = experimentOpen !== null && accountChoice !== "";
  const recommendations = ready ? recommendStrategies({ experimentOpen, hasHistory }) : [];

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
                Used to show each campaign/ad set&apos;s share in real currency — doesn&apos;t change which
                strategy gets recommended.
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
              <h2 className={styles.h2}>Account history</h2>
              <p className={styles.sub} style={{ marginBottom: 10 }}>
                Pick one of the connected ad accounts (used for its retargeting pool of past visitors/purchasers),
                or mark this as a fresh account with no prior data.
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
                    {acc.name} (has history)
                  </option>
                ))}
                <option value={FRESH_ACCOUNT}>Fresh / new account (no prior data)</option>
              </select>
            </div>
          </section>

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
            </section>
          )}
        </main>
      </div>
    </Layout>
  );
}

function StrategyCard({ strategy, rank, budget, currency }) {
  return (
    <div className={styles.card}>
      <div className={styles.sectionRow} style={{ marginBottom: 12 }}>
        <h3 className={styles.h2} style={{ marginBottom: 0 }}>
          Strategy {strategy.id}
        </h3>
        <span className={rank === 0 ? styles.badgeGood : styles.badgeInfo}>
          {rank === 0 ? "Recommended" : "Also consider"}
        </span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {strategy.campaigns.map((c, i) => (
          <div key={i} style={{ borderLeft: "2px solid var(--border)", paddingLeft: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
              <p style={{ fontWeight: 700, fontSize: 13, color: "var(--t1)" }}>{c.name}</p>
              <p style={{ fontWeight: 800, fontSize: 13, color: "var(--purple)" }}>
                {c.pct}%{budget ? ` · ${formatMoney((budget * c.pct) / 100, currency)}/day` : ""}
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
