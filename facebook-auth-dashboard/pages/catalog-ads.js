import Head from "next/head";
import { useState } from "react";
import { getServerSession } from "next-auth/next";
import { authOptions } from "./api/auth/[...nextauth]";
import Layout from "@/components/Layout";
import Loader from "@/components/Loader";
import AccountSelect from "@/components/AccountSelect";
import DateRangeMenu from "@/components/DateRangeMenu";
import PinGate from "@/components/catalogads/PinGate";
import CatalogOverview from "@/components/catalogads/CatalogOverview";
import CatalogAdsTable from "@/components/catalogads/CatalogAdsTable";
import ProductSetsPanel from "@/components/catalogads/ProductSetsPanel";
import CreateAdWizard from "@/components/catalogads/CreateAdWizard";
import { TagIcon, ChartIcon, RefreshIcon } from "@/components/icons";
import { useAccounts } from "@/components/AccountProvider";
import { computeRange } from "@/lib/dateRanges";
import { isCatalogAdsUnlocked } from "@/lib/catalogAds/requirePin";
import { useJsonFetch } from "@/lib/catalogAds/useJsonFetch";
import styles from "@/styles/Home.module.css";

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "ads", label: "My Catalog Ads" },
  { key: "sets", label: "Product Sets" },
  { key: "create", label: "Create Ad" },
];

export default function CatalogAdsPage({ unlocked }) {
  return (
    <Layout>
      <Head>
        <title>Catalog Ads · Facebook Auth Dashboard</title>
      </Head>
      {unlocked ? <CatalogAdsContent /> : <PinGate />}
    </Layout>
  );
}

// Compares catalog ads with other ads, browses product sets, and launches
// catalog ads — ported from sr-ads-launch's own CatalogAdsApp, reusing this
// app's AccountProvider/AccountSelect and DateRangeMenu instead of that
// app's own account picker and calendar.
function CatalogAdsContent() {
  const { adAccounts, accountsLoading, accountsError, selectedAccountId, setSelectedAccountId } = useAccounts();
  const [tab, setTab] = useState("overview");
  const [rangePreset, setRangePreset] = useState("last_7d");
  const [customSince, setCustomSince] = useState(null);
  const [customUntil, setCustomUntil] = useState(null);
  const [tick, setTick] = useState(0);
  // Overview waits for an explicit "Check Performance" click; the other tabs
  // count as checked the moment they're opened, same as the source app —
  // derived from `tab` rather than an effect that sets it, since it's just a
  // boolean function of state already in hand.
  const [checkedByUser, setCheckedByUser] = useState(false);
  const checked = checkedByUser || tab === "ads" || tab === "sets";
  const [createParams, setCreateParams] = useState(null);

  const account = adAccounts.find((a) => a.id === selectedAccountId) || null;
  const range = computeRange(rangePreset, customSince, customUntil);
  const wantPerf = !!account && !!range && tab !== "create" && (tab !== "overview" || checked);
  const perfUrl = wantPerf
    ? `/api/fb/catalog-ads/performance?accountId=${encodeURIComponent(account.id)}&since=${range.since}&until=${range.until}&_t=${tick}`
    : null;
  const perf = useJsonFetch(perfUrl);
  const perfRows = perf.data?.ads || [];

  function changeAccount(id) {
    setSelectedAccountId(id);
    setCreateParams(null);
  }

  function startCreate(catalogId, productSetId) {
    setCreateParams({ catalogId, productSetId });
    setTab("create");
  }

  return (
    <div className={styles.page}>
      <main className={styles.main} style={{ maxWidth: 1600, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <TagIcon size={20} />
              <h1 className={styles.h1}>Catalog Ads</h1>
            </div>
            <p className={styles.sub} style={{ marginTop: -4 }}>
              Compare catalog ads with your other ads, browse product sets, and launch catalog ads.
            </p>
          </div>
          <AccountSelect accounts={adAccounts} value={selectedAccountId} onChange={changeAccount} style={{ minWidth: 240 }} loading={accountsLoading} />
        </div>

        {accountsError && <div className={styles.error}>{accountsError}</div>}

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, margin: "16px 0" }}>
          <div className={styles.tabGroup} style={{ width: "fit-content" }}>
            {TABS.map((t) => (
              <button key={t.key} type="button" className={tab === t.key ? `${styles.tab} ${styles.tabActive}` : styles.tab} onClick={() => setTab(t.key)}>
                {t.label}
              </button>
            ))}
          </div>
          {tab !== "create" && (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <DateRangeMenu
                rangePreset={rangePreset}
                customSince={customSince}
                customUntil={customUntil}
                compareToPrevious={false}
                compareCustomSince=""
                compareDisplay="change"
                compareDisabled
                compareDisabledReason="Not available for Catalog Ads — there's no comparison view here, just the chosen window."
                onApply={(patch) => {
                  setRangePreset(patch.rangePreset);
                  setCustomSince(patch.customSince);
                  setCustomUntil(patch.customUntil);
                }}
              />
              <button type="button" className={styles.btnSecondary} aria-label="Refresh" title="Refresh" onClick={() => { setCheckedByUser(true); setTick((n) => n + 1); }}>
                <RefreshIcon size={15} />
              </button>
            </div>
          )}
        </div>

        {!account ? (
          accountsLoading ? (
            <div className={styles.card}>
              <Loader label="Loading ad accounts…" />
            </div>
          ) : null
        ) : tab === "overview" && !checked ? (
          <div className={styles.card} style={{ textAlign: "center", padding: 32 }}>
            <ChartIcon size={28} />
            <h3 className={styles.h2} style={{ marginTop: 12 }}>
              Ready to compare performance
            </h3>
            <p className={styles.sub}>See how your catalog ads stack up against your other ads over a chosen window.</p>
            <button type="button" className={styles.btnPrimary} style={{ marginTop: 12 }} onClick={() => setCheckedByUser(true)}>
              Check Performance
            </button>
          </div>
        ) : tab === "overview" ? (
          <CatalogOverview rows={perfRows} loading={perf.loading} error={perf.error} currency={account.currency} since={range?.since} until={range?.until} />
        ) : tab === "ads" ? (
          <CatalogAdsTable rows={perfRows} loading={perf.loading} error={perf.error} currency={account.currency} />
        ) : tab === "sets" ? (
          <ProductSetsPanel
            key={account.id}
            accountId={account.id}
            currency={account.currency}
            perfRows={perfRows}
            perfLoading={perf.loading}
            onCreateAd={startCreate}
          />
        ) : (
          <CreateAdWizard
            key={`${account.id}-${createParams?.catalogId || ""}-${createParams?.productSetId || ""}`}
            accountId={account.id}
            currency={account.currency}
            initialCatalogId={createParams?.catalogId}
            initialProductSetId={createParams?.productSetId}
          />
        )}
      </main>
    </div>
  );
}

export async function getServerSideProps(context) {
  const session = await getServerSession(context.req, context.res, authOptions);

  if (!session) {
    return { redirect: { destination: "/", permanent: false } };
  }

  return { props: { unlocked: isCatalogAdsUnlocked(context.req) } };
}
