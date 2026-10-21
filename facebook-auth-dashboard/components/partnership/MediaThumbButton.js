import { useState } from "react";
import { CloseIcon } from "../icons";
import ContentPreviewMedia from "./ContentPreviewMedia";
import styles from "@/styles/Home.module.css";

// A static thumbnail (ContentPreviewMedia's "thumb" variant — never
// autoplaying, see its own comment for why) that opens a full, controllable
// preview on click. Used anywhere a queued item's creative needs to be
// glanceable without playing automatically: the launch queue list, the
// launch wizard's review step — reported by the user as the preferred
// behavior there over the grid's own autoplay.
export default function MediaThumbButton({ contentId, permalink, mediaType, size = 48, radius = 6 }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        style={{
          width: size,
          height: size,
          borderRadius: radius,
          flexShrink: 0,
          position: "relative",
          overflow: "hidden",
          padding: 0,
          border: "none",
          cursor: "pointer",
        }}
        aria-label="View full preview"
      >
        <ContentPreviewMedia contentId={contentId} permalink={permalink} mediaType={mediaType} variant="thumb" />
      </button>

      {open && (
        <div
          onClick={(e) => {
            e.stopPropagation();
            setOpen(false);
          }}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,.75)",
            backdropFilter: "blur(6px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 900,
            padding: 24,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "relative",
              width: "min(480px, 90vw)",
              aspectRatio: mediaType === "VIDEO" ? "9 / 16" : "4 / 5",
              maxHeight: "86vh",
              borderRadius: 12,
              overflow: "hidden",
              background: "#000",
            }}
          >
            <ContentPreviewMedia contentId={contentId} permalink={permalink} mediaType={mediaType} variant="detail" />
          </div>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
            }}
            aria-label="Close"
            className={styles.btnSecondary}
            style={{ position: "fixed", top: 20, right: 20, padding: 8 }}
          >
            <CloseIcon size={16} />
          </button>
        </div>
      )}
    </>
  );
}
