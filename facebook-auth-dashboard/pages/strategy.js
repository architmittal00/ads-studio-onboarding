import Head from "next/head";
import { getServerSession } from "next-auth/next";
import { useEffect, useState } from "react";
import { authOptions } from "./api/auth/[...nextauth]";
import Layout from "@/components/Layout";
import Loader from "@/components/Loader";
import LaunchPanel from "@/components/LaunchPanel";
import InterestTargetingSection from "@/components/InterestTargetingSection";
import AccountSelect from "@/components/AccountSelect";
import { useAccounts } from "@/components/AccountProvider";
import { getCachedEntry, setCachedEntry } from "@/lib/clientCache";
import {
  STRATEGIES,
  recommendStrategies,
  explainMismatch,
  roundBudgetAmount,
  countInterestAdsets,
} from "@/lib/strategyEngine";
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
  const {
    adAccounts: accounts,
    accountsError,
    selectedAccountId: sharedAccountId,
    setSelectedAccountId: setSharedAccountId,
  } = useAccounts();

  const [dailyBudget, setDailyBudget] = useState("");
  const [currency, setCurrency] = useState("");
  const [experimentOpen, setExperimentOpen] = useState(null);
  const [accountChoice, setAccountChoice] = useState("");
  // Only used when accountChoice === FRESH_ACCOUNT — a fresh/new account has
  // no history to compute a signal from, but launching still needs a real
  // Facebook ad account to create campaigns on. Kept separate from
  // accountChoice (not reused/overloaded) so "which account informs the
  // recommendation" and "which account receives the launch" can differ.
  const [launchAccountChoice, setLaunchAccountChoice] = useState("");
  const [showAllStrategies, setShowAllStrategies] = useState(false);
  const [launchingStrategy, setLaunchingStrategy] = useState(null);

  // Interest targeting choices (Strategy 8 today, or any future
  // interest-based strategy) are made directly on the recommendation card —
  // not inside the Launch pop-up — so they're owned here, keyed by strategy
  // id, and simply read back (not re-collected) once Launch is clicked.
  const [interestChoicesByStrategy, setInterestChoicesByStrategy] = useState({});

  function getInterestChoices(strategy) {
    const count = countInterestAdsets(strategy);
    if (count === 0) return [];
    return interestChoicesByStrategy[strategy.id] || Array.from({ length: count }, () => []);
  }

  function setInterestChoice(strategy, index, values) {
    setInterestChoicesByStrategy((prev) => {
      const current = prev[strategy.id] || Array.from({ length: countInterestAdsets(strategy) }, () => []);
      return { ...prev, [strategy.id]: current.map((c, i) => (i === index ? values : c)) };
    });
  }

  const [historySignal, setHistorySignal] = useState(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState(null);

  // Seeds this page's own account choice from the shared selection (picked
  // on Dashboard/Report/here previously) the first time it's available —
  // the account list itself now comes from the shared AccountProvider
  // (components/AccountProvider.js) instead of this page independently
  // fetching /api/fb/data, fixing a pre-existing bug where this was the one
  // page that never even persisted its own last-chosen account. Only seeds
  // once and only with a real account id — the FRESH_ACCOUNT sentinel is
  // this page's own concept, never written into the shared selection.
  useEffect(() => {
    if (accountChoice || !sharedAccountId) return;
    const acc = accounts.find((a) => a.id === sharedAccountId);
    if (!acc) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time seed from shared context state, not a derived-state anti-pattern
    setAccountChoice(sharedAccountId);
    if (acc.currency) setCurrency(acc.currency);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- accountChoice intentionally excluded, see guard above
  }, [sharedAccountId, accounts]);

  function handleAccountChoice(id) {
    setAccountChoice(id);
    if (id !== FRESH_ACCOUNT) {
      const acc = accounts.find((a) => a.id === id);
      if (acc?.currency) setCurrency(acc.currency);
      // Keeps the cross-tab selection in sync — picking a real account here
      // shows it already selected on Dashboard/Report too. Picking "fresh"
      // deliberately does NOT touch the shared selection (see above).
      setSharedAccountId(id);
    }
  }

  const budgetNumber = parseFloat(dailyBudget);
  const hasBudget = !isNaN(budgetNumber) && budgetNumber > 0;
  const isRealAccount = accountChoice && accountChoice !== FRESH_ACCOUNT;

  // The account a strategy actually launches to — always a real ad account,
  // never the FRESH_ACCOUNT sentinel. For a real accountChoice this is just
  // that account; for a fresh/new one it's whatever the user separately
  // picks below, since Facebook has no concept of launching a campaign to a
  // non-existent account.
  const launchAccountId = isRealAccount ? accountChoice : launchAccountChoice;

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

    // Seen this exact account+budget within the last 30 minutes — skip the
    // fetch (and its debounce) entirely, same shared cache as every other
    // page (lib/clientCache.js).
    const cacheKey = `strategy-signal:${accountChoice}:${budgetNumber}`;
    const cached = getCachedEntry(cacheKey);
    if (cached) {
      setHistorySignal(cached.data);
      setHistoryError(null);
      setHistoryLoading(false);
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
          else {
            setHistorySignal(json);
            setCachedEntry(cacheKey, json);
          }
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
            agency&apos;s playbook — and you can launch it straight to the ad account from here.
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
              <AccountSelect
                accounts={accounts}
                extraOptions={[{ id: FRESH_ACCOUNT, name: "Fresh / new account (no prior data)" }]}
                value={accountChoice}
                onChange={handleAccountChoice}
                style={{ width: "100%", maxWidth: 420 }}
              />

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

              {accountChoice === FRESH_ACCOUNT && (
                <div style={{ marginTop: 12 }}>
                  <p className={styles.sub} style={{ marginBottom: 10 }}>
                    A fresh account has nothing to compute a recommendation from, but launching still needs a real
                    ad account to create campaigns on — pick which one this strategy should actually launch to.
                  </p>
                  <AccountSelect
                    accounts={accounts}
                    value={launchAccountChoice}
                    onChange={setLaunchAccountChoice}
                    placeholder="Select an account to launch to…"
                    style={{ width: "100%", maxWidth: 420 }}
                  />
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
                recommendations.map((strategy, i) => {
                  const interestChoices = getInterestChoices(strategy);
                  const allInterestsChosen = interestChoices.length === 0 || interestChoices.every((g) => g.length > 0);
                  return (
                    <StrategyCard
                      key={strategy.id}
                      strategy={strategy}
                      rank={i}
                      budget={hasBudget ? budgetNumber : null}
                      currency={currency}
                      canLaunch={!!launchAccountId && allInterestsChosen}
                      onLaunch={() => setLaunchingStrategy(strategy)}
                      accountId={launchAccountId}
                      hasHistory={hasHistory}
                      interestChoices={interestChoices}
                      setInterestChoice={(index, values) => setInterestChoice(strategy, index, values)}
                    />
                  );
                })
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
      {launchingStrategy && (
        <LaunchPanel
          strategy={launchingStrategy}
          accountId={launchAccountId}
          dailyBudget={budgetNumber}
          interestChoices={getInterestChoices(launchingStrategy)}
          onClose={() => setLaunchingStrategy(null)}
        />
      )}
    </Layout>
  );
}

function StrategyCard({
  strategy,
  rank,
  budget,
  currency,
  mismatchReason,
  canLaunch,
  onLaunch,
  accountId,
  hasHistory,
  interestChoices,
  setInterestChoice,
}) {
  const notRecommended = mismatchReason !== undefined;
  // Interest targeting (Strategy 8 today) is searched/chosen right here on
  // the recommendation card — not inside the Launch pop-up — so only a
  // launchable (recommended) card wires it up at all; the collapsed "other
  // strategies" list below has no Launch button and stays plain text.
  const showInterestPicker = !notRecommended && interestChoices;

  // An id that shows up in more than one ad set's group, counted once per
  // group it appears in — computed across the whole strategy (not just one
  // campaign's slice) since a future strategy could spread interest ad sets
  // across more than one campaign.
  const duplicateInterestIds = showInterestPicker
    ? (() => {
        const adsetCountById = new Map();
        for (const group of interestChoices) {
          for (const id of new Set(group.map((c) => c.id))) {
            adsetCountById.set(id, (adsetCountById.get(id) || 0) + 1);
          }
        }
        return [...adsetCountById.entries()].filter(([, count]) => count > 1).map(([id]) => id);
      })()
    : [];

  // Flat per-campaign offset into interestChoices, computed up front (no
  // mutation during render) — must match pages/api/fb/launch-strategy.js's
  // own flat interestChoiceIndex ordering (all interest ad sets across the
  // whole strategy, in campaign order), so a group picked here lands on the
  // right ad set at launch time.
  const interestStartByCampaign = strategy.campaigns.reduce((acc, c) => {
    const prevTotal = acc.length > 0 ? acc[acc.length - 1].total : 0;
    const count = c.adsets.filter((a) => a.type === "interest").length;
    acc.push({ start: prevTotal, total: prevTotal + count });
    return acc;
  }, []);

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
        {strategy.campaigns.map((c, i) => {
          const interestAdsets = c.adsets.filter((a) => a.type === "interest");
          const otherAdsets = c.adsets.filter((a) => a.type !== "interest");
          const startIndex = interestStartByCampaign[i].start;

          return (
            <div key={i} style={{ borderLeft: "2px solid var(--border)", paddingLeft: 14 }}>
              <div
                style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}
              >
                <p style={{ fontWeight: 700, fontSize: 13, color: "var(--t1)" }}>{c.name}</p>
                <p style={{ fontWeight: 800, fontSize: 13, color: "var(--purple)" }}>
                  {c.pct}%
                  {budget ? ` · ${formatMoney(roundBudgetAmount((budget * c.pct) / 100, budget), currency)}/day` : ""}
                </p>
              </div>
              <p className={styles.sub}>{c.structure}</p>

              {otherAdsets.length > 0 &&
                (otherAdsets.length === 1 && interestAdsets.length === 0 ? (
                  <p className={styles.sub}>{otherAdsets[0].label}</p>
                ) : (
                  <ul className={styles.list} style={{ marginTop: 8 }}>
                    {otherAdsets.map((a, j) => (
                      <li key={j} className={styles.listItem} style={{ fontWeight: 500 }}>
                        {a.label}
                      </li>
                    ))}
                  </ul>
                ))}

              {interestAdsets.length > 0 && (
                <div style={{ marginTop: 10 }}>
                  {!showInterestPicker ? (
                    <ul className={styles.list} style={{ marginTop: 8 }}>
                      {interestAdsets.map((a, j) => (
                        <li key={j} className={styles.listItem} style={{ fontWeight: 500 }}>
                          {a.label}
                        </li>
                      ))}
                    </ul>
                  ) : accountId ? (
                    <InterestTargetingSection
                      accountId={accountId}
                      hasHistory={hasHistory}
                      interestChoices={interestChoices.slice(startIndex, startIndex + interestAdsets.length)}
                      setInterestChoice={(localIndex, values) => setInterestChoice(startIndex + localIndex, values)}
                      duplicateInterestIds={duplicateInterestIds}
                    />
                  ) : (
                    <p className={styles.sub}>Pick an account to launch to above to choose interest targeting.</p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {!notRecommended && (
        <button
          type="button"
          className={styles.btnPrimary}
          style={{ marginTop: 16 }}
          onClick={onLaunch}
          disabled={!canLaunch}
          title={
            canLaunch
              ? undefined
              : accountId
              ? "Choose an interest for every ad set above to launch"
              : "Pick a connected ad account above to launch (not available for a fresh/new account)"
          }
        >
          Launch Strategy {strategy.id}
        </button>
      )}
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
