import { permissionState, formatCompactNumber } from "@/lib/partnershipContent";
import ContentPreviewMedia from "./ContentPreviewMedia";
import CreatorAvatar from "./CreatorAvatar";
import styles from "@/styles/Home.module.css";

export default function PartnerCard({ item, igUserId, selected, onToggleSelect, onExpand }) {
  const permState = permissionState(item, igUserId);
  const isOwnPost = permState === "own";
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
          {!selected && !isOwnPost && (
            <div className={styles.partnerCardSelectCta}>
              <span className={styles.partnerCardSelectCtaPill}>✓ Select</span>
            </div>
          )}
        </div>
        {item.is_recommended && <span className={`${styles.partnerCardBadge} ${styles.partnerCardStar}`}>★</span>}
        {isOwnPost ? (
          // Your own account's post — Meta rejects this at launch regardless
          // of permission_status ("@handle isn't a partner of @handle"),
          // since a Partnership Ad requires being tagged as a partner on
          // someone ELSE's content. Distinct from "need permission" — there
          // is no permission to request here, it's categorically ineligible.
          <span className={`${styles.partnerCardBadge} ${styles.partnerCardPermNeed}`} title="Your own post — can't become a Partnership Ad">
            🚫
          </span>
        ) : (
          permState !== "ready" && (
            <span
              className={`${styles.partnerCardBadge} ${permState === "requested" ? styles.partnerCardPermRequested : styles.partnerCardPermNeed}`}
              title={permState === "requested" ? "Permission requested" : "Permission needed"}
            >
              {permState === "requested" ? "⏳" : "🔒"}
            </span>
          )
        )}
        {selected && permState === "ready" && (
          <span className={`${styles.partnerCardBadge} ${styles.partnerCardPermReady}`} title="Selected — ready to launch">
            ✓
          </span>
        )}
        <div className={styles.partnerCardCreator}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
            {/* CONTENT_FIELDS (lib/partnershipAds.js) already fetches
                `author.profile_picture_url` — this card was the only
                Partnership Ads surface still rendering a generated color-dot
                instead of it (every other tab — My Ads, Creator Hub, the
                Creator Ads drawer — already uses CreatorAvatar). Reported by
                the user as "unable to load profile images," which wasn't a
                network/permission failure, just this card never asking for
                the real image in the first place. */}
            <CreatorAvatar
              src={item.author?.profile_picture_url}
              username={handle}
              size={20}
              style={{ border: "1.5px solid rgba(255,255,255,.32)" }}
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
