import { useEffect } from "react";
import { CloseIcon } from "../icons";
import { firstPartnershipInfo, permissionState, formatCompactNumber } from "@/lib/partnershipContent";
import styles from "@/styles/Home.module.css";

function EngCell({ label, value }) {
  return (
    <div className={styles.card} style={{ padding: "8px 6px", textAlign: "center" }}>
      <p style={{ margin: 0, fontWeight: 800, fontSize: 14 }}>{formatCompactNumber(value)}</p>
      <p className={styles.muted} style={{ margin: 0, fontSize: 9, textTransform: "uppercase" }}>
        {label}
      </p>
    </div>
  );
}

// Read-only detail view for one piece of discovered content — the
// permission-request/queue actions below are disabled placeholders in this
// round (Explore Ads ships read-only first; see PROJECT_STATUS.md), wired up
// once the permission-request flow itself ships.
export default function ExpandedCardModal({ item, onClose }) {
  useEffect(() => {
    function handleKey(e) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  if (!item) return null;
  const info = firstPartnershipInfo(item);
  const permState = permissionState(item);
  const eng = item.organic_insights || {};
  const isVideo = item.media_type === "VIDEO";

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.65)",
        backdropFilter: "blur(6px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 800,
        padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={styles.card}
        style={{ background: "var(--bg)", width: "min(720px, 100%)", display: "flex", gap: 0, overflow: "hidden", padding: 0 }}
      >
        <div
          style={{
            flexShrink: 0,
            width: 240,
            position: "relative",
            background: "linear-gradient(135deg, rgba(var(--purple-rgb),0.18), rgba(244,52,157,0.12))",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <span style={{ fontSize: 36, opacity: 0.6 }}>{isVideo ? "▶" : "🖼"}</span>
        </div>
        <div style={{ flex: 1, minWidth: 0, padding: 22, maxHeight: "80vh", overflowY: "auto" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <h2 className={styles.h2} style={{ marginBottom: 4 }}>
                @{item.author?.display_name || "unknown"}
              </h2>
              <p className={styles.muted} style={{ margin: 0 }}>
                {isVideo ? "Video" : "Photo"} · {item.post_type || "feed"}
              </p>
            </div>
            <button type="button" onClick={onClose} aria-label="Close" className={styles.btnSecondary} style={{ padding: 6 }}>
              <CloseIcon size={14} />
            </button>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "14px 0" }}>
            {item.is_recommended ? <span className={styles.badgeInfo}>★ Recommended</span> : null}
            {permState === "ready" && <span className={styles.badgeGood}>✓ Launch Ready</span>}
            {permState === "requested" && <span className={styles.badgeWarn}>⏳ Permission Requested</span>}
            {permState === "need" && <span className={styles.badgeWarn}>⚠ Need Permission</span>}
          </div>

          <p className={styles.muted} style={{ marginBottom: 6, fontSize: 11, textTransform: "uppercase" }}>
            Engagement
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6, marginBottom: 16 }}>
            <EngCell label="Likes" value={eng.likes} />
            <EngCell label="Comments" value={eng.comments} />
            <EngCell label="Views" value={eng.views} />
            <EngCell label="Reach" value={eng.reach} />
          </div>

          {item.caption && (
            <div className={styles.card} style={{ padding: 12, marginBottom: 16, maxHeight: 90, overflowY: "auto" }}>
              <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.6, color: "var(--t2)" }}>{item.caption}</p>
            </div>
          )}

          {item.permalink && (
            <a href={item.permalink} target="_blank" rel="noreferrer" className={styles.sub} style={{ display: "block", marginBottom: 16 }}>
              View original post ↗
            </a>
          )}

          <button type="button" className={styles.btnPrimary} style={{ width: "100%" }} disabled title="Coming in a follow-up update">
            {permState === "ready" ? "Add to Queue" : permState === "requested" ? "Permission Requested" : "Request Permission"}
          </button>
        </div>
      </div>
    </div>
  );
}
