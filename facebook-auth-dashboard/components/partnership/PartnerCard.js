import { permissionState, formatCompactNumber } from "@/lib/partnershipContent";
import ContentPreviewMedia from "./ContentPreviewMedia";
import styles from "@/styles/Home.module.css";

// Deterministic (not random) avatar color from a creator handle, same
// "small fixed palette hashed off a string" idea used for a few other
// generated-avatar spots in this app (e.g. Sidebar's own initials circle).
const AVATAR_COLORS = ["#AF46FD", "#F4349D", "#F97316", "#22C55E", "#3B82F6", "#EAB308"];
function colorFor(seed) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) % AVATAR_COLORS.length;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

export default function PartnerCard({ item, selected, onToggleSelect, onExpand }) {
  const permState = permissionState(item);
  const isVideo = item.media_type === "VIDEO";
  const handle = item.author?.display_name || "unknown";
  const views = item.organic_insights?.views ?? item.organic_insights?.reach;

  // A plain <button> here would nest the "Details" <button> and the "View
  // post" <a> inside it — invalid HTML (see pages/recent-changes.js's
  // EntityRow for the same fix after the same mistake shipped there once
  // already). A div with button semantics keeps the whole card clickable and
  // keyboard-operable without that nesting.
  return (
    <div
      role="button"
      tabIndex={0}
      className={styles.partnerCard}
      onClick={() => onToggleSelect?.(item.content_id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggleSelect?.(item.content_id);
        }
      }}
      aria-pressed={!!selected}
      style={selected ? { borderColor: "var(--purple)", boxShadow: "0 0 0 2px rgba(var(--purple-rgb), 0.3)" } : undefined}
    >
      <div style={{ position: "relative" }}>
        <div className={styles.partnerCardMedia} style={{ aspectRatio: isVideo ? "9 / 16" : "4 / 5" }}>
          <ContentPreviewMedia contentId={item.content_id} permalink={item.permalink} mediaType={item.media_type} variant="card" />
          <div className={styles.partnerCardGrad} />
          {!selected && (
            <div className={styles.partnerCardSelectCta}>
              <span className={styles.partnerCardSelectCtaPill}>✓ Select</span>
            </div>
          )}
        </div>
        {item.is_recommended && <span className={`${styles.partnerCardBadge} ${styles.partnerCardStar}`}>★</span>}
        {permState !== "ready" && (
          <span
            className={`${styles.partnerCardBadge} ${permState === "requested" ? styles.partnerCardPermRequested : styles.partnerCardPermNeed}`}
            title={permState === "requested" ? "Permission requested" : "Permission needed"}
          >
            {permState === "requested" ? "⏳" : "🔒"}
          </span>
        )}
        {selected && permState === "ready" && (
          <span className={`${styles.partnerCardBadge} ${styles.partnerCardPermReady}`} title="Selected — ready to launch">
            ✓
          </span>
        )}
        <div className={styles.partnerCardCreator}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
            <span
              style={{
                width: 20,
                height: 20,
                borderRadius: "50%",
                flexShrink: 0,
                background: colorFor(handle),
                border: "1.5px solid rgba(255,255,255,.32)",
              }}
            />
            <span className={styles.partnerCardHandle}>@{handle}</span>
          </div>
          {typeof views === "number" && (
            <span className={styles.partnerCardEngPill}>{formatCompactNumber(views)} views</span>
          )}
        </div>
      </div>
      <div style={{ padding: "8px 10px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onExpand?.(item);
          }}
          className={styles.btnSecondary}
          style={{ padding: "3px 8px", fontSize: 11 }}
        >
          Details
        </button>
        {item.permalink && (
          <a
            href={item.permalink}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className={styles.muted}
            style={{ fontSize: 11 }}
          >
            View post ↗
          </a>
        )}
      </div>
    </div>
  );
}
