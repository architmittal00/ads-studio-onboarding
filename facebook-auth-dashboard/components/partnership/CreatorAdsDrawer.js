import { useState } from "react";
import { CloseIcon } from "../icons";
import Thumb from "@/components/Thumb";
import CreativeLightbox from "@/components/CreativeLightbox";
import CreatorAvatar from "./CreatorAvatar";
import { formatMetricValue, humanizeStatus } from "@/lib/insightsMetrics";
import styles from "@/styles/Home.module.css";

// Same 7 metrics, same formatting, as My Partnership Ads' own table
// (components/partnership/MyAdsTab.js's columns()) — this drawer is just a
// per-creator slice of the exact same ad objects, so a metric visible out
// there should be visible in here too, not a reduced "spend + ROAS only"
// summary.
const METRICS = [
  { key: "spend", label: "Spend", format: "currency" },
  { key: "roas", label: "ROAS", format: "decimal" },
  { key: "cpr", label: "CPR", format: "currency" },
  { key: "cpm", label: "CPM", format: "currency" },
  { key: "ctr", label: "CTR", format: "percent" },
  { key: "purchases", label: "Purchases", format: "number" },
  { key: "purchaseValue", label: "Purchase Value", format: "currency" },
];

function MiniStat({ label, value }) {
  return (
    <div style={{ minWidth: 0 }}>
      <p className={styles.muted} style={{ margin: 0, fontSize: 9.5, textTransform: "uppercase", letterSpacing: 0.3 }}>
        {label}
      </p>
      <p style={{ margin: "1px 0 0", fontSize: 12.5, fontWeight: 700, color: "var(--t1)", overflowWrap: "anywhere" }}>{value}</p>
    </div>
  );
}

// A creator's own ads, in a side drawer — reuses this app's existing
// .drawerOverlay/.drawerPanel classes (already used by
// components/EntityChangesDrawer.js and EntityDetailDrawer.js) rather than
// the mockup's own bespoke .cha-overlay/.cha-modal. Deliberately does NOT
// include the mockup's "Hook Type / Storytelling Style / Visual Style /
// Product Interaction" fields — those were 100% fabricated in the mockup
// (hashed off the ad id into a fixed word list) with no real Meta API
// equivalent, dropped per explicit decision rather than faked here.
//
// Each ad here is the exact same object My Partnership Ads' own table rows
// are (lib/partnershipCreatorStats.js's groupByCreator just buckets them by
// creator, nothing is dropped) — so the thumbnail + full metric set shown
// out there is reused here verbatim, not reinvented as a smaller summary.
export default function CreatorAdsDrawer({ creator, currency, onClose }) {
  const [lightboxItem, setLightboxItem] = useState(null);
  if (!creator) return null;

  return (
    <>
      <div className={styles.drawerOverlay} onClick={onClose}>
        <div className={styles.drawerPanel} onClick={(e) => e.stopPropagation()} style={{ width: "min(560px, 100vw)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <CreatorAvatar src={creator.creatorProfilePictureUrl} username={creator.creatorUsername || creator.key} size={36} />
              <div>
                <p className={styles.muted} style={{ marginBottom: 2 }}>
                  Creator
                </p>
                <h2 className={styles.h2} style={{ margin: 0 }}>
                  @{creator.creatorUsername || creator.key}
                </h2>
                {creator.creatorFollowersCount != null && (
                  <p className={styles.muted} style={{ margin: "2px 0 0", fontSize: 11 }}>
                    {formatMetricValue(creator.creatorFollowersCount, "number")} followers
                  </p>
                )}
              </div>
            </div>
            <button type="button" onClick={onClose} aria-label="Close" className={styles.btnSecondary} style={{ padding: 6 }}>
              <CloseIcon size={14} />
            </button>
          </div>

          <p className={styles.sub} style={{ margin: "16px 0 0" }}>
            {creator.adCount} ad{creator.adCount === 1 ? "" : "s"}
          </p>

          <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 10 }}>
            {creator.ads.map((ad) => (
              <div key={ad.adId} className={styles.card} style={{ padding: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <Thumb src={ad.thumbnailUrl} size={40} onClick={() => setLightboxItem(ad)} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                      <p style={{ margin: 0, fontWeight: 700, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {ad.name}
                      </p>
                      <span className={ad.status === "ACTIVE" ? styles.badgeGood : styles.badgeInfo} style={{ flexShrink: 0 }}>
                        {humanizeStatus(ad.status)}
                      </span>
                    </div>
                    <p
                      className={styles.muted}
                      style={{ margin: "2px 0 0", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                    >
                      {ad.campaignName} · {ad.adsetName}
                    </p>
                  </div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(72px, 1fr))", gap: 10, marginTop: 12 }}>
                  {METRICS.map((m) => (
                    <MiniStat key={m.key} label={m.label} value={formatMetricValue(ad[m.key], m.format, currency)} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <CreativeLightbox
        item={lightboxItem ? { id: lightboxItem.adId, name: lightboxItem.name, thumbnailUrl: lightboxItem.thumbnailUrl } : null}
        onClose={() => setLightboxItem(null)}
      />
    </>
  );
}
