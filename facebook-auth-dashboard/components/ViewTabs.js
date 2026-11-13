import { useState } from "react";
import { CloseIcon } from "@/components/icons";
import styles from "@/styles/Home.module.css";

// Browser-style tab strip for pages that keep several independent views open at once (Recommendations
// today). Same look and behaviour as the Custom Views strip on /explore: click to switch, double-click to
// rename, x to close (never the last one), "+" to open another. The page owns the tabs and what each shows;
// this only draws the strip. Tab groups (Custom Views) are not part of it.
//
// tabs: [{ id, title, loading? }]
export default function ViewTabs({ tabs, activeId, onSelect, onAdd, onClose, onRename, addTitle = "New tab", sticky = true }) {
  const [renamingId, setRenamingId] = useState(null);
  const [draft, setDraft] = useState("");

  function startRename(tab) {
    setRenamingId(tab.id);
    setDraft(tab.title);
  }
  function commitRename() {
    if (renamingId) onRename?.(renamingId, draft.trim());
    setRenamingId(null);
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-end",
        gap: 6,
        flexWrap: "wrap",
        position: sticky ? "sticky" : "static",
        top: 0,
        zIndex: 5,
        background: "var(--bg)",
        paddingTop: 8,
        paddingBottom: 2,
      }}
    >
      {tabs.map((tab) => {
        const isActive = tab.id === activeId;
        const isRenaming = renamingId === tab.id;
        return (
          <div
            key={tab.id}
            role="tab"
            aria-selected={isActive}
            onClick={() => onSelect(tab.id)}
            title={isRenaming ? undefined : `${tab.title} — double-click to rename`}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "8px 10px",
              borderRadius: "10px 10px 0 0",
              cursor: "pointer",
              fontSize: 12.5,
              fontWeight: 600,
              maxWidth: isRenaming ? 220 : 190,
              background: isActive ? "var(--bg)" : "transparent",
              border: "1px solid var(--border)",
              borderBottom: isActive ? "2px solid var(--purple)" : "1px solid var(--border)",
              color: isActive ? "var(--t1)" : "var(--t2)",
            }}
          >
            {tab.loading && <span className={`${styles.spinner} ${styles.spinnerSm}`} />}
            {isRenaming ? (
              <input
                type="text"
                autoFocus
                className={styles.select}
                value={draft}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitRename();
                  if (e.key === "Escape") setRenamingId(null);
                }}
                style={{ width: 140, fontSize: 12.5, padding: "2px 6px" }}
              />
            ) : (
              <span
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  startRename(tab);
                }}
                style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
              >
                {tab.title}
              </span>
            )}
            {onClose && tabs.length > 1 && !isRenaming && (
              <button
                type="button"
                aria-label={`Close ${tab.title}`}
                title="Close this tab"
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(tab.id);
                }}
                style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "inherit", display: "flex", flexShrink: 0 }}
              >
                <CloseIcon size={11} />
              </button>
            )}
          </div>
        );
      })}
      {onAdd && (
      <button type="button" onClick={onAdd} title={addTitle} aria-label={addTitle} className={styles.btnSecondary} style={{ padding: "6px 12px", borderRadius: "10px 10px 0 0" }}>
        +
      </button>
      )}
    </div>
  );
}
