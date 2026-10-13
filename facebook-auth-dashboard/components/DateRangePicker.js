import { useEffect, useRef, useState } from "react";
import { ChevronIcon } from "./icons";
import styles from "@/styles/Home.module.css";

const WEEKDAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const MONTH_LABEL_FMT = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
const DAY_LABEL_FMT = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

// `monthKey` is a plain `{year, month}` (month 0-11, UTC) rather than a Date
// — a Date carrying a day-of-month gets silently normalized (walking into a
// shorter month, e.g. day 31 + one month, can jump an extra month) the
// moment you only ever meant "go to the 1st of the next/previous month".
function shiftMonth({ year, month }, delta) {
  const total = year * 12 + month + delta;
  return { year: Math.floor(total / 12), month: ((total % 12) + 12) % 12 };
}

function monthKeyOf(iso) {
  const [year, month] = iso.split("-").map(Number);
  return { year, month: month - 1 };
}

// One calendar month's day cells, Sunday-first, padded with the trailing
// days of the previous month and leading days of the next so every week row
// is a full 7 — `inMonth: false` cells are still real, clickable dates (so
// picking a range that crosses a month boundary doesn't require navigating
// first), just dimmed to show they belong to a neighboring month.
function buildMonthMatrix({ year, month }) {
  const first = new Date(Date.UTC(year, month, 1));
  const startOffset = first.getUTCDay();
  const gridStart = new Date(Date.UTC(year, month, 1 - startOffset));
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(Date.UTC(year, month, 1 - startOffset + i));
    cells.push({ iso: isoDate(d), day: d.getUTCDate(), inMonth: d.getUTCMonth() === month });
  }
  // A trailing all-next-month row (every cell `inMonth: false`) means the
  // first 5 rows already covered the whole month — drop it rather than
  // show a pointless, entirely-dimmed 6th week.
  if (cells.slice(35).every((c) => !c.inMonth)) return cells.slice(0, 35);
  return cells;
}

function Month({ monthKey, selStart, selEnd, hoverEnd, maxIso, onPick, onHover }) {
  // Cheap enough (42 cells) to just rebuild on every render — not worth a
  // memo (and memoizing on `monthKey`'s primitive fields rather than the
  // object itself, since a new object is passed in on every render anyway,
  // fights react-hooks/exhaustive-deps for no real benefit).
  const cells = buildMonthMatrix(monthKey);
  const todayIso = isoDate(new Date());
  const previewEnd = selStart && !selEnd ? hoverEnd : null;
  const rangeLo = selStart && (selEnd || previewEnd) ? (selStart < (selEnd || previewEnd) ? selStart : selEnd || previewEnd) : null;
  const rangeHi = selStart && (selEnd || previewEnd) ? (selStart < (selEnd || previewEnd) ? selEnd || previewEnd : selStart) : null;

  return (
    <div style={{ flex: "1 1 0", minWidth: 220 }}>
      <p style={{ textAlign: "center", fontSize: 13, fontWeight: 700, color: "var(--t1)", marginBottom: 10 }}>
        {MONTH_LABEL_FMT.format(new Date(Date.UTC(monthKey.year, monthKey.month, 1)))}
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2 }}>
        {WEEKDAY_LABELS.map((w) => (
          <div key={w} style={{ textAlign: "center", fontSize: 10.5, fontWeight: 700, color: "var(--t3)", padding: "2px 0" }}>
            {w}
          </div>
        ))}
        {cells.map((cell) => {
          const disabled = cell.iso > maxIso;
          const isStart = cell.iso === selStart;
          const isEnd = cell.iso === selEnd || (!selEnd && cell.iso === previewEnd && previewEnd !== selStart);
          const inRange = rangeLo && rangeHi && cell.iso > rangeLo && cell.iso < rangeHi;
          const isEndpoint = cell.iso === selStart || cell.iso === selEnd;
          return (
            <button
              key={cell.iso}
              type="button"
              disabled={disabled}
              onClick={() => onPick(cell.iso)}
              onMouseEnter={() => onHover(cell.iso)}
              style={{
                aspectRatio: "1",
                border: "none",
                borderRadius: isEndpoint ? 8 : inRange ? 0 : 8,
                background: isEndpoint ? "var(--purple)" : inRange ? "rgba(var(--purple-rgb), 0.14)" : "transparent",
                color: disabled ? "var(--t3)" : isEndpoint ? "#fff" : !cell.inMonth ? "var(--t3)" : "var(--t1)",
                fontSize: 12.5,
                fontWeight: isEndpoint || cell.iso === todayIso ? 700 : 500,
                cursor: disabled ? "default" : "pointer",
                opacity: disabled ? 0.35 : 1,
                outline: cell.iso === todayIso && !isEndpoint ? "1px solid var(--purple)" : "none",
                outlineOffset: -1,
              }}
            >
              {cell.day}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Single inline calendar popover for picking a start+end date together —
// replaces two separate native `<input type="date">` fields with one
// click-through flow: click a start day, then an end day (hovering between
// them previews the range), Apply to commit. Positioned `fixed` from the
// trigger's own getBoundingClientRect() rather than `absolute`, same reason
// as RowActions' menu (see styles/Home.module.css's .rowActionMenu comment)
// — this lives inside Explore's scrollable query panel body, which would
// otherwise clip an absolutely-positioned popover taller than the visible
// scroll window.
export default function DateRangePicker({ since, until, maxIso, maxRangeDays, onApply }) {
  const [open, setOpen] = useState(false);
  const [draftStart, setDraftStart] = useState(since || null);
  const [draftEnd, setDraftEnd] = useState(until || null);
  const [hoverDate, setHoverDate] = useState(null);
  const [leftMonth, setLeftMonth] = useState(() => monthKeyOf(since || maxIso));
  const [pos, setPos] = useState(null);
  const triggerRef = useRef(null);
  const popoverRef = useRef(null);

  function openPicker() {
    const rect = triggerRef.current.getBoundingClientRect();
    const VIEWPORT_MARGIN = 16;
    // Two side-by-side months plus the header/footer rows render at a
    // fairly fixed height — estimated rather than measured post-render, so
    // the popover is positioned correctly on its very first paint instead
    // of visibly jumping once an actual size is known. This trigger sits in
    // Explore's narrow right-hand query panel, so a naive "anchor to the
    // trigger's own left edge" would frequently push a 520px-wide popover
    // past the right edge of the viewport entirely — clamp both axes into
    // view instead, flipping above the trigger when there's no room below.
    const popoverWidth = Math.min(520, window.innerWidth - VIEWPORT_MARGIN * 2);
    const estimatedHeight = 420;
    let left = rect.left;
    if (left + popoverWidth > window.innerWidth - VIEWPORT_MARGIN) {
      left = Math.max(VIEWPORT_MARGIN, window.innerWidth - popoverWidth - VIEWPORT_MARGIN);
    }
    let top = rect.bottom + 6;
    if (top + estimatedHeight > window.innerHeight - VIEWPORT_MARGIN) {
      top = Math.max(VIEWPORT_MARGIN, rect.top - estimatedHeight - 6);
    }
    setPos({ top, left });
    setDraftStart(since || null);
    setDraftEnd(until || null);
    setLeftMonth(monthKeyOf(since || until || maxIso));
    setOpen(true);
  }

  function close() {
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    function onKey(e) {
      if (e.key === "Escape") close();
    }
    function onPointerDown(e) {
      if (popoverRef.current?.contains(e.target) || triggerRef.current?.contains(e.target)) return;
      close();
    }
    // Capture phase — see RowActions.js's identical listener for why: the
    // query panel's own internal scroll container doesn't bubble its scroll
    // event, so only a capturing window listener actually sees it.
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [open]);

  function handlePick(iso) {
    if (!draftStart || draftEnd) {
      setDraftStart(iso);
      setDraftEnd(null);
      return;
    }
    if (iso < draftStart) {
      setDraftEnd(draftStart);
      setDraftStart(iso);
    } else {
      setDraftEnd(iso);
    }
  }

  const rightMonth = shiftMonth(leftMonth, 1);
  const draftDays = draftStart && draftEnd ? Math.round((new Date(`${draftEnd}T00:00:00Z`) - new Date(`${draftStart}T00:00:00Z`)) / 86400000) + 1 : null;
  const draftTooLong = draftDays != null && draftDays > maxRangeDays;

  const triggerLabel =
    since && until
      ? since === until
        ? DAY_LABEL_FMT.format(new Date(`${since}T00:00:00Z`))
        : `${DAY_LABEL_FMT.format(new Date(`${since}T00:00:00Z`))} – ${DAY_LABEL_FMT.format(new Date(`${until}T00:00:00Z`))}`
      : "Select dates…";

  return (
    <div style={{ position: "relative", display: "inline-block" }}>
      <button type="button" ref={triggerRef} className={styles.select} style={{ cursor: "pointer" }} onClick={() => (open ? close() : openPicker())}>
        {triggerLabel}
      </button>

      {open && (
        <div
          ref={popoverRef}
          className={styles.card}
          style={{
            position: "fixed",
            top: pos.top,
            left: pos.left,
            zIndex: 50,
            background: "var(--bg)",
            width: "min(520px, calc(100vw - 32px))",
            boxShadow: "var(--shadow-md)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
            <button type="button" className={styles.btnSecondary} style={{ padding: 6 }} onClick={() => setLeftMonth((m) => shiftMonth(m, -1))} aria-label="Previous month">
              <ChevronIcon direction="left" size={13} />
            </button>
            <span className={styles.muted}>
              {draftStart && draftEnd
                ? `${DAY_LABEL_FMT.format(new Date(`${draftStart}T00:00:00Z`))} – ${DAY_LABEL_FMT.format(new Date(`${draftEnd}T00:00:00Z`))} · ${draftDays} day${draftDays === 1 ? "" : "s"}`
                : draftStart
                  ? `${DAY_LABEL_FMT.format(new Date(`${draftStart}T00:00:00Z`))} – pick an end date`
                  : "Pick a start date"}
            </span>
            <button type="button" className={styles.btnSecondary} style={{ padding: 6 }} onClick={() => setLeftMonth((m) => shiftMonth(m, 1))} aria-label="Next month">
              <ChevronIcon direction="right" size={13} />
            </button>
          </div>
          <div style={{ display: "flex", gap: 18, marginTop: 8 }} onMouseLeave={() => setHoverDate(null)}>
            <Month monthKey={leftMonth} selStart={draftStart} selEnd={draftEnd} hoverEnd={hoverDate} maxIso={maxIso} onPick={handlePick} onHover={setHoverDate} />
            <Month monthKey={rightMonth} selStart={draftStart} selEnd={draftEnd} hoverEnd={hoverDate} maxIso={maxIso} onPick={handlePick} onHover={setHoverDate} />
          </div>
          {draftTooLong && (
            <p className={styles.sub} style={{ color: "var(--red)", marginTop: 10 }}>
              That&apos;s {draftDays} days — the longest range allowed is {maxRangeDays}.
            </p>
          )}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 14 }}>
            <button type="button" className={styles.btnSecondary} onClick={close}>
              Cancel
            </button>
            <button
              type="button"
              className={styles.btnPrimary}
              disabled={!draftStart || !draftEnd || draftTooLong}
              onClick={() => {
                onApply(draftStart, draftEnd);
                close();
              }}
            >
              Apply
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
