import Head from "next/head";
import Link from "next/link";
import { getServerSession } from "next-auth/next";
import { useEffect, useMemo, useState } from "react";
import { authOptions } from "../api/auth/[...nextauth]";
import Layout from "@/components/Layout";
import { useAccounts } from "@/components/AccountProvider";
import QueueList from "@/components/partnership/QueueList";
import LaunchWizardModal from "@/components/partnership/LaunchWizardModal";
import { getPartnershipQueue, setPartnershipQueue } from "@/lib/clientStorage";
import styles from "@/styles/Home.module.css";

// Ready to Launch: the pre-launch queue, a separate bookmarkable route
// (matching the mockup's own separate ready-to-launch.html file) rather than
// a 7th sub-nav tab on /partnership-ads. Reads the same account/IG-account
// selection via AccountProvider (shared across the app), so navigating here
// from /partnership-ads doesn't lose context.
export default function PartnershipAdsQueue() {
  // `selectedIgAccountId` — NOT independently recomputed from `pages` — is
  // the actual bug fix here. This page previously derived its own `igUserId`
  // via `pages.find((p) => p.instagram_business_account)?...` — the first
  // Page with any linked IG account, full stop — completely ignoring
  // whichever Instagram account the user actually had selected (and which
  // was therefore used for every Content Discovery call) back on
  // /partnership-ads when the item was queued. `lookupContent`'s
  // re-verification call in launch.js always scopes by `ig_user_id`, even in
  // ad-code lookup mode — a mismatched id there means Meta finds zero
  // results for an ad code/permalink that's perfectly real, surfacing as
  // "Content is no longer available or eligible" for every single queued
  // item regardless of how it was added. Reading the same shared selection
  // every other Partnership Ads page already uses fixes this at the source.
  const { adAccounts, pages, selectedAccountId, selectedIgAccountId } = useAccounts();
  const selectedAccount = useMemo(() => adAccounts.find((a) => a.id === selectedAccountId), [adAccounts, selectedAccountId]);
  const businessId = selectedAccount?.business?.id || null;

  const [items, setItems] = useState([]);
  const [checkedIds, setCheckedIds] = useState(new Set());
  const [wizardOpen, setWizardOpen] = useState(false);

  useEffect(() => {
    if (!selectedAccountId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time read of this account's localStorage queue when the account changes, not derivable from props/state
    setItems(getPartnershipQueue(selectedAccountId));
  }, [selectedAccountId]);

  function persist(next) {
    setItems(next);
    setPartnershipQueue(selectedAccountId, next);
  }

  function toggleCheck(id) {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function changeItem(id, patch) {
    persist(items.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  }

  function removeItem(id) {
    persist(items.filter((i) => i.id !== id));
    setCheckedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  function clearQueue() {
    persist([]);
    setCheckedIds(new Set());
  }

  const checkedItems = items.filter((i) => checkedIds.has(i.id));
  const checkedReady = checkedItems.filter((i) => i.primaryText?.trim() && i.redirectionLink?.trim());
  const canLaunch = checkedReady.length > 0 && checkedReady.length === checkedItems.length;

  // Only removes the items the launch endpoint actually reports as
  // succeeded (`result.succeededItemIds`, see pages/api/fb/partnership/launch.js)
  // and clears their checkboxes — does NOT close the wizard. LaunchWizardModal
  // stays open on its own result screen (step-by-step success/failure
  // breakdown) until the user clicks its own "Done" button; closing it here
  // instead would yank that screen away the instant the launch finishes,
  // before anyone can actually read it.
  //
  // Previously this removed every *checked* item regardless of outcome, but
  // was only ever called when the whole batch succeeded — so a batch with
  // even one failing item left every item, including the ones that
  // genuinely created a live ad, stuck in the queue. Now it's called on
  // every launch attempt and only clears the ones that actually succeeded,
  // leaving real failures in place for the user to fix and retry.
  function handleLaunched(result) {
    const succeededIds = new Set(result?.succeededItemIds || []);
    if (succeededIds.size === 0) return;
    persist(items.filter((i) => !succeededIds.has(i.id)));
    setCheckedIds((prev) => {
      const next = new Set(prev);
      for (const id of succeededIds) next.delete(id);
      return next;
    });
  }

  return (
    <Layout>
      <Head>
        <title>Ready to Launch · Facebook Auth Dashboard</title>
      </Head>
      <div className={styles.page}>
        <main className={styles.main} style={{ maxWidth: 1000, margin: "0 auto" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
            <div>
              <h1 className={styles.h1}>Ready to Launch</h1>
              <p className={styles.sub} style={{ marginTop: -4 }}>
                {items.length} ad{items.length === 1 ? "" : "s"} in queue
              </p>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              {items.length > 0 && (
                <button type="button" className={styles.btnSecondary} onClick={clearQueue}>
                  Clear All
                </button>
              )}
              <Link href="/partnership-ads" className={styles.btnSecondary}>
                + Add Ads
              </Link>
            </div>
          </div>

          {!selectedAccountId ? (
            <p className={styles.sub}>Pick an ad account on the Partnership Ads page first.</p>
          ) : (
            <>
              <QueueList items={items} checkedIds={checkedIds} onToggleCheck={toggleCheck} onChangeItem={changeItem} onRemoveItem={removeItem} />

              <div style={{ position: "sticky", bottom: 0, background: "var(--bg)", padding: "14px 0", marginTop: 16, borderTop: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <p className={styles.sub} style={{ margin: 0 }}>
                  {checkedIds.size === 0
                    ? "Select ads above to launch"
                    : canLaunch
                    ? `${checkedIds.size} of ${items.length} ads selected`
                    : "Every selected ad needs Primary Text and a Redirection Link before launching"}
                </p>
                <button type="button" className={styles.btnPrimary} onClick={() => setWizardOpen(true)} disabled={!canLaunch}>
                  Launch Selected Ads
                </button>
              </div>
            </>
          )}
        </main>
      </div>

      {wizardOpen && (
        <LaunchWizardModal
          accountId={selectedAccountId}
          businessId={businessId}
          igUserId={selectedIgAccountId}
          pages={pages}
          items={checkedItems}
          onClose={() => setWizardOpen(false)}
          onLaunched={handleLaunched}
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
