import { useState } from "react";
import CodeEntryCard from "./CodeEntryCard";
import CsvUploadCard from "./CsvUploadCard";
import FetchPreviewModal from "./FetchPreviewModal";
import LaunchWizardModal from "./LaunchWizardModal";
import { addToPartnershipQueue } from "@/lib/clientStorage";
import styles from "@/styles/Home.module.css";

// Partnership Code: resolve a specific piece of content by its ad_code
// (Meta's own "boost post access token" for branded content, per the
// reference implementation) or permalink rather than browsing for it —
// single lookup or bulk CSV. A single lookup can either be queued (same
// launch queue Explore Ads feeds) or launched immediately via the same
// 3-step LaunchWizardModal the queue's own "Launch Selected Ads" uses,
// passed just this one item — no need to round-trip through the queue
// first if the user already knows exactly what they want to launch.
export default function PartnershipCodeTab({ accountId, businessId, igUserId, pages, ready, onQueueChanged }) {
  const [previewItem, setPreviewItem] = useState(null);
  const [launchItem, setLaunchItem] = useState(null);
  const [toast, setToast] = useState(null);

  function handleQueuedOne(item) {
    const added = addToPartnershipQueue(accountId, [item]);
    onQueueChanged?.();
    if (added > 0) {
      setToast(`${item.name} added to queue`);
      setTimeout(() => setToast(null), 2500);
    }
  }

  function handleQueuedMany(items) {
    const added = addToPartnershipQueue(accountId, items);
    onQueueChanged?.();
    setToast(`${added} ad${added === 1 ? "" : "s"} added to queue`);
    setTimeout(() => setToast(null), 2500);
  }

  if (!ready) {
    return <p className={styles.sub}>Pick an ad account and Instagram Business Account above to see this.</p>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <CodeEntryCard businessId={businessId} igUserId={igUserId} onResolved={setPreviewItem} />
      <CsvUploadCard businessId={businessId} igUserId={igUserId} onQueued={handleQueuedMany} />

      <FetchPreviewModal
        item={previewItem}
        onClose={() => setPreviewItem(null)}
        onAddToQueue={(item) => {
          handleQueuedOne(item);
        }}
        onLaunchNow={(item) => {
          setPreviewItem(null);
          setLaunchItem(item);
        }}
      />

      {launchItem && (
        <LaunchWizardModal
          accountId={accountId}
          businessId={businessId}
          igUserId={igUserId}
          pages={pages}
          items={[launchItem]}
          onClose={() => setLaunchItem(null)}
        />
      )}

      {toast && (
        <div
          className={styles.pvToast}
          style={{
            position: "fixed",
            bottom: 24,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 900,
            background: "var(--bg)",
            border: "1px solid rgba(34,197,94,.4)",
            borderRadius: 12,
            padding: "11px 20px",
            boxShadow: "var(--shadow-md)",
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          ✓ {toast}
        </div>
      )}
    </div>
  );
}
