import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { getServerSession } from "next-auth/next";
import { useEffect, useMemo, useState } from "react";
import { authOptions } from "./api/auth/[...nextauth]";
import Layout from "@/components/Layout";
import AccountSelect from "@/components/AccountSelect";
import DateRangeMenu from "@/components/DateRangeMenu";
import { useAccounts } from "@/components/AccountProvider";
import { RefreshIcon, HandshakeIcon } from "@/components/icons";
import OverviewTab from "@/components/partnership/OverviewTab";
import ExploreTab from "@/components/partnership/ExploreTab";
import RequestsTab from "@/components/partnership/RequestsTab";
import MyAdsTab from "@/components/partnership/MyAdsTab";
import CreatorHubTab from "@/components/partnership/CreatorHubTab";
import PartnershipCodeTab from "@/components/partnership/PartnershipCodeTab";
import { getPartnershipQueue } from "@/lib/clientStorage";
import { getCachedEntry, setCachedEntry } from "@/lib/clientCache";
import { computeRange, RANGE_PRESETS } from "@/lib/dateRanges";
import { useIsMobile } from "@/lib/useIsMobile";
import BottomSheet from "@/components/BottomSheet";
import { MobileContextBar, MobileIconBtn, MobileChips, PickerField, PickerSheet, formatRangeLabel } from "@/components/mobile/MobileChrome";
import { fetchWithTimeout, parseJsonResponse } from "@/lib/fetchJson";
import styles from "@/styles/Home.module.css";
import { track } from "@/lib/analytics";

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

// Reported by the user: the header pill row's three account pickers (Ad
// Account, Business, Instagram Account) are plain, unlabeled text inputs —
// once something's selected, there's nothing distinguishing "Shesha
// Ayurveda Main" (an ad account) from "Shiprocket" (a Business) from
// "@sheshaayurveda" (an Instagram account) beyond already knowing what each
// one is. A small caption above each pill makes that explicit.
function LabeledPill({ label, children }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <span className={styles.muted} style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.3 }}>
        {label}
      </span>
      {children}
    </div>
  );
}

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "mine", label: "My Partnership Ads", short: "My Ads" },
  { key: "creators", label: "Creator Hub", short: "Creators" },
  { key: "explore", label: "Explore Ads", short: "Explore" },
  { key: "requests", label: "My Requests", short: "Requests" },
  { key: "code", label: "Partnership Code", short: "Code" },
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
//
// Those same tabs also get a separate Business selector, alongside the
// Instagram Account one — reported and diagnosed by the user themselves:
// Content Discovery and branded-content permission checks are authorized at
// the Business level, and this used to be silently derived from whichever ad
// account was selected (`selectedAccount?.business?.id`). An ad account being
// shared with someone doesn't mean that Business itself has granted them
// access — while a *different* Business they do have full access to can often
// query the exact same Instagram account's content just fine, since the IG
// account is a shared asset, not exclusively owned by one Business. The user
// confirmed this by manually switching to an unrelated ad account just to get
// a working Business id. `businessOptions`/`selectedBusinessId` (see
// AccountProvider.js) make that choice explicit and independent instead.
export default function PartnershipAds() {
  const {
    adAccounts,
    igAccounts,
    pages,
    accountsLoading,
    accountsError,
    selectedAccountId,
    setSelectedAccountId,
    selectedIgAccountId,
    setSelectedIgAccountId,
    businessOptions,
    businessesError,
    selectedBusinessId,
    setSelectedBusinessId,
  } = useAccounts();
  const router = useRouter();
  const isMobile = useIsMobile();
  const [contextOpen, setContextOpen] = useState(false);
  const [tab, setTabState] = useState("overview");
  const isPerformanceTab = PERFORMANCE_TABS.includes(tab);

  // Reported by the user: reloading while on, say, Explore Ads always landed
  // back on Overview — `tab` was plain component state with no relationship
  // to the URL at all. Reading it from `?tab=` on load (and writing it back,
  // shallowly, on every switch) means the active tab survives a reload or a
  // bookmark, the same way a page's own route would.
  useEffect(() => {
    if (!router.isReady) return;
    const queryTab = typeof router.query.tab === "string" ? router.query.tab : null;
    if (queryTab && TABS.some((t) => t.key === queryTab) && queryTab !== tab) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing from the URL on first load / back-forward navigation, not a derived-state anti-pattern
      setTabState(queryTab);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-sync when the URL's own tab param changes, not on every local setTab call
  }, [router.isReady, router.query.tab]);

  function setTab(next) {
    setTabState(next);
    track("partnership_tab_opened", { tab: next });
    if (router.isReady) {
      router.replace({ pathname: router.pathname, query: { ...router.query, tab: next } }, undefined, { shallow: true });
    }
  }

  const selectedAccount = useMemo(() => adAccounts.find((a) => a.id === selectedAccountId), [adAccounts, selectedAccountId]);
  // Deliberately NOT derived from `selectedAccount` — see AccountProvider.js's
  // own comment on `businessOptions`/`selectedBusinessId` for why Business
  // selection has to be independent of which ad account is picked.
  const businessId = selectedBusinessId || null;
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
  const performanceRange = computeRange(rangePreset, customSince, customUntil, selectedAccount?.timezone_name);

  // Explore Ads' own, separate date range — filtering *content posted* in a
  // window, not ad performance (see the comment above). Previously lived
  // inside ExploreTab.js itself with its own DateRangeMenu rendered in the
  // main content area; lifted up here so its control can join the same
  // header pill row every other tab already uses, instead of Explore being
  // the one tab with controls split across two different places on the page.
  const [exploreRangePreset, setExploreRangePreset] = useState("last_30d");
  const [exploreCustomSince, setExploreCustomSince] = useState("");
  const [exploreCustomUntil, setExploreCustomUntil] = useState("");
  const exploreRange = computeRange(exploreRangePreset, exploreCustomSince, exploreCustomUntil, selectedAccount?.timezone_name);

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
  const [perf, setPerf] = useState({ loading: false, error: null, overview: null, ads: null, creatorSummary: null, hasLoaded: false, rangeUsed: null });

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reacting to the account changing, not a derived-state anti-pattern
    setPerf({ loading: false, error: null, overview: null, ads: null, creatorSummary: null, hasLoaded: false, rangeUsed: null });
  }, [selectedAccountId]);

  function checkPerformance() {
    if (!performanceReady || !selectedAccountId || !performanceRange) return;
    const { since, until } = performanceRange;
    const cacheKey = `partnership-perf:${selectedAccountId}:${since}:${until}`;
    const cached = getCachedEntry(cacheKey, PERFORMANCE_CACHE_TTL_MS);
    if (cached) {
      setPerf({ loading: false, error: null, overview: cached.data.overview, ads: cached.data.ads, creatorSummary: cached.data.creatorSummary, hasLoaded: true, rangeUsed: performanceRange });
      return;
    }

    setPerf({ loading: true, error: null, overview: null, ads: null, creatorSummary: null, hasLoaded: false, rangeUsed: performanceRange });
    const overviewParams = new URLSearchParams({ accountId: selectedAccountId, since, until });
    // mine.js's creator resolution reads each ad's own linked Instagram
    // media id directly (lib/partnershipDetection.js) — no Business id or
    // Instagram Business Account needed at all, so unlike the old
    // Content-Discovery-based approach, no extra params to pass here.
    const mineParams = new URLSearchParams({ accountId: selectedAccountId, since, until });
    // Optional, best-effort only — mine.js uses this (any connected
    // Instagram Business Account, doesn't need to relate to this ad account)
    // purely to fetch creators' profile pictures via Business Discovery. Not
    // required: with none connected, ads/creator names still resolve exactly
    // as before, just without an avatar.
    if (igAccounts.length > 0) mineParams.set("igUserId", igAccounts[0].igUserId);

    Promise.all([
      fetchWithTimeout(`/api/fb/partnership/overview?${overviewParams.toString()}`).then(parseJsonResponse),
      fetchWithTimeout(`/api/fb/partnership/mine?${mineParams.toString()}`).then(parseJsonResponse),
    ])
      .then(([overviewJson, mineJson]) => {
        if (overviewJson.error) throw new Error(overviewJson.error);
        if (mineJson.error) throw new Error(mineJson.error);
        const data = { overview: overviewJson, ads: mineJson.ads || [], creatorSummary: mineJson.creatorResolutionSummary || null };
        setCachedEntry(cacheKey, data, { prefix: "partnership-perf:", maxEntriesForPrefix: 20 });
        setPerf({ loading: false, error: null, overview: data.overview, ads: data.ads, creatorSummary: data.creatorSummary, hasLoaded: true, rangeUsed: performanceRange });
      })
      .catch((err) => setPerf({ loading: false, error: err.message, overview: null, ads: null, creatorSummary: null, hasLoaded: true, rangeUsed: performanceRange }));
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

  function renderDateMenu(fullWidth) {
    return (
      <DateRangeMenu
        timeZone={selectedAccount?.timezone_name}
        rangePreset={isPerformanceTab ? rangePreset : exploreRangePreset}
        customSince={isPerformanceTab ? customSince : exploreCustomSince}
        customUntil={isPerformanceTab ? customUntil : exploreCustomUntil}
        maxRangeDays={isPerformanceTab ? MAX_RANGE_DAYS : 365}
        compareToPrevious={false}
        compareCustomSince=""
        compareDisplay="change"
        compareDisabled
        compareDisabledReason={
          isPerformanceTab
            ? "Not available here — each of these tabs shows one window at a time, not a comparison view."
            : "Not available here — this filters which content shows up, not a performance comparison."
        }
        triggerClassName={fullWidth ? undefined : styles.headerPillBtn}
        fullWidth={fullWidth}
        onApply={(patch) => {
          if (isPerformanceTab) {
            setRangePreset(patch.rangePreset);
            setCustomSince(patch.customSince);
            setCustomUntil(patch.customUntil);
          } else {
            setExploreRangePreset(patch.rangePreset);
            setExploreCustomSince(patch.customSince);
            setExploreCustomUntil(patch.customUntil);
          }
        }}
      />
    );
  }

  const activeRangeKey = isPerformanceTab ? rangePreset : exploreRangePreset;
  const activeRange = isPerformanceTab ? performanceRange : exploreRange;
  const mobileRangeLabel = activeRange
    ? formatRangeLabel(RANGE_PRESETS.find((p) => p.key === activeRangeKey)?.label, activeRange.since, activeRange.until)
    : "";
  const [picker, setPicker] = useState(null); // "account" | "business" | "ig"
  const pickerOptions = { account: adAccounts.map((a) => ({ id: a.id, name: a.name || a.id, sub: a.account_id })), business: businessOptions, ig: igOptions };
  const pickerValue = { account: selectedAccountId, business: selectedBusinessId, ig: selectedIgAccountId };
  const pickerSetter = { account: setSelectedAccountId, business: setSelectedBusinessId, ig: setSelectedIgAccountId };
  const pickerTitle = { account: "Ad account", business: "Business Manager", ig: "Instagram account" };
  const labelOf = (list, id) => list.find((o) => o.id === id)?.name;

  return (
    <Layout>
      <Head>
        <title>Partnership Ads · Facebook Auth Dashboard</title>
      </Head>
      <div className={styles.page}>
        <main className={styles.main} style={{ maxWidth: 1500, margin: "0 auto" }}>
          {isMobile && (
            <MobileContextBar title={selectedAccount?.name || "Select an ad account"} sub={mobileRangeLabel} onOpen={() => setContextOpen(true)}>
              {isPerformanceTab && (
                <MobileIconBtn label="Reload" onClick={checkPerformance} disabled={!performanceReady || !performanceRange || perf.loading} spinning={perf.loading}>
                  <RefreshIcon size={16} />
                </MobileIconBtn>
              )}
              <Link href="/partnership-ads/queue" className={styles.pvIconBtn} aria-label={`Ready to Launch, ${queueCount} queued`}>
                <HandshakeIcon size={16} />
                {queueCount > 0 && <span className={styles.pvBadge}>{queueCount}</span>}
              </Link>
            </MobileContextBar>
          )}
          <div className={isMobile ? styles.hideOnMobile : undefined} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, flexWrap: "wrap" }}>
            <div>
              {/* h1/.sub both carry zero margin of their own (see
                  styles/Home.module.css) — the title's visible bottom
                  space was previously coming from the <h1>'s UA-stylesheet
                  default margin minus a `marginTop: -8` on the subtitle, a
                  sitewide copy-pasted pattern that nets a cramped ~3px gap
                  here. Set explicitly instead of relying on that
                  cancellation; scoped to this page only. */}
              <h1 className={styles.h1} style={{ margin: 0 }}>
                Partnership Ads
              </h1>
              {/* marginBottom trimmed from 16 to 6 — on a narrower viewport
                  (or Explore Ads' extra Business Manager/Instagram Account
                  pills) the account/date/Ready-to-Launch row below wraps
                  onto its own line under this flex container, and this
                  margin was the main thing pushing that wrapped row further
                  down than it needed to be below the title. */}
              <p className={styles.sub} style={{ marginTop: 6, marginBottom: 6 }}>
                Browse content your creator partners have authorized for ads, request branded-content permission, and
                launch real ads from it.
              </p>
            </div>
            {/* Ready to Launch + every tab's own Ad Account (+ Instagram
                Business Account, + Date Range, depending on what that tab
                actually needs) all share one row now — reported as too
                cluttered when the pill row sat stacked on its own line
                below the button, two separate rows before any real tab
                content even started. */}
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>
              <div className={styles.headerPillRow} style={{ alignItems: "flex-end" }}>
                <LabeledPill label="Ad Account">
                  <AccountSelect
                    accounts={adAccounts}
                    value={selectedAccountId}
                    onChange={setSelectedAccountId}
                    placeholder="Select an ad account…"
                    inputClassName={styles.headerPillSelect}
                    inputStyle={{ width: 190 }}
                    loading={accountsLoading}
                  />
                </LabeledPill>
                {!isPerformanceTab && (
                  <LabeledPill label="Business Manager">
                    <AccountSelect
                      accounts={businessOptions}
                      value={selectedBusinessId}
                      onChange={setSelectedBusinessId}
                      placeholder={businessOptions.length === 0 ? "No Business Manager found" : "Select a Business…"}
                      inputClassName={styles.headerPillSelect}
                      inputStyle={{ width: 190 }}
                      loading={accountsLoading}
                    />
                  </LabeledPill>
                )}
                {!isPerformanceTab && (
                  <LabeledPill label="Instagram Account">
                    <AccountSelect
                      accounts={igOptions}
                      value={selectedIgAccountId}
                      onChange={setSelectedIgAccountId}
                      placeholder={igOptions.length === 0 ? "No Instagram account" : "Select an Instagram account…"}
                      inputClassName={styles.headerPillSelect}
                      inputStyle={{ width: 190 }}
                      loading={accountsLoading}
                    />
                  </LabeledPill>
                )}
                {(isPerformanceTab || tab === "explore") && renderDateMenu(false)}
                {isPerformanceTab && (
                  <button
                    type="button"
                    className={perf.loading ? `${styles.headerPillIconBtn} spinning` : styles.headerPillIconBtn}
                    onClick={checkPerformance}
                    disabled={!performanceReady || !performanceRange || perf.loading}
                    title={perf.hasLoaded ? "Reload" : "Check performance"}
                    aria-label={perf.hasLoaded ? "Reload" : "Check performance"}
                  >
                    <RefreshIcon size={14} />
                  </button>
                )}
              </div>
              <Link href="/partnership-ads/queue" className={styles.btnPrimary} style={{ display: "inline-flex", alignItems: "center", gap: 8, textDecoration: "none" }}>
                Ready to Launch
                <span className={styles.badgeInfo} style={{ background: "rgba(255,255,255,.25)", color: "#fff" }}>{queueCount}</span>
              </Link>
            </div>
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
          {!isPerformanceTab && selectedAccountId && igAccounts.length > 0 && businessOptions.length === 0 && (
            <div className={styles.error} style={{ marginBottom: 16 }}>
              {businessesError
                ? `Couldn't load your Business Managers: ${businessesError}`
                : "You're not a member of any Business Manager — Partnership Ads' content discovery needs you to be added to at least one, with any role. Ask to be added in Meta Business Settings."}
            </div>
          )}

          {/* Every tab's Ad Account/Instagram Account/Date Range now live in
              the header's pill row above — no tab needs its own side panel
              anymore, so every tab gets this same full-width content area. */}
          <div className={styles.exploreContent}>
            {isMobile && <MobileChips label="Partnership Ads" tabs={TABS} active={tab} onChange={setTab} />}
            <div className={isMobile ? styles.hideOnMobile : styles.tabGroup} style={{ marginBottom: 16, flexWrap: "wrap" }}>
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
                onCheck={checkPerformance}
                canCheck={!!performanceReady && !!performanceRange}
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
                creatorSummary={perf.creatorSummary}
                onCheck={checkPerformance}
                canCheck={!!performanceReady && !!performanceRange}
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
                onCheck={checkPerformance}
                canCheck={!!performanceReady && !!performanceRange}
              />
            )}
            {tab === "explore" && (
              <ExploreTab
                accountId={selectedAccountId}
                businessId={businessId}
                igUserId={selectedIgAccountId}
                ready={ready}
                dateRange={exploreRange}
                onQueueChanged={refreshQueueCount}
              />
            )}
            {tab === "requests" && (
              <RequestsTab
                igUserId={selectedIgAccountId}
                ready={ready}
                ads={perf.ads}
                currency={selectedAccount?.currency}
                perfLoading={perf.loading}
                perfHasLoaded={perf.hasLoaded}
                onCheckPerformance={checkPerformance}
                canCheckPerformance={!!performanceReady && !!performanceRange}
              />
            )}
            {tab === "code" && (
              <PartnershipCodeTab
                accountId={selectedAccountId}
                businessId={businessId}
                igUserId={selectedIgAccountId}
                pages={pages}
                ready={ready}
                onQueueChanged={refreshQueueCount}
                igOptions={igOptions}
                businessOptions={businessOptions}
                onSwitchContext={(bizId, igId) => {
                  setSelectedBusinessId(bizId);
                  setSelectedIgAccountId(igId);
                }}
              />
            )}
          </div>

          {isMobile && (
            <BottomSheet open={contextOpen} title="Account & dates" onClose={() => setContextOpen(false)} footer={<button type="button" className={styles.btnPrimary} style={{ flex: 1 }} onClick={() => setContextOpen(false)}>Done</button>}>
              <div className={styles.pvSheetFields}>
                <PickerField label="Ad account" value={selectedAccount?.name} placeholder={accountsLoading ? "Loading ad accounts…" : "Select an ad account…"} onClick={() => setPicker("account")} />
                {!isPerformanceTab && (
                  <PickerField label="Business Manager" value={labelOf(businessOptions, selectedBusinessId)} placeholder={businessOptions.length === 0 ? "No Business Manager found" : "Select a Business…"} onClick={() => setPicker("business")} />
                )}
                {!isPerformanceTab && (
                  <PickerField label="Instagram account" value={labelOf(igOptions, selectedIgAccountId)} placeholder={igOptions.length === 0 ? "No Instagram account" : "Select an Instagram account…"} onClick={() => setPicker("ig")} />
                )}
                {(isPerformanceTab || tab === "explore") && (
                  <div className={styles.pvField}>
                    <span>{isPerformanceTab ? "Date range" : "Content posted"}</span>
                    {renderDateMenu(true)}
                  </div>
                )}
              </div>
            </BottomSheet>
          )}
          {isMobile && picker && (
            <PickerSheet
              open
              title={pickerTitle[picker]}
              options={pickerOptions[picker]}
              value={pickerValue[picker]}
              onPick={pickerSetter[picker]}
              onClose={() => setPicker(null)}
              searchPlaceholder={`Search ${pickerTitle[picker].toLowerCase()}s`}
            />
          )}
        </main>
      </div>
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
