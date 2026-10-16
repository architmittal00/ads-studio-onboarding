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
import { RANGE_PRESETS, computeRange } from "@/lib/dateRanges";
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

  // Defaults to a bounded window rather than "every ad ever" — an
  // unfiltered account-wide pull with this picker's heavy per-ad creative
  // fields is exactly what triggers Meta's "Please reduce the amount of
  // data you're asking for" error on any account with real history. `range`
  // resolves to `null` only while "Custom" is picked and one of the two
  // date inputs is still empty, in which case the fetch effect below just
  // waits rather than firing with a half-filled range.
  const [rangePreset, setRangePreset] = useState("last_90d");
  const [customSince, setCustomSince] = useState("");
  const [customUntil, setCustomUntil] = useState("");
  const range = computeRange(rangePreset, customSince, customUntil);

  useEffect(() => {
    if (!selectedAccountId || !range) return;
    // Reacting to the source account or date range changing (re-fetch its
    // ads, drop any selection that belonged to the previous account/range)
    // — same shape as every other account-scoped data load in this app.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAdsLoading(true);
    setAdsError(null);
    setSelectedIds(new Set());
    const params = new URLSearchParams({ accountId: selectedAccountId, since: range.since, until: range.until });
    fetch(`/api/fb/copy-ads/source-ads?${params.toString()}`)
      .then((res) => res.json())
      .then((json) => {
        if (json.error) setAdsError(json.error);
        else setAds(json.ads || []);
      })
      .catch((err) => setAdsError(err.message))
      .finally(() => setAdsLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately keyed on range's two resolved fields, not the `range` object itself, which is a plain `const` recomputed fresh every render and would otherwise re-fire this effect on every unrelated re-render
  }, [selectedAccountId, range?.since, range?.until]);

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

          <div className={styles.card} style={{ marginBottom: 20, display: "flex", gap: 20, flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 240px" }}>
              <p className={styles.sub} style={{ marginBottom: 6 }}>
                Source ad account
              </p>
              <AccountSelect accounts={adAccounts} value={selectedAccountId} onChange={setSelectedAccountId} placeholder="Select an ad account…" />
            </div>
            <div style={{ flex: "1 1 240px" }}>
              <p className={styles.sub} style={{ marginBottom: 6 }}>
                Only show ads active in
              </p>
              <div style={{ display: "flex", gap: 8 }}>
                <select className={styles.select} value={rangePreset} onChange={(e) => setRangePreset(e.target.value)}>
                  {RANGE_PRESETS.map((p) => (
                    <option key={p.key} value={p.key}>
                      {p.label}
                    </option>
                  ))}
                </select>
                {rangePreset === "custom" && (
                  <>
                    <input type="date" className={styles.select} value={customSince} onChange={(e) => setCustomSince(e.target.value)} />
                    <input type="date" className={styles.select} value={customUntil} onChange={(e) => setCustomUntil(e.target.value)} />
                  </>
                )}
              </div>
            </div>
          </div>

          {!selectedAccountId && <p className={styles.sub}>Pick a source ad account above to see its ads.</p>}
          {selectedAccountId && !range && <p className={styles.sub}>Pick both custom dates above to load ads.</p>}
          {adsLoading && <Loader label="Loading ads…" />}
          {adsError && (
            <div className={styles.error}>
              {adsError}
              {adsError.toLowerCase().includes("reduce the amount of data") && " — try a narrower date range above."}
            </div>
          )}

          {!adsLoading && !adsError && selectedAccountId && range && (
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
