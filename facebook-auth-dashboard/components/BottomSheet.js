import { useEffect } from "react";
import { createPortal } from "react-dom";
import styles from "@/styles/Home.module.css";
import { CloseIcon } from "./icons";

// Phone-width modal surface: slides up from the bottom, dimmed backdrop,
// closes on backdrop tap / Escape / the X. Used for every "pick one of these"
// or "edit these settings" interaction on mobile instead of a desktop
// popover or centered modal (see DESIGN.md → Mobile web).
export default function BottomSheet({ open, title, onClose, children, footer }) {
  useEffect(() => {
    if (!open) return;
    function onKey(e) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    // This app's <body> is the scrolling element (styles/globals.css), so
    // freezing it stops the page moving behind the sheet.
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className={styles.sheetBackdrop} onClick={onClose}>
      <div className={styles.sheet} onClick={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
        <div className={styles.sheetGrip} />
        <div className={styles.sheetHeader}>
          <span className={styles.sheetTitle}>{title}</span>
          <button type="button" className={styles.appSidebarIconBtn} onClick={onClose} aria-label="Close">
            <CloseIcon size={16} />
          </button>
        </div>
        <div className={styles.sheetBody}>{children}</div>
        {footer && <div className={styles.sheetFooter}>{footer}</div>}
      </div>
    </div>,
    document.body
  );
}
