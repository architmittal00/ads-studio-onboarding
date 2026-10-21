import { useEffect, useState } from "react";
import { CloseIcon } from "../icons";
import ContentPreviewMedia from "./ContentPreviewMedia";
import { firstPartnershipInfo, permissionState, formatCompactNumber } from "@/lib/partnershipContent";
import { addPermissionRequestLogEntry, addToPartnershipQueue } from "@/lib/clientStorage";
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

// Read-only detail view for one piece of discovered content, plus its two
// real actions: requesting branded-content permission (inline, no separate
// confirm modal stacked on top — this view already shows everything a
// confirm step would), and queuing it for launch once ready.
export default function ExpandedCardModal({ item, accountId, igUserId, onClose, onPermissionRequested, onQueued }) {
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [queued, setQueued] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    function handleKey(e) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  // Resets the inline confirm/sent state whenever a different card is opened
  // — this component isn't remounted between cards (no `key` at the call
  // site), so a previous card's "Sent" state shouldn't carry over.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- genuine reset of this modal's own confirm/sent state when a different card opens, not derivable from render
    setSending(false);
    setSent(false);
    setQueued(false);
    setError(null);
  }, [item?.content_id]);

  if (!item) return null;
  const info = firstPartnershipInfo(item);
  const permState = permissionState(item);
  const eng = item.organic_insights || {};
  const isVideo = item.media_type === "VIDEO";
  const creatorIgId = item.author?.ig_user_id;
  const creatorUsername = item.author?.display_name;

  function handleAddToQueue() {
    if (queued) return;
    addToPartnershipQueue(accountId, [
      {
        id: `explore_${item.content_id}`,
        source: "explore",
        contentId: item.content_id,
        adCode: info.ad_code,
        name: `@${item.author?.display_name || "unknown"} — ${item.caption?.slice(0, 40) || item.content_id}`,
        mediaType: item.media_type,
        permalink: item.permalink,
        // Defaults to the post's own caption (reported by the user as the
        // sensible starting point) rather than always starting blank — still
        // fully editable afterward from the queue's own per-item editor
        // (components/partnership/QueueList.js).
        primaryText: item.caption || "",
        headline: "",
        description: "",
        cta: "SHOP_NOW",
        redirectionLink: "",
      },
    ]);
    setQueued(true);
    onQueued?.();
  }

  async function handleRequestPermission() {
    if (sending || !creatorIgId) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/fb/partnership/request-permission", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ igUserId, creatorIgId, creatorUsername }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Request failed");
      addPermissionRequestLogEntry(igUserId, {
        creatorIgId,
        creatorUsername,
        contentId: item.content_id,
        brandName: item.author?.display_name,
        mediaType: item.media_type,
        requestedAt: new Date().toISOString(),
      });
      setSent(true);
      onPermissionRequested?.(item.content_id);
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  }

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
        <div style={{ flexShrink: 0, width: 240, position: "relative" }}>
          <ContentPreviewMedia contentId={item.content_id} permalink={item.permalink} mediaType={item.media_type} variant="detail" />
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
            {(sent || permState === "ready") && <span className={styles.badgeGood}>✓ Launch Ready</span>}
            {!sent && permState === "requested" && <span className={styles.badgeWarn}>⏳ Permission Requested</span>}
            {!sent && permState === "need" && <span className={styles.badgeWarn}>⚠ Need Permission</span>}
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

          {error && (
            <div className={styles.error} style={{ marginBottom: 10 }}>
              {error}
            </div>
          )}

          {permState === "ready" ? (
            <button type="button" className={styles.btnPrimary} style={{ width: "100%" }} onClick={handleAddToQueue} disabled={queued}>
              {queued ? "Added to Queue ✓" : "Add to Queue"}
            </button>
          ) : sent || permState === "requested" ? (
            <button type="button" className={styles.btnSecondary} style={{ width: "100%" }} disabled>
              {sent ? "Request Sent ✓" : "Permission Requested"}
            </button>
          ) : (
            <button type="button" className={styles.btnPrimary} style={{ width: "100%" }} onClick={handleRequestPermission} disabled={sending || !creatorIgId}>
              {sending ? "Sending…" : "Request Permission"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
