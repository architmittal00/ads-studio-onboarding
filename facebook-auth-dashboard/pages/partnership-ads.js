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
import { computeRange } from "@/lib/dateRanges";
import styles from "@/styles/Home.module.css";

// Same cap Copy Ads uses, same reasoning: Overview/My Partnership Ads/
// Creator Hub's own data pulls are all bounded by an /insights-first ad-id
// discovery (see lib/partnershipDetection.js) rather than walking the
// account's full ad history — a generous but real ceiling keeps that
// discovery query itself cheap.
const PERFORMANCE_TABS = ["overview", "mine", "creators"];
const MAX_RANGE_DAYS = 90;

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
// Overview is the one exception to "every tab needs both selections": its
// own query is a plain ad-account-level performance rollup with no
// Instagram-account dependency at all (see overviewReady below) — every
// other tab genuinely needs an Instagram Business Account for content
// discovery, creator resolution, or permissions.
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

  const selectedAccount = useMemo(() => adAccounts.find((a) => a.id === selectedAccountId), [adAccounts, selectedAccountId]);
  const businessId = selectedAccount?.business?.id || null;
  const igOptions = useMemo(() => igAccounts.map((a) => ({ id: a.igUserId, name: `@${a.username}` })), [igAccounts]);

  const ready = !!selectedAccountId && !!selectedIgAccountId && !!businessId;
  // Overview's own query (pages/api/fb/partnership/overview.js) is just a
  // partnership-vs-normal performance rollup for the ad account — it never
  // reads businessId or igUserId at all (unlike every other tab here, which
  // all need an Instagram Business Account for content discovery, creator
  // resolution, or permissions). Gating it on the same `ready` as those
  // other tabs forced picking an Instagram Business Account just to see a
  // number that doesn't depend on one — reported by the user as
  // unnecessary, confirmed by checking the route itself.
  const overviewReady = !!selectedAccountId;

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
          <main className={styles.main} style={{ maxWidth: 1400, margin: "0 auto" }}>
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

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
              <div style={{ minWidth: 220 }}>
                <p className={styles.muted} style={{ marginBottom: 4, fontSize: 11 }}>
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
              <div style={{ minWidth: 220 }}>
                <p className={styles.muted} style={{ marginBottom: 4, fontSize: 11 }}>
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
            </div>

            {/* Overview doesn't need an Instagram Business Account (see overviewReady's
                own comment above) — these two warnings would otherwise block it on a
                requirement it doesn't actually have. */}
            {tab !== "overview" && selectedAccountId && igAccounts.length === 0 && (
              <div className={styles.error} style={{ marginBottom: 16 }}>
                None of your connected Pages have a linked Instagram Business Account. Connect one in Meta Business
                Suite first — Partnership Ads needs it to browse eligible content and request creator permissions.
              </div>
            )}
            {tab !== "overview" && selectedAccountId && igAccounts.length > 0 && !businessId && (
              <div className={styles.error} style={{ marginBottom: 16 }}>
                This ad account isn&apos;t associated with a Business Manager — Partnership Ads&apos; content discovery
                needs one.
              </div>
            )}

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

            {PERFORMANCE_TABS.includes(tab) && (
              <div className={styles.card} style={{ padding: 12, marginBottom: 16, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <span className={styles.muted} style={{ fontWeight: 600 }}>
                  Date range
                </span>
                <DateRangeMenu
                  rangePreset={rangePreset}
                  customSince={customSince}
                  customUntil={customUntil}
                  maxRangeDays={MAX_RANGE_DAYS}
                  compareToPrevious={false}
                  compareCustomSince=""
                  compareDisplay="change"
                  compareDisabled
                  compareDisabledReason="Not available here — Overview/My Partnership Ads/Creator Hub each show one window at a time, not a comparison view."
                  onApply={(patch) => {
                    setRangePreset(patch.rangePreset);
                    setCustomSince(patch.customSince);
                    setCustomUntil(patch.customUntil);
                  }}
                />
                <span className={styles.muted} style={{ fontSize: 11 }}>
                  Shared by Overview, My Partnership Ads &amp; Creator Hub
                </span>
              </div>
            )}

            {tab === "overview" && (
              <OverviewTab accountId={selectedAccountId} ready={overviewReady} currency={selectedAccount?.currency} range={performanceRange} />
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
            {tab === "mine" && (
              <MyAdsTab
                accountId={selectedAccountId}
                businessId={businessId}
                igUserId={selectedIgAccountId}
                ready={ready}
                currency={selectedAccount?.currency}
                range={performanceRange}
              />
            )}
            {tab === "creators" && (
              <CreatorHubTab
                accountId={selectedAccountId}
                businessId={businessId}
                igUserId={selectedIgAccountId}
                ready={ready}
                currency={selectedAccount?.currency}
                range={performanceRange}
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
