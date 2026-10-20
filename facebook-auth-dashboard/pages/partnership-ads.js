import Head from "next/head";
import Link from "next/link";
import { getServerSession } from "next-auth/next";
import { useEffect, useMemo, useState } from "react";
import { authOptions } from "./api/auth/[...nextauth]";
import Layout from "@/components/Layout";
import PinLock from "@/components/PinLock";
import AccountSelect from "@/components/AccountSelect";
import DateRangeMenu from "@/components/DateRangeMenu";
import { useAccounts } from "@/components/AccountProvider";
import OverviewTab from "@/components/partnership/OverviewTab";
import ExploreTab from "@/components/partnership/ExploreTab";
import RequestsTab from "@/components/partnership/RequestsTab";
import MyAdsTab from "@/components/partnership/MyAdsTab";
import CreatorHubTab from "@/components/partnership/CreatorHubTab";
import PartnershipCodeTab from "@/components/partnership/PartnershipCodeTab";
import { getPartnershipQueue } from "@/lib/clientStorage";
import { getCachedEntry, setCachedEntry } from "@/lib/clientCache";
import { computeRange } from "@/lib/dateRanges";
import { fetchWithTimeout, parseJsonResponse } from "@/lib/fetchJson";
import styles from "@/styles/Home.module.css";

// Same cap Copy Ads uses, same reasoning: Overview/My Partnership Ads/
// Creator Hub's own data pulls are all bounded by an /insights-first ad-id
// discovery (see lib/partnershipDetection.js) rather than walking the
// account's full ad history — a generous but real ceiling keeps that
// discovery query itself cheap.
const PERFORMANCE_TABS = ["overview", "mine", "creators"];
const MAX_RANGE_DAYS = 90;
// Short on purpose — long enough that switching Overview → My Partnership
// Ads → Creator Hub (or re-opening the page a minute later) never re-fires
// the underlying Graph calls, short enough that "Reload" still means
// something if the user genuinely wants fresher numbers. Matches
// lib/clientCache.js's own per-entry TTL override (its 30-minute default is
// for data that doesn't change minute to minute, like the account list —
// ad performance during an active campaign can, so this stays much shorter).
const PERFORMANCE_CACHE_TTL_MS = 5 * 60 * 1000;

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "mine", label: "My Partnership Ads" },
  { key: "creators", label: "Creator Hub" },
  { key: "explore", label: "Explore Ads" },
  { key: "requests", label: "My Requests" },
  { key: "code", label: "Partnership Code" },
];

// Partnership Ads (branded content ads): browse a Business's partner-
// eligible Instagram content, request branded-content permission from
// creators, and launch real ads built from that content. One page, 6
// sub-nav tabs as internal view state — they share the account/IG-account
// selection above them, same reasoning as every other multi-tab page in
// this app (Recent Changes, Explore) for why this isn't 6 separate routes.
// Still being built out incrementally (see PROJECT_STATUS.md) — tabs beyond
// Overview/Explore Ads are placeholders until their own round ships.
//
// Overview/My Partnership Ads/Creator Hub are the exception to "every tab
// needs both selections": they're all just different views over the same
// ad-account-level performance pull (see checkPerformance below), with no
// Instagram-account dependency at all — every other tab genuinely needs an
// Instagram Business Account for content discovery, creator resolution, or
// permissions, so the selector (and its two warning banners) only shows for
// those.
export default function PartnershipAds() {
  const {
    adAccounts,
    igAccounts,
    accountsLoading,
    accountsError,
    selectedAccountId,
    setSelectedAccountId,
    selectedIgAccountId,
    setSelectedIgAccountId,
  } = useAccounts();
  const [tab, setTab] = useState("overview");
  const isPerformanceTab = PERFORMANCE_TABS.includes(tab);

  const selectedAccount = useMemo(() => adAccounts.find((a) => a.id === selectedAccountId), [adAccounts, selectedAccountId]);
  const businessId = selectedAccount?.business?.id || null;
  const igOptions = useMemo(() => igAccounts.map((a) => ({ id: a.igUserId, name: `@${a.username}` })), [igAccounts]);

  const ready = !!selectedAccountId && !!selectedIgAccountId && !!businessId;
  const performanceReady = !!selectedAccountId;

  // Shared by Overview, My Partnership Ads, and Creator Hub — all three
  // ultimately read the same underlying partnership-vs-rest ad data (see
  // lib/partnershipDetection.js), just aggregated differently, so one date
  // range control for all three instead of each either picking its own or
  // (previously) having none at all. Explore Ads keeps its own separate
  // date range — it's filtering *content posted* in a window, an unrelated
  // concept from ad *performance*, not a second copy of this one.
  const [rangePreset, setRangePreset] = useState("last_30d");
  const [customSince, setCustomSince] = useState("");
  const [customUntil, setCustomUntil] = useState("");
  const performanceRange = computeRange(rangePreset, customSince, customUntil);

  // One fetch (+ 5-minute cache) backs all three performance tabs instead of
  // each independently calling its own endpoint on its own "Load" click.
  // Reported by the user: Overview's rollup and My Partnership Ads' per-ad
  // list are already computed from the exact same underlying ad-level data
  // (see lib/partnershipDetection.js's discoverDeliveringAdIds/
  // classifyPartnershipAds, which both pages/api/fb/partnership/overview.js
  // and mine.js call), so switching tabs after loading one of them
  // shouldn't need a second "Load" click and a second round of Graph calls
  // for the same account+window — it should just show what's already there.
  // `overview` and `mine` stay two separate Graph-backed endpoints (Overview
  // needs an *account-level* Insights rollup for correctly-deduplicated
  // Reach/Frequency — see overview.js's own comment on why summing per-ad
  // rows can't give that — while My Partnership Ads/Creator Hub need the
  // per-ad rows themselves), but both are fetched together, cached together,
  // and read by all three tabs from this one piece of state.
  const [perf, setPerf] = useState({ loading: false, error: null, overview: null, ads: null, hasLoaded: false, rangeUsed: null });

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reacting to the account changing, not a derived-state anti-pattern
    setPerf({ loading: false, error: null, overview: null, ads: null, hasLoaded: false, rangeUsed: null });
  }, [selectedAccountId]);

  function checkPerformance() {
    if (!performanceReady || !selectedAccountId || !performanceRange) return;
    const { since, until } = performanceRange;
    const cacheKey = `partnership-perf:${selectedAccountId}:${since}:${until}`;
    const cached = getCachedEntry(cacheKey, PERFORMANCE_CACHE_TTL_MS);
    if (cached) {
      setPerf({ loading: false, error: null, overview: cached.data.overview, ads: cached.data.ads, hasLoaded: true, rangeUsed: performanceRange });
      return;
    }

    setPerf({ loading: true, error: null, overview: null, ads: null, hasLoaded: false, rangeUsed: performanceRange });
    const overviewParams = new URLSearchParams({ accountId: selectedAccountId, since, until });
    const mineParams = new URLSearchParams({ accountId: selectedAccountId, since, until });
    // Optional on mine.js — only used there to resolve each ad's creator
    // name; My Partnership Ads/Creator Hub both still work (just without
    // creator names) if neither is set, since this round no longer requires
    // picking an Instagram Business Account for these three tabs.
    if (businessId) mineParams.set("businessId", businessId);
    if (selectedIgAccountId) mineParams.set("igUserId", selectedIgAccountId);

    Promise.all([
      fetchWithTimeout(`/api/fb/partnership/overview?${overviewParams.toString()}`).then(parseJsonResponse),
      fetchWithTimeout(`/api/fb/partnership/mine?${mineParams.toString()}`).then(parseJsonResponse),
    ])
      .then(([overviewJson, mineJson]) => {
        if (overviewJson.error) throw new Error(overviewJson.error);
        if (mineJson.error) throw new Error(mineJson.error);
        const data = { overview: overviewJson, ads: mineJson.ads || [] };
        setCachedEntry(cacheKey, data, { prefix: "partnership-perf:", maxEntriesForPrefix: 20 });
        setPerf({ loading: false, error: null, overview: data.overview, ads: data.ads, hasLoaded: true, rangeUsed: performanceRange });
      })
      .catch((err) => setPerf({ loading: false, error: err.message, overview: null, ads: null, hasLoaded: true, rangeUsed: performanceRange }));
  }

  // The header's own "Ready to Launch" badge count — re-read from
  // localStorage (the queue's real source of truth, see
  // lib/clientStorage.js's own comment) whenever a child tab queues
  // something, rather than kept as shared state threaded through every tab.
  const [queueCount, setQueueCount] = useState(0);
  const refreshQueueCount = () => setQueueCount(selectedAccountId ? getPartnershipQueue(selectedAccountId).length : 0);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time read of this account's localStorage queue when the account changes, not derivable from props/state
    refreshQueueCount();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refreshQueueCount is stable in intent, re-created each render only incidentally
  }, [selectedAccountId]);

  return (
    <Layout>
      <Head>
        <title>Partnership Ads · Facebook Auth Dashboard</title>
      </Head>
      <PinLock>
        <div className={styles.page}>
          <main className={styles.main} style={{ maxWidth: 1500, margin: "0 auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
              <div>
                <h1 className={styles.h1}>Partnership Ads</h1>
                <p className={styles.sub} style={{ marginTop: -8, marginBottom: 16 }}>
                  Browse content your creator partners have authorized for ads, request branded-content permission, and
                  launch real ads from it.
                </p>
              </div>
              <Link href="/partnership-ads/queue" className={styles.btnPrimary} style={{ display: "inline-flex", alignItems: "center", gap: 8, textDecoration: "none" }}>
                Ready to Launch
                <span className={styles.badgeInfo} style={{ background: "rgba(255,255,255,.25)", color: "#fff" }}>{queueCount}</span>
              </Link>
            </div>

            {accountsError && <div className={styles.error}>Error loading ad accounts: {accountsError}</div>}

            {/* Overview/My Partnership Ads/Creator Hub don't need an Instagram
                Business Account (see performanceReady's own comment above) —
                these two warnings would otherwise block them on a requirement
                they don't actually have. */}
            {!isPerformanceTab && selectedAccountId && igAccounts.length === 0 && (
              <div className={styles.error} style={{ marginBottom: 16 }}>
                None of your connected Pages have a linked Instagram Business Account. Connect one in Meta Business
                Suite first — Partnership Ads needs it to browse eligible content and request creator permissions.
              </div>
            )}
            {!isPerformanceTab && selectedAccountId && igAccounts.length > 0 && !businessId && (
              <div className={styles.error} style={{ marginBottom: 16 }}>
                This ad account isn&apos;t associated with a Business Manager — Partnership Ads&apos; content discovery
                needs one.
              </div>
            )}

            <div className={styles.exploreLayout}>
              <div className={styles.exploreContent}>
                <div className={styles.tabGroup} style={{ marginBottom: 16, flexWrap: "wrap" }}>
                  {TABS.map((t) => (
                    <button
                      key={t.key}
                      type="button"
                      className={tab === t.key ? `${styles.tab} ${styles.tabActive}` : styles.tab}
                      onClick={() => setTab(t.key)}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>

                {tab === "overview" && (
                  <OverviewTab
                    ready={performanceReady}
                    currency={selectedAccount?.currency}
                    range={perf.rangeUsed}
                    loading={perf.loading}
                    error={perf.error}
                    data={perf.overview}
                  />
                )}
                {tab === "mine" && (
                  <MyAdsTab
                    ready={performanceReady}
                    currency={selectedAccount?.currency}
                    range={perf.rangeUsed}
                    loading={perf.loading}
                    error={perf.error}
                    hasLoaded={perf.hasLoaded}
                    ads={perf.ads}
                  />
                )}
                {tab === "creators" && (
                  <CreatorHubTab
                    ready={performanceReady}
                    currency={selectedAccount?.currency}
                    range={perf.rangeUsed}
                    loading={perf.loading}
                    error={perf.error}
                    hasLoaded={perf.hasLoaded}
                    ads={perf.ads}
                  />
                )}
                {tab === "explore" && (
                  <ExploreTab
                    accountId={selectedAccountId}
                    businessId={businessId}
                    igUserId={selectedIgAccountId}
                    ready={ready}
                    onQueueChanged={refreshQueueCount}
                  />
                )}
                {tab === "requests" && <RequestsTab igUserId={selectedIgAccountId} ready={ready} />}
                {tab === "code" && (
                  <PartnershipCodeTab
                    accountId={selectedAccountId}
                    businessId={businessId}
                    igUserId={selectedIgAccountId}
                    ready={ready}
                    onQueueChanged={refreshQueueCount}
                  />
                )}
              </div>

              <aside className={styles.exploreQueryPanel}>
                <div className={`${styles.card} ${styles.exploreQueryCard}`}>
                  <div className={styles.exploreQueryHeader}>
                    <span style={{ fontWeight: 700, fontSize: 13 }}>Account &amp; Filters</span>
                  </div>
                  <div className={styles.exploreQueryBody}>
                    <div>
                      <p className={styles.sub} style={{ marginBottom: 6 }}>
                        Ad Account
                      </p>
                      <AccountSelect
                        accounts={adAccounts}
                        value={selectedAccountId}
                        onChange={setSelectedAccountId}
                        placeholder="Select an ad account…"
                        style={{ width: "100%" }}
                        loading={accountsLoading}
                      />
                    </div>

                    {/* Only the tabs that actually use an Instagram Business
                        Account (content discovery, creator resolution,
                        permissions) show its picker — Overview/My Partnership
                        Ads/Creator Hub don't need it at all. */}
                    {!isPerformanceTab && (
                      <div>
                        <p className={styles.sub} style={{ marginBottom: 6 }}>
                          Instagram Business Account
                        </p>
                        <AccountSelect
                          accounts={igOptions}
                          value={selectedIgAccountId}
                          onChange={setSelectedIgAccountId}
                          placeholder={igOptions.length === 0 ? "No Instagram Business Account found" : "Select an Instagram account…"}
                          style={{ width: "100%" }}
                          loading={accountsLoading}
                        />
                      </div>
                    )}

                    {isPerformanceTab && (
                      <div>
                        <p className={styles.sub} style={{ marginBottom: 6 }}>
                          Date range — shared by Overview, My Partnership Ads &amp; Creator Hub
                        </p>
                        <DateRangeMenu
                          rangePreset={rangePreset}
                          customSince={customSince}
                          customUntil={customUntil}
                          maxRangeDays={MAX_RANGE_DAYS}
                          compareToPrevious={false}
                          compareCustomSince=""
                          compareDisplay="change"
                          compareDisabled
                          compareDisabledReason="Not available here — each of these tabs shows one window at a time, not a comparison view."
                          onApply={(patch) => {
                            setRangePreset(patch.rangePreset);
                            setCustomSince(patch.customSince);
                            setCustomUntil(patch.customUntil);
                          }}
                        />
                      </div>
                    )}
                  </div>

                  {isPerformanceTab && (
                    <div className={styles.exploreQueryFooter}>
                      <button
                        type="button"
                        className={styles.btnPrimary}
                        onClick={checkPerformance}
                        disabled={!performanceReady || !performanceRange || perf.loading}
                        style={{ width: "100%" }}
                      >
                        {perf.loading ? "Checking…" : perf.hasLoaded ? "Reload" : "Check Performance"}
                      </button>
                    </div>
                  )}
                </div>
              </aside>
            </div>
          </main>
        </div>
      </PinLock>
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
