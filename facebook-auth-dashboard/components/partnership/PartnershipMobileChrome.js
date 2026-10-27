import { useEffect, useRef } from "react";
import Link from "next/link";
import styles from "@/styles/Home.module.css";
import { ChevronIcon, HandshakeIcon, RefreshIcon } from "../icons";

// Phone header for Partnership Ads: the whole wrapped pill row (ad account,
// business, instagram account, date range, reload, queue) collapses to one
// tappable context line — what you're looking at — that opens a sheet with the
// actual pickers. The Ready-to-Launch queue becomes a compact chip beside it.
export function MobileContextBar({ accountLabel, rangeLabel, queueCount, onOpen, onReload, reloading, canReload }) {
  return (
    <div className={styles.pvContextBar}>
      <button type="button" className={styles.pvContextBtn} onClick={onOpen}>
        <span className={styles.pvContextText}>
          <span className={styles.pvContextTitle}>{accountLabel || "Select an ad account"}</span>
          {rangeLabel && <span className={styles.pvContextSub}>{rangeLabel}</span>}
        </span>
        <ChevronIcon direction="down" size={14} />
      </button>
      {onReload && (
        <button
          type="button"
          className={reloading ? `${styles.pvIconBtn} ${styles.pvSpin}` : styles.pvIconBtn}
          onClick={onReload}
          disabled={!canReload || reloading}
          aria-label="Reload"
        >
          <RefreshIcon size={16} />
        </button>
      )}
      <Link href="/partnership-ads/queue" className={styles.pvIconBtn} aria-label={`Ready to Launch, ${queueCount} queued`}>
        <HandshakeIcon size={16} />
        {queueCount > 0 && <span className={styles.pvBadge}>{queueCount}</span>}
      </Link>
    </div>
  );
}

// Sticky, horizontally scrollable sub-navigation. The active chip is scrolled
// into view so deep-linking to ?tab=code doesn't leave it off-screen.
export function MobileTabChips({ tabs, active, onChange }) {
  const activeRef = useRef(null);
  useEffect(() => {
    activeRef.current?.scrollIntoView?.({ inline: "center", block: "nearest", behavior: "smooth" });
  }, [active]);
  return (
    <div className={styles.pvChipRow} role="tablist">
      {tabs.map((t) => (
        <button
          key={t.key}
          ref={t.key === active ? activeRef : null}
          type="button"
          role="tab"
          aria-selected={t.key === active}
          className={t.key === active ? `${styles.pvChip} ${styles.pvChipOn}` : styles.pvChip}
          onClick={() => onChange(t.key)}
        >
          {t.short || t.label}
        </button>
      ))}
    </div>
  );
}
