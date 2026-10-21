import { useState } from "react";
import { CloseIcon } from "../icons";
import ContentPreviewMedia from "./ContentPreviewMedia";
import { firstPartnershipInfo } from "@/lib/partnershipContent";
import styles from "@/styles/Home.module.css";

// Matches ready-to-launch.html's own CTA dropdown options, mapped to Meta's
// real CallToActionType enum values (the mockup only ever showed display
// labels, never the actual API strings).
const CTA_OPTIONS = [
  { value: "SHOP_NOW", label: "Shop Now" },
  { value: "LEARN_MORE", label: "Learn More" },
  { value: "SIGN_UP", label: "Sign Up" },
  { value: "GET_OFFER", label: "Get Offer" },
  { value: "BOOK_NOW", label: "Book Now" },
];

// Pre-launch editor — shown after a successful Partnership Code lookup
// (single fetch or one row of a CSV batch). Unlike the mockup, "Landing
// Page" is an editable required field, not a disabled "Fixed" one: the
// mockup's hardcoded per-code landing URLs have no real Meta API backing
// (the destination link is something an advertiser sets when creating the
// ad, Content Discovery doesn't return one) — faking a "fixed" value here
// would just be a different flavor of the same problem as the dropped
// AI-copy fields. "AI-Powered Ad Copies" is a visible, disabled "Coming
// soon" affordance for the same reason — no real backing copy-generation
// service exists anywhere in the reference material this was built from.
export default function FetchPreviewModal({ item, onClose, onAddToQueue }) {
  const [primaryText, setPrimaryText] = useState("");
  const [headline, setHeadline] = useState("");
  const [description, setDescription] = useState("");
  const [cta, setCta] = useState(CTA_OPTIONS[0].value);
  const [redirectionLink, setRedirectionLink] = useState("");
  const [added, setAdded] = useState(false);

  if (!item) return null;
  const info = firstPartnershipInfo(item);
  const canAdd = redirectionLink.trim().length > 0 && primaryText.trim().length > 0;

  function handleAdd() {
    if (!canAdd) return;
    onAddToQueue({
      id: `code_${item.content_id}`,
      source: "code",
      contentId: item.content_id,
      adCode: info.ad_code,
      name: `@${item.author?.display_name || "unknown"} — ${info.ad_code || item.content_id}`,
      mediaType: item.media_type,
      permalink: item.permalink,
      primaryText: primaryText.trim(),
      headline: headline.trim(),
      description: description.trim(),
      cta,
      redirectionLink: redirectionLink.trim(),
    });
    setAdded(true);
  }

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.65)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 800, padding: 24 }}
    >
      <div onClick={(e) => e.stopPropagation()} className={styles.card} style={{ background: "var(--bg)", width: "min(640px, 100%)", display: "flex", gap: 0, overflow: "hidden", padding: 0 }}>
        <div style={{ flexShrink: 0, width: 240, position: "relative" }}>
          <ContentPreviewMedia contentId={item.content_id} permalink={item.permalink} mediaType={item.media_type} variant="detail" />
        </div>
        <div style={{ flex: 1, minWidth: 0, padding: 20, maxHeight: "80vh", overflowY: "auto" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
            <div>
              <span className={styles.badgeGood} style={{ marginBottom: 6, display: "inline-block" }}>
                ✓ Launch Ready
              </span>
              <h2 className={styles.h2} style={{ marginTop: 2 }}>
                @{item.author?.display_name || "unknown"}
              </h2>
              <p className={styles.muted} style={{ margin: 0 }}>Code: {info.ad_code}</p>
            </div>
            <button type="button" onClick={onClose} aria-label="Close" className={styles.btnSecondary} style={{ padding: 6 }}>
              <CloseIcon size={14} />
            </button>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div>
              <label className={styles.muted} style={{ fontSize: 11 }}>
                Primary Text
              </label>
              <textarea className={styles.select} style={{ width: "100%", minHeight: 60 }} value={primaryText} onChange={(e) => setPrimaryText(e.target.value)} placeholder="Enter primary text..." />
            </div>
            <div>
              <label className={styles.muted} style={{ fontSize: 11 }}>
                Headline
              </label>
              <input className={styles.select} style={{ width: "100%" }} value={headline} onChange={(e) => setHeadline(e.target.value)} placeholder="Enter headline..." />
            </div>
            <div>
              <label className={styles.muted} style={{ fontSize: 11 }}>
                Description
              </label>
              <textarea className={styles.select} style={{ width: "100%", minHeight: 50 }} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Enter description..." />
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <div style={{ flex: 1 }}>
                <label className={styles.muted} style={{ fontSize: 11 }}>
                  CTA
                </label>
                <select className={styles.select} style={{ width: "100%" }} value={cta} onChange={(e) => setCta(e.target.value)}>
                  {CTA_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <div style={{ flex: 2 }}>
                <label className={styles.muted} style={{ fontSize: 11 }}>
                  Redirection Link <span style={{ color: "var(--red)" }}>*</span>
                </label>
                <input
                  className={styles.select}
                  style={{ width: "100%" }}
                  value={redirectionLink}
                  onChange={(e) => setRedirectionLink(e.target.value)}
                  placeholder="https://..."
                />
              </div>
            </div>
            <button type="button" className={styles.btnSecondary} disabled title="Coming soon">
              ✨ AI-Powered Ad Copies
            </button>
          </div>

          <button
            type="button"
            className={styles.btnPrimary}
            style={{ width: "100%", marginTop: 16 }}
            onClick={handleAdd}
            disabled={!canAdd || added}
          >
            {added ? "Added to Queue ✓" : "Add to Queue"}
          </button>
        </div>
      </div>
    </div>
  );
}
