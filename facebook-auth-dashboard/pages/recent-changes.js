import Head from "next/head";
import { getServerSession } from "next-auth/next";
import { useMemo, useState } from "react";
import { authOptions } from "./api/auth/[...nextauth]";
import Layout from "@/components/Layout";
import Loader from "@/components/Loader";
import CacheStatus from "@/components/CacheStatus";
import AccountSelect from "@/components/AccountSelect";
import InvestigateDrawer from "@/components/InvestigateDrawer";
import { useAccounts } from "@/components/AccountProvider";
import { getCachedEntry, setCachedEntry } from "@/lib/clientCache";
import styles from "@/styles/Home.module.css";

const CACHE_PREFIX = "recent-changes:";
const HOURS_PRESETS = [
  { value: 24, label: "Last 24 Hours" },
  { value: 72, label: "Last 72 Hours" },
  { value: 168, label: "Last 7 Days" },
  { value: 720, label: "Last 30 Days" },
];
// Matches pages/api/fb/recent-changes.js's own MAX_IMPACT_CHANGES — just for
// the truncation notice's wording, not sent in any request.
const MAX_IMPACT_CHANGES = 30;

// Compact up/down signal for one metric — replaces the old spelled-out
// "Spend: ₹X → ₹Y [badge]" line with a single scannable chip (e.g.
// "Spend ▲73%"), reusing the existing badgeGood/badgeDanger pill treatment
// instead of inventing new color CSS. The full before/after numbers live in
// the Investigate modal instead of cluttering every row.
function QuickSignal({ label, before, after }) {
  if (typeof before !== "number" || typeof after !== "number") return null;
  if (before === 0 && after === 0) return null;
  const pct = before !== 0 ? ((after - before) / Math.abs(before)) * 100 : 100;
  const badgeClass = pct > 0 ? styles.badgeGood : pct < 0 ? styles.badgeDanger : styles.badgeInfo;
  const arrow = pct > 0 ? "▲" : pct < 0 ? "▼" : "";
  return (
    <span className={badgeClass}>
      {label} {arrow} {Math.abs(pct).toFixed(0)}%
    </span>
  );
}

const CATEGORY_BADGE = {
  budget: "badgeWarn",
  status: "badgeInfo",
  created: "badgeGood",
  name: "badgeInfo",
  other: "badgeInfo",
};

function relativeTime(iso) {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.round(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export default function RecentChanges() {
  const { adAccounts, accountsError } = useAccounts();

  const [accountIds, setAccountIds] = useState([]);
  const [hours, setHours] = useState(72);
  const [result, setResult] = useState(null);
  const [fetchedAt, setFetchedAt] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [investigatingChange, setInvestigatingChange] = useState(null);

  const runnable = accountIds.length > 0;

  function run(force) {
    if (!runnable) return;
    const sortedIds = [...accountIds].sort();
    const cacheKey = CACHE_PREFIX + JSON.stringify({ accountIds: sortedIds, hours });

    if (!force) {
      const cached = getCachedEntry(cacheKey);
      if (cached) {
        setResult(cached.data);
        setFetchedAt(cached.fetchedAt);
        setError(null);
        return;
      }
    }

    setLoading(true);
    setError(null);
    fetch(`/api/fb/recent-changes?accountIds=${sortedIds.join(",")}&hours=${hours}`)
      .then((res) => res.json())
      .then((json) => {
        if (json.error) {
          setError(json.error);
          return;
        }
        setResult(json);
        setFetchedAt(Date.now());
        setCachedEntry(cacheKey, json);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  const accountName = (id) => adAccounts.find((a) => a.id === id)?.name || id;
  const currencyByAccountId = useMemo(() => new Map(adAccounts.map((a) => [a.id, a.currency])), [adAccounts]);

  return (
    <Layout>
      <Head>
        <title>Recent Changes · Facebook Auth Dashboard</title>
      </Head>
      <div className={styles.page}>
        <main className={styles.main} style={{ maxWidth: 1100, margin: "0 auto" }}>
          <h1 className={styles.h1}>Recent Changes</h1>
          <p className={styles.sub} style={{ marginBottom: 20 }}>
            Campaign and ad set changes — budget updates, launches, status changes — pulled from Facebook&apos;s own
            Activity Log, so it reflects what changed no matter which tool made the change.
          </p>

          {accountsError && <p className={styles.sub} style={{ color: "var(--red)" }}>{accountsError}</p>}

          <div className={styles.card} style={{ marginBottom: 20 }}>
            <h2 className={styles.h2}>Accounts</h2>
            <AccountSelect
              accounts={adAccounts}
              multiple
              values={accountIds}
              onChange={setAccountIds}
              maxSelected={10}
              placeholder="Select one or more accounts…"
              style={{ marginBottom: 16, maxWidth: 500 }}
            />

            <h2 className={styles.h2}>Time Window</h2>
            <div className={styles.tabGroup} style={{ marginBottom: 16 }}>
              {HOURS_PRESETS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  className={hours === p.value ? `${styles.tab} ${styles.tabActive}` : styles.tab}
                  onClick={() => setHours(p.value)}
                >
                  {p.label}
                </button>
              ))}
            </div>

            <button type="button" className={styles.btnPrimary} onClick={() => run(false)} disabled={!runnable || loading}>
              {loading ? "Loading…" : "Check Recent Changes"}
            </button>
          </div>

          {error && (
            <div className={styles.error} style={{ marginBottom: 16 }}>
              {error}
            </div>
          )}

          {fetchedAt && (
            <div style={{ marginBottom: 16 }}>
              <CacheStatus label="Changes" fetchedAt={fetchedAt} loading={loading} onRefresh={() => run(true)} />
            </div>
          )}

          {loading && !result && <Loader label="Checking Activity Log…" />}

          {result && result.changes.length === 0 && (
            <p className={styles.sub}>
              No campaign or ad set changes in the selected account{accountIds.length > 1 ? "s" : ""} over the{" "}
              {HOURS_PRESETS.find((p) => p.value === hours)?.label.toLowerCase()}.
            </p>
          )}

          {result && result.meta.accountErrors.length > 0 && (
            <p className={styles.sub} style={{ color: "var(--red)", marginBottom: 12 }}>
              Couldn&apos;t check:{" "}
              {result.meta.accountErrors.map((e) => `${accountName(e.accountId)} (${e.message})`).join(", ")}
            </p>
          )}

          {result && result.meta.truncated && (
            <p className={styles.sub} style={{ marginBottom: 12 }}>
              Showing performance impact for the {MAX_IMPACT_CHANGES} most recent changes only.
            </p>
          )}

          {result && result.changes.length > 0 && (
            <div className={styles.card} style={{ padding: 0, overflow: "hidden" }}>
              {result.changes.map((c) => (
                <div
                  key={c.id}
                  style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)" }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
                    <span className={styles[CATEGORY_BADGE[c.category]] || styles.badgeInfo}>{c.categoryLabel}</span>
                    <span className={styles.badgeInfo}>{c.level}</span>
                    <strong style={{ fontSize: 13 }}>{c.objectName || c.objectId}</strong>
                    <span className={styles.muted}>· {accountName(c.accountId)}</span>
                    <span className={styles.muted} style={{ marginLeft: "auto" }} title={c.eventTime ? new Date(c.eventTime).toLocaleString() : undefined}>
                      {relativeTime(c.eventTime)}
                    </span>
                  </div>
                  <p className={styles.sub} style={{ marginBottom: 6 }}>
                    {c.description}
                  </p>

                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span className={styles.muted}>By {c.actorName}</span>
                    {c.tooRecent && <span className={styles.muted}>· Too recent to measure</span>}
                    {!c.tooRecent && c.impact && (
                      <>
                        <QuickSignal label="Spend" before={c.impact.before?.spend} after={c.impact.after?.spend} />
                        <QuickSignal label="Purchases" before={c.impact.before?.purchases} after={c.impact.after?.purchases} />
                        <QuickSignal label="ROAS" before={c.impact.before?.roas} after={c.impact.after?.roas} />
                      </>
                    )}
                    <button
                      type="button"
                      className={styles.btnSecondary}
                      style={{ padding: "4px 10px", fontSize: 11, marginLeft: "auto" }}
                      onClick={() => setInvestigatingChange(c)}
                    >
                      Investigate
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </main>
      </div>

      <InvestigateDrawer
        change={investigatingChange}
        onClose={() => setInvestigatingChange(null)}
        currency={investigatingChange ? currencyByAccountId.get(investigatingChange.accountId) : undefined}
      />
    </Layout>
  );
}

export async function getServerSideProps(context) {
  const session = await getServerSession(context.req, context.res, authOptions);

  if (!session) {
    return { redirect: { destination: "/", permanent: false } };
  }

  return { props: {} };
}
