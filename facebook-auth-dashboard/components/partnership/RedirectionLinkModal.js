import { useEffect, useState } from "react";
import { CloseIcon } from "../icons";
import styles from "@/styles/Home.module.css";

// Shown the moment an Explore Ads selection (one card or many) is added to
// the queue — captures each item's destination (redirection) link up front,
// reported by the user as missing entirely: previously every Explore-added
// item landed in the queue with `redirectionLink: ""`, silently stuck on
// "Needs copy" until someone opened it back up on the Ready to Launch page
// (components/partnership/QueueList.js) and typed it in there instead.
// "One Link for All" covers the common case of one landing page for the
// whole batch; "Individual Links" lets each item get its own, matching the
// reference "Set Landing Page Links" pattern the user pointed to. Skipping
// is always allowed — QueueList's own per-item editor still requires a link
// before launch, this is just a friendlier way to set it at add-time instead
// of always deferring to then.
export default function RedirectionLinkModal({ items, onSkip, onSave }) {
  const [mode, setMode] = useState("all");
  const [sharedLink, setSharedLink] = useState("");
  const [links, setLinks] = useState({});

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resetting this modal's own form state for a newly-opened selection, not derivable from render
    setMode("all");
    setSharedLink("");
    setLinks({});
  }, [items]);

  if (!items || items.length === 0) return null;

  function handleSave() {
    const resolved = {};
    for (const item of items) {
      resolved[item.id] = (mode === "all" ? sharedLink : links[item.id] || "").trim();
    }
    onSave(resolved);
  }

  return (
    <div
      onClick={onSkip}
      className={styles.pvModalOverlay}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.65)",
        backdropFilter: "blur(6px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 850,
        padding: 24,
      }}
    >
      <div onClick={(e) => e.stopPropagation()} className={`${styles.card} ${styles.pvModalCard}`} style={{ background: "var(--bg)", width: "min(520px, 100%)", padding: 22 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
          <div>
            <h2 className={styles.h2} style={{ marginBottom: 2 }}>
              Set Landing Page Link{items.length === 1 ? "" : "s"}
            </h2>
            <p className={styles.muted} style={{ margin: 0, fontSize: 12 }}>
              {items.length} ad{items.length === 1 ? "" : "s"} selected
            </p>
          </div>
          <button type="button" onClick={onSkip} aria-label="Close" className={styles.btnSecondary} style={{ padding: 6 }}>
            <CloseIcon size={14} />
          </button>
        </div>

        {items.length > 1 && (
          <div className={styles.tabGroup} style={{ margin: "14px 0" }}>
            <button type="button" className={mode === "all" ? `${styles.tab} ${styles.tabActive}` : styles.tab} onClick={() => setMode("all")}>
              One Link for All
            </button>
            <button type="button" className={mode === "individual" ? `${styles.tab} ${styles.tabActive}` : styles.tab} onClick={() => setMode("individual")}>
              Individual Links
            </button>
          </div>
        )}

        {mode === "all" ? (
          <div style={{ marginTop: items.length > 1 ? 0 : 14 }}>
            <label className={styles.muted} style={{ fontSize: 11 }}>
              Landing Page Link
            </label>
            <input
              className={styles.select}
              style={{ width: "100%" }}
              value={sharedLink}
              onChange={(e) => setSharedLink(e.target.value)}
              placeholder="https://yourbrand.com/product"
              autoFocus
            />
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, maxHeight: 280, overflowY: "auto" }}>
            {items.map((item) => (
              <div key={item.id}>
                <label
                  className={styles.muted}
                  style={{ fontSize: 11, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                >
                  {item.name}
                </label>
                <input
                  className={styles.select}
                  style={{ width: "100%" }}
                  value={links[item.id] || ""}
                  onChange={(e) => setLinks((prev) => ({ ...prev, [item.id]: e.target.value }))}
                  placeholder="https://yourbrand.com/product"
                />
              </div>
            ))}
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 20 }}>
          <button type="button" className={styles.btnSecondary} onClick={onSkip}>
            Skip &amp; Add Selection
          </button>
          <button type="button" className={styles.btnPrimary} onClick={handleSave}>
            Save &amp; Add Selection
          </button>
        </div>
      </div>
    </div>
  );
}
