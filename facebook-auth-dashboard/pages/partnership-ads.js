import Head from "next/head";
import { getServerSession } from "next-auth/next";
import { useMemo, useState } from "react";
import { authOptions } from "./api/auth/[...nextauth]";
import Layout from "@/components/Layout";
import AccountSelect from "@/components/AccountSelect";
import { useAccounts } from "@/components/AccountProvider";
import OverviewTab from "@/components/partnership/OverviewTab";
import ExploreTab from "@/components/partnership/ExploreTab";
import ComingSoonTab from "@/components/partnership/ComingSoonTab";
import styles from "@/styles/Home.module.css";

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
export default function PartnershipAds() {
  const { adAccounts, igAccounts, accountsError, selectedAccountId, setSelectedAccountId, selectedIgAccountId, setSelectedIgAccountId } =
    useAccounts();
  const [tab, setTab] = useState("overview");

  const selectedAccount = useMemo(() => adAccounts.find((a) => a.id === selectedAccountId), [adAccounts, selectedAccountId]);
  const businessId = selectedAccount?.business?.id || null;
  const igOptions = useMemo(() => igAccounts.map((a) => ({ id: a.igUserId, name: `@${a.username}` })), [igAccounts]);

  const ready = !!selectedAccountId && !!selectedIgAccountId && !!businessId;

  return (
    <Layout>
      <Head>
        <title>Partnership Ads · Facebook Auth Dashboard</title>
      </Head>
      <div className={styles.page}>
        <main className={styles.main} style={{ maxWidth: 1400, margin: "0 auto" }}>
          <h1 className={styles.h1}>Partnership Ads</h1>
          <p className={styles.sub} style={{ marginTop: -8, marginBottom: 16 }}>
            Browse content your creator partners have authorized for ads, request branded-content permission, and
            launch real ads from it.
          </p>

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
              />
            </div>
          </div>

          {selectedAccountId && igAccounts.length === 0 && (
            <div className={styles.error} style={{ marginBottom: 16 }}>
              None of your connected Pages have a linked Instagram Business Account. Connect one in Meta Business
              Suite first — Partnership Ads needs it to browse eligible content and request creator permissions.
            </div>
          )}
          {selectedAccountId && igAccounts.length > 0 && !businessId && (
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

          {tab === "overview" && <OverviewTab accountId={selectedAccountId} ready={ready} currency={selectedAccount?.currency} />}
          {tab === "explore" && (
            <ExploreTab accountId={selectedAccountId} businessId={businessId} igUserId={selectedIgAccountId} ready={ready} />
          )}
          {tab === "mine" && <ComingSoonTab label="My Partnership Ads" />}
          {tab === "creators" && <ComingSoonTab label="Creator Hub" />}
          {tab === "requests" && <ComingSoonTab label="My Requests" />}
          {tab === "code" && <ComingSoonTab label="Partnership Code" />}
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
