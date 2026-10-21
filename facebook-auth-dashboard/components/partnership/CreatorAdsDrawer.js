import { CloseIcon } from "../icons";
import CreatorAvatar from "./CreatorAvatar";
import { formatMetricValue, humanizeStatus } from "@/lib/insightsMetrics";
import styles from "@/styles/Home.module.css";

// A creator's own ads, in a side drawer — reuses this app's existing
// .drawerOverlay/.drawerPanel classes (already used by
// components/EntityChangesDrawer.js and EntityDetailDrawer.js) rather than
// the mockup's own bespoke .cha-overlay/.cha-modal. Deliberately does NOT
// include the mockup's "Hook Type / Storytelling Style / Visual Style /
// Product Interaction" fields — those were 100% fabricated in the mockup
// (hashed off the ad id into a fixed word list) with no real Meta API
// equivalent, dropped per explicit decision rather than faked here.
export default function CreatorAdsDrawer({ creator, currency, onClose }) {
  if (!creator) return null;
  return (
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

        <div style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 10 }}>
          {creator.ads.map((ad) => (
            <div key={ad.adId} className={styles.card} style={{ padding: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                <p style={{ margin: 0, fontWeight: 700, fontSize: 13 }}>{ad.name}</p>
                <span className={ad.status === "ACTIVE" ? styles.badgeGood : styles.badgeInfo}>{humanizeStatus(ad.status)}</span>
              </div>
              <p className={styles.muted} style={{ margin: "4px 0 0", fontSize: 11 }}>
                {ad.campaignName} · {ad.adsetName}
              </p>
              <p className={styles.sub} style={{ margin: "8px 0 0" }}>
                Spend: <strong style={{ color: "var(--t1)" }}>{formatMetricValue(ad.spend, "currency", currency)}</strong> · ROAS:{" "}
                <strong style={{ color: "var(--t1)" }}>{formatMetricValue(ad.roas, "decimal")}</strong>
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
