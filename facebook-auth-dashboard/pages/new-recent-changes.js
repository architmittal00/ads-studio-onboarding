import Head from "next/head";
import { getServerSession } from "next-auth/next";
import { useEffect, useMemo, useState } from "react";
import { authOptions } from "./api/auth/[...nextauth]";
import Layout from "@/components/Layout";
import Loader from "@/components/Loader";
import AccountSelect from "@/components/AccountSelect";
import EntityChangesDrawer from "@/components/EntityChangesDrawer";
import { ChevronIcon } from "@/components/icons";
import { useAccounts } from "@/components/AccountProvider";
import { getCachedEntry, setCachedEntry } from "@/lib/clientCache";
import { getNewRecentChangesQuery, setNewRecentChangesQuery } from "@/lib/clientStorage";
import styles from "@/styles/Home.module.css";

const CACHE_PREFIX = "new-recent-changes:";
const CACHE_MAX_ENTRIES = 50;

// Only these two — a deliberate, much narrower choice than the original
// Recent Changes page's four-preset picker (24h/72h/7d/30d), per the
// explicit ask for this page.
const HOURS_PRESETS = [
  { value: 72, label: "Last 72 Hours" },
  { value: 168, label: "Last 7 Days" },
];

const LEVEL_LABEL = { campaign: "Campaign", adset: "Ad Set" };
const LEVEL_BADGE_CLASS = { campaign: styles.badgeInfo, adset: styles.badgeGood };

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

// One row on the landing list — just enough to tell there's something worth
// opening ("some change took place at each level," per the original ask),
// not the changes themselves; those live behind EntityChangesDrawer.
function EntityRow({ entity, onOpen }) {
  const levelLabel = LEVEL_LABEL[entity.level] || entity.level;
  return (
    <button
      type="button"
      onClick={() => onOpen(entity)}
      className={styles.card}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        width: "100%",
        textAlign: "left",
        cursor: "pointer",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
        <span className={LEVEL_BADGE_CLASS[entity.level] || styles.badgeInfo}>{levelLabel}</span>
        <p style={{ margin: 0, fontWeight: 600, fontSize: 13.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {entity.entityName || entity.entityId}
        </p>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
        <span className={styles.muted} style={{ fontSize: 12 }}>
          {entity.changeCount} change{entity.changeCount === 1 ? "" : "s"} · last {relativeTime(entity.lastChangeTime)}
        </span>
        <ChevronIcon direction="right" size={13} />
      </div>
    </button>
  );
}

// A narrower, pre-grouped, differently-designed sibling of
// pages/recent-changes.js (which stays exactly as-is): one account, one of
// two time windows, and only six tracked actions (Ad launched/paused, Ad
// Set budget change/paused, Campaign budget change/paused) — rolled up one
// level per pages/api/fb/new-recent-changes.js's own bucketing (an ad's own
// activity and its ad set's own budget change both read as "this ad set";
// an ad set being paused and a campaign's own budget/pause both read as
// "this campaign"). No multi-tab system here — deliberately simpler than
// Explore/Recent Changes' saved-views model, per the ask for "a bit
// different" design.
export default function NewRecentChanges() {
  const { adAccounts, accountsError, selectedAccountId, setSelectedAccountId } = useAccounts();
  const [hours, setHours] = useState(() => getNewRecentChangesQuery()?.hours || 72);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [openEntity, setOpenEntity] = useState(null);

  useEffect(() => {
    setNewRecentChangesQuery({ hours });
  }, [hours]);

  const currency = useMemo(() => adAccounts.find((a) => a.id === selectedAccountId)?.currency, [adAccounts, selectedAccountId]);
  const runnable = !!selectedAccountId;

  function runQuery(force) {
    if (!selectedAccountId) return;
    const cacheKey = `${CACHE_PREFIX}${JSON.stringify({ accountId: selectedAccountId, hours })}`;
    if (!force) {
      const cached = getCachedEntry(cacheKey);
      if (cached) {
        setResult(cached.data);
        setError(null);
        return;
      }
    }
    setLoading(true);
    setError(null);
    fetch(`/api/fb/new-recent-changes?accountId=${encodeURIComponent(selectedAccountId)}&hours=${hours}`)
      .then((res) => res.json())
      .then((json) => {
        if (json.error) {
          setError(json.error);
          return;
        }
        setResult(json);
        setCachedEntry(cacheKey, json, { prefix: CACHE_PREFIX, maxEntriesForPrefix: CACHE_MAX_ENTRIES });
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  // Re-opens the same entity from the freshly-fetched `result` (not the
  // stale object the drawer was first opened with) whenever a query re-runs
  // while the drawer is open, so its day list reflects the new data instead
  // of silently going stale underneath an still-open drawer.
  useEffect(() => {
    if (!openEntity || !result) return;
    const fresh = result.entities.find((e) => e.level === openEntity.level && e.entityId === openEntity.entityId);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- re-syncing an already-open drawer to a just-refreshed result, not derivable from render
    setOpenEntity(fresh || null);
    // Only `result` should re-trigger this — re-running on every render of
    // `openEntity` itself would re-derive the identical object forever.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  return (
    <Layout>
      <Head>
        <title>New Recent Changes · Facebook Auth Dashboard</title>
      </Head>
      <div className={styles.page}>
        <main className={styles.main} style={{ maxWidth: 900, margin: "0 auto" }}>
          <h1 className={styles.h1}>New Recent Changes</h1>
          <p className={styles.sub} style={{ marginTop: -8, marginBottom: 20 }}>
            Pick an account and a time window to see which Campaigns and Ad Sets had activity — Ads launched or
            paused, and budget or pause changes. Open one to see what changed, grouped by day, with an option to
            investigate any day&apos;s performance impact.
          </p>

          {accountsError && <div className={styles.error}>Error loading ad accounts: {accountsError}</div>}

          <div className={styles.card} style={{ display: "flex", flexDirection: "column", gap: 16, marginBottom: 20 }}>
            <div>
              <h2 className={styles.h2}>Account</h2>
              <AccountSelect
                accounts={adAccounts}
                value={selectedAccountId}
                onChange={setSelectedAccountId}
                placeholder="Select an ad account…"
                style={{ width: "100%", maxWidth: 420 }}
              />
            </div>

            <div>
              <h2 className={styles.h2}>Time Window</h2>
              <div className={styles.tabGroup}>
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
            </div>

            <button type="button" className={styles.btnPrimary} onClick={() => runQuery(false)} disabled={!runnable || loading} style={{ alignSelf: "flex-start" }}>
              {loading ? "Loading…" : "Check Changes"}
            </button>
          </div>

          {loading && <Loader label="Checking recent changes…" />}
          {error && <div className={styles.error}>{error}</div>}

          {!loading && !error && result && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <p className={styles.sub} style={{ margin: 0 }}>
                  {result.entities.length} {result.entities.length === 1 ? "entity" : "entities"} with tracked changes
                </p>
                <button type="button" className={styles.btnSecondary} onClick={() => runQuery(true)}>
                  Hard Refresh
                </button>
              </div>
              {result.entities.length === 0 && (
                <p className={styles.sub}>No tracked changes (Ad launches/pauses, budget changes, Ad Set/Campaign pauses) in this window.</p>
              )}
              {result.entities.map((entity) => (
                <EntityRow key={`${entity.level}:${entity.entityId}`} entity={entity} onOpen={setOpenEntity} />
              ))}
            </div>
          )}
        </main>
      </div>

      <EntityChangesDrawer entity={openEntity} onClose={() => setOpenEntity(null)} currency={currency} />
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
