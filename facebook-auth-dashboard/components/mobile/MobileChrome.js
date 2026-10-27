import { useEffect, useRef, useState } from "react";
import BottomSheet from "@/components/BottomSheet";
import { ChevronIcon, SearchIcon } from "@/components/icons";
import styles from "@/styles/Home.module.css";

// Phone screen chrome shared by every multi-tab "app" screen (Partnership Ads,
// Catalog Ads) so they look and behave the same: one context line (what
// you're looking at) with icon actions beside it, a sticky chip row for
// sub-navigation, and a searchable picker sheet for long account lists.

// "2026-09-27" -> "Sep 27" (year only when it isn't the current one).
export function shortDay(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  const sameYear = iso.startsWith(String(new Date().getUTCFullYear()));
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: sameYear ? undefined : "numeric", timeZone: "UTC" });
}

// "Last 30 Days · Sep 27 – Oct 26"
export function formatRangeLabel(presetLabel, since, until) {
  if (!since || !until) return "";
  return `${presetLabel || "Custom"} · ${shortDay(since)}${since === until ? "" : ` – ${shortDay(until)}`}`;
}

// `children` are trailing icon buttons (use MobileIconBtn).
export function MobileContextBar({ title, sub, onOpen, children }) {
  return (
    <div className={styles.pvContextBar}>
      <button type="button" className={styles.pvContextBtn} onClick={onOpen}>
        <span className={styles.pvContextText}>
          <span className={styles.pvContextTitle}>{title}</span>
          {sub && <span className={styles.pvContextSub}>{sub}</span>}
        </span>
        <ChevronIcon direction="down" size={14} />
      </button>
      {children}
    </div>
  );
}

export function MobileIconBtn({ onClick, disabled, spinning, label, badge, children }) {
  return (
    <button
      type="button"
      className={spinning ? `${styles.pvIconBtn} ${styles.pvSpin}` : styles.pvIconBtn}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
    >
      {children}
      {badge > 0 && <span className={styles.pvBadge}>{badge}</span>}
    </button>
  );
}

// Sticky, horizontally scrollable sub-navigation. The active chip is scrolled
// into view so deep-linking to a tab doesn't leave it off-screen.
export function MobileChips({ tabs, active, onChange, label }) {
  const activeRef = useRef(null);
  useEffect(() => {
    activeRef.current?.scrollIntoView?.({ inline: "center", block: "nearest", behavior: "smooth" });
  }, [active]);
  return (
    <div className={styles.pvChipRow} role="tablist" aria-label={label}>
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

// A form-field-looking button that opens a picker sheet.
export function PickerField({ label, value, placeholder, onClick, disabled }) {
  return (
    <div className={styles.pvField}>
      <span>{label}</span>
      <button type="button" className={styles.pvPickerBtn} onClick={onClick} disabled={disabled}>
        <span className={value ? styles.pvPickerVal : styles.pvPickerPlaceholder}>{value || placeholder}</span>
        <ChevronIcon direction="down" size={14} />
      </button>
    </div>
  );
}

// Pick one of many (ad accounts, businesses, Instagram accounts). The search
// box is pinned to the top of the sheet; only the list scrolls under it.
// Mount it only while open (its search text resets on close that way).
export function PickerSheet({ open, title, options, value, onPick, onClose, searchPlaceholder, emptyLabel }) {
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const filtered = needle ? options.filter((o) => `${o.name} ${o.sub || ""} ${o.id}`.toLowerCase().includes(needle)) : options;
  return (
    <BottomSheet open={open} title={title} onClose={onClose}>
      <div className={styles.pickerSearch}>
        <SearchIcon size={15} />
        <input type="search" placeholder={searchPlaceholder || "Search"} value={q} onChange={(e) => setQ(e.target.value)} aria-label={searchPlaceholder || "Search"} />
      </div>
      <div className={styles.sheetList}>
        {filtered.map((o) => (
          <button
            key={o.id}
            type="button"
            className={styles.sheetListItem}
            onClick={() => {
              onPick(o.id);
              onClose();
            }}
          >
            <span className={styles.pickerItemText}>
              <span className={styles.pickerItemName}>{o.name || o.id}</span>
              {o.sub && <span className={styles.pickerItemSub}>{o.sub}</span>}
            </span>
            {o.id === value && <span className={styles.pickerTick}>✓</span>}
          </button>
        ))}
        {filtered.length === 0 && <p className={styles.muted}>{needle ? `No matches for “${q}”.` : emptyLabel || "Nothing to pick."}</p>}
      </div>
    </BottomSheet>
  );
}
