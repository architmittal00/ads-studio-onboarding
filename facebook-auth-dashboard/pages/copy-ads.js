import Head from "next/head";
import { getServerSession } from "next-auth/next";
import { useEffect, useState } from "react";
import { authOptions } from "./api/auth/[...nextauth]";
import Layout from "@/components/Layout";
import Loader from "@/components/Loader";
import AccountSelect from "@/components/AccountSelect";
import SortableTable from "@/components/SortableTable";
import SelectionBar from "@/components/copyads/SelectionBar";
import CopyAdsModal from "@/components/copyads/CopyAdsModal";
import { useAccounts } from "@/components/AccountProvider";
import styles from "@/styles/Home.module.css";

// Cross-account ad cloning: pick ads already running in one ad account and
// copy them — creative and all — into an ad set that already exists in a
// different ad account. Built for the common D2C-agency setup where the
// same Page runs ads out of several ad accounts. The destination ad set's
// own targeting/budget/campaign are untouched; this is a creative+ad clone,
// not a campaign migrator — see the feature's own plan for why that scope
// is enough. There's no other "browse every ad in an account" picker
// anywhere else in this app (every duplicate/launch flow starts from one
// already-on-screen ad), so this page's source-ads table is new.
export default function CopyAdsPage() {
  const { adAccounts, accountsError, selectedAccountId, setSelectedAccountId } = useAccounts();

  const [ads, setAds] = useState([]);
  const [adsLoading, setAdsLoading] = useState(false);
  const [adsError, setAdsError] = useState(null);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    if (!selectedAccountId) return;
    // Reacting to the source account changing (re-fetch its ads, drop any
    // selection that belonged to the previous account) — same shape as
    // every other account-scoped data load in this app.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAdsLoading(true);
    setAdsError(null);
    setSelectedIds(new Set());
    fetch(`/api/fb/copy-ads/source-ads?accountId=${encodeURIComponent(selectedAccountId)}`)
      .then((res) => res.json())
      .then((json) => {
        if (json.error) setAdsError(json.error);
        else setAds(json.ads || []);
      })
      .catch((err) => setAdsError(err.message))
      .finally(() => setAdsLoading(false));
  }, [selectedAccountId]);

  function toggle(adId, copyable) {
    if (!copyable) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(adId)) next.delete(adId);
      else next.add(adId);
      return next;
    });
  }

  const selectedAds = ads.filter((a) => selectedIds.has(a.id));

  const columns = [
    {
      key: "select",
      label: "",
      freezeExempt: true,
      maxWidth: 32,
      render: (row) => (
        <input
          type="checkbox"
          checked={selectedIds.has(row.id)}
          disabled={!row.copyable}
          onChange={() => toggle(row.id, row.copyable)}
          title={row.copyable ? undefined : row.reason}
        />
      ),
    },
    {
      key: "name",
      label: "Ad",
      maxWidth: 260,
      render: (row) => (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }} title={row.copyable ? undefined : row.reason}>
          <span style={{ fontWeight: 600, color: row.copyable ? undefined : "var(--t2)" }}>{row.name}</span>
          {!row.copyable && (
            <span className={styles.badgeWarn} style={{ width: "fit-content" }}>
              {row.reason}
            </span>
          )}
        </div>
      ),
    },
    { key: "campaignName", label: "Campaign", render: (row) => row.campaignName || "—" },
    { key: "adsetName", label: "Ad set", render: (row) => row.adsetName || "—" },
    {
      key: "status",
      label: "Status",
      render: (row) => <span className={row.effectiveStatus === "ACTIVE" ? styles.badgeGood : styles.badgeInfo}>{row.effectiveStatus || row.status}</span>,
    },
  ];

  return (
    <Layout>
      <Head>
        <title>Copy Ads · Facebook Auth Dashboard</title>
      </Head>
      <div className={styles.page}>
        <main className={styles.main} style={{ maxWidth: 1000, margin: "0 auto" }}>
          <h1 className={styles.h1}>Copy Ads Across Accounts</h1>
          <p className={styles.sub} style={{ marginTop: -8, marginBottom: 20 }}>
            Select ads running in one ad account and copy their creative into an ad set that already exists in a different ad
            account — the same Page, no retargeting needed.
          </p>

          {accountsError && <div className={styles.error}>Error loading ad accounts: {accountsError}</div>}

          <div className={styles.card} style={{ marginBottom: 20 }}>
            <p className={styles.sub} style={{ marginBottom: 6 }}>
              Source ad account
            </p>
            <AccountSelect accounts={adAccounts} value={selectedAccountId} onChange={setSelectedAccountId} placeholder="Select an ad account…" />
          </div>

          {!selectedAccountId && <p className={styles.sub}>Pick a source ad account above to see its ads.</p>}
          {adsLoading && <Loader label="Loading ads…" />}
          {adsError && <div className={styles.error}>{adsError}</div>}

          {!adsLoading && !adsError && selectedAccountId && (
            <SortableTable
              columns={columns}
              rows={ads}
              defaultSortKey="name"
              defaultSortDir="asc"
              searchable
              searchKeys={["name", "campaignName", "adsetName"]}
              emptyMessage="No ads found in this account."
            />
          )}
        </main>
      </div>

      <SelectionBar count={selectedAds.length} onClear={() => setSelectedIds(new Set())} onCopy={() => setModalOpen(true)} />

      {modalOpen && (
        <CopyAdsModal
          sourceAccountId={selectedAccountId}
          ads={selectedAds}
          adAccounts={adAccounts}
          onClose={() => setModalOpen(false)}
          onDone={(result) => {
            if (result?.createdAdIds?.length) {
              setSelectedIds((prev) => {
                const next = new Set(prev);
                for (const id of selectedAds.map((a) => a.id)) next.delete(id);
                return next;
              });
            }
          }}
        />
      )}
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
