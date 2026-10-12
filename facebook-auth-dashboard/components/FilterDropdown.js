import { useEffect, useRef, useState } from "react";
import { ChevronIcon } from "./icons";
import styles from "@/styles/Home.module.css";

// A compact multi-select dropdown for a set of toggleable filter options —
// reuses the same .comboWrapper/.comboDropdown/.comboOption styling as
// AccountSelect's own dropdown, so it looks like every other picker in this
// app instead of a plain checkbox+label list. `selected: null` means
// "everything selected" (no filter active — matching this app's existing
// null-means-all convention for pivot filters elsewhere, e.g. pages/explore.js's
// own resultFilters.statusValues), or an array of the currently-checked
// option keys. Checking/unchecking calls `onToggle` immediately — there's no
// separate "Apply" step, so the result list underneath updates on the same
// click, same as every other instant, client-side filter in this app.
export default function FilterDropdown({ label, options, selected, onToggle, style }) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const selectedCount = selected ? selected.length : options.length;
  const summary =
    options.length === 0
      ? "None"
      : selectedCount === options.length
        ? "All"
        : selectedCount === 0
          ? "None selected"
          : `${selectedCount} of ${options.length}`;

  return (
    <div ref={wrapperRef} className={styles.comboWrapper} style={style}>
      <button
        type="button"
        className={styles.select}
        style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, cursor: "pointer" }}
        onClick={() => setOpen((o) => !o)}
      >
        <span>
          {label}: <strong>{summary}</strong>
        </span>
        <ChevronIcon direction={open ? "up" : "down"} size={11} />
      </button>
      {open && (
        <div className={styles.comboDropdown}>
          {options.map((opt) => {
            const checked = !selected || selected.includes(opt.key);
            return (
              <label key={opt.key} className={styles.comboOption} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                <input type="checkbox" checked={checked} onChange={() => onToggle(opt.key)} />
                {opt.label}
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
