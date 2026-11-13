import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronIcon, CalendarIcon } from "./icons";
import { Month, shiftMonth, monthKeyOf, DAY_LABEL_FMT } from "./DateRangeMenu";
import { isoDate, addDaysUTC } from "@/lib/dateRanges";
import styles from "@/styles/Home.module.css";

const POPOVER_WIDTH = 296;
const noop = () => {};

// One date, picked from the same themed calendar the date-range menu uses (instead of the browser's own date control,
// which ignores the app's theme). `value` / `onChange` use "YYYY-MM-DD"; nothing after `maxIso` can be picked.
export default function DatePicker({ value, onChange, maxIso = isoDate(new Date()), placeholder = "Select a date", id }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const [month, setMonth] = useState(() => monthKeyOf(value || maxIso));
  const triggerRef = useRef(null);
  const popoverRef = useRef(null);

  function openPicker() {
    const rect = triggerRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const left = Math.max(12, Math.min(rect.left, window.innerWidth - POPOVER_WIDTH - 12));
    // About 340px tall: open upwards when the room below is short.
    setPos(spaceBelow < 360 && rect.top > spaceBelow ? { left, bottom: window.innerHeight - rect.top + 6 } : { left, top: rect.bottom + 6 });
    setMonth(monthKeyOf(value || maxIso));
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation(); // closes the picker, not the drawer it sits in
        setOpen(false);
      }
    };
    const onDown = (e) => {
      if (popoverRef.current?.contains(e.target) || triggerRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onScroll = (e) => {
      if (!popoverRef.current?.contains(e.target)) setOpen(false);
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  const atMax = isoDate(new Date(Date.UTC(shiftMonth(month, 1).year, shiftMonth(month, 1).month, 1))) > maxIso;
  const navBtn = { width: 28, height: 28, display: "inline-flex", alignItems: "center", justifyContent: "center", border: "1px solid var(--border)", borderRadius: 8, background: "none", color: "var(--t2)", cursor: "pointer" };

  return (
    <>
      <button
        id={id}
        ref={triggerRef}
        type="button"
        className={styles.btnSecondary}
        style={{ display: "inline-flex", alignItems: "center", gap: 8, minHeight: 38, color: value ? "var(--t1)" : "var(--t3)" }}
        onClick={() => (open ? setOpen(false) : openPicker())}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <CalendarIcon size={13} />
        {value ? DAY_LABEL_FMT.format(new Date(`${value}T00:00:00Z`)) : placeholder}
        <ChevronIcon direction={open ? "up" : "down"} size={11} />
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={popoverRef}
            role="dialog"
            aria-label="Choose a date"
            className={styles.card}
            style={{ position: "fixed", ...pos, width: POPOVER_WIDTH, zIndex: 900, background: "var(--bg)", padding: 14, boxShadow: "var(--shadow-md)" }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
              <button type="button" style={navBtn} aria-label="Previous month" onClick={() => setMonth((m) => shiftMonth(m, -1))}>
                <ChevronIcon direction="left" size={12} />
              </button>
              <button type="button" style={{ ...navBtn, opacity: atMax ? 0.35 : 1, cursor: atMax ? "default" : "pointer" }} aria-label="Next month" disabled={atMax} onClick={() => setMonth((m) => shiftMonth(m, 1))}>
                <ChevronIcon direction="right" size={12} />
              </button>
            </div>
            {/* The month title sits between the two arrows. */}
            <div style={{ marginTop: -34 }}>
              <Month
                monthKey={month}
                selStart={value || null}
                selEnd={value || null}
                hoverEnd={null}
                maxIso={maxIso}
                onHover={noop}
                onPick={(iso) => {
                  onChange(iso);
                  setOpen(false);
                }}
              />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10 }}>
              <button type="button" className={styles.recWhyBtn} onClick={() => { onChange(addDaysUTC(maxIso, -1)); setOpen(false); }}>
                Yesterday
              </button>
              {value && (
                <button type="button" className={styles.recWhyBtn} onClick={() => { onChange(""); setOpen(false); }}>
                  Clear
                </button>
              )}
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
