import { useEffect, useRef, useState } from "react";
import { ChevronIcon, CalendarIcon } from "./icons";
import { RANGE_PRESETS, isoDate, addDaysUTC, todayUTC, computeRange, inclusiveDayCount } from "@/lib/dateRanges";
import styles from "@/styles/Home.module.css";

const WEEKDAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const MONTH_LABEL_FMT = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
const DAY_LABEL_FMT = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

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

function formatTriggerLabel(rangePreset, since, until) {
  if (!since || !until) return "Select dates…";
  const datesLabel =
    since === until
      ? DAY_LABEL_FMT.format(new Date(`${since}T00:00:00Z`))
      : `${DAY_LABEL_FMT.format(new Date(`${since}T00:00:00Z`))} – ${DAY_LABEL_FMT.format(new Date(`${until}T00:00:00Z`))}`;
  const presetLabel = RANGE_PRESETS.find((p) => p.key === rangePreset)?.label;
  return !presetLabel || rangePreset === "custom" ? datesLabel : `${presetLabel}: ${datesLabel}`;
}

// The always-visible date-range control — combines what used to be three
// separate things buried inside the collapsible Query & Filters panel (the
// preset tab row, the custom-range calendar, and the whole "Compare to
// previous period" section) into one Meta-Ads-Manager-style button + popover
// (quick presets on the left, a two-month calendar on the right, comparison
// settings below it, applied together on "Update"). Living outside that
// panel means changing the date range or comparison — the two things a
// performance marketer changes on almost every pass through an account —
// never requires opening a settings panel first, whether it's collapsed or
// expanded.
//
// Everything is edited as a local draft, only committed via `onApply` when
// "Update" is clicked (Cancel, Escape, or an outside click all discard it) —
// unlike the old always-live controls, so picking through several presets or
// dragging a calendar range doesn't re-run anything until you're done.
export default function DateRangeMenu({
  rangePreset,
  customSince,
  customUntil,
  maxRangeDays,
  compareToPrevious,
  compareCustomSince,
  compareDisplay,
  compareDisabled,
  onApply,
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(null);
  const [hoverDate, setHoverDate] = useState(null);
  const [leftMonth, setLeftMonth] = useState(() => monthKeyOf(isoDate(todayUTC())));
  const [pos, setPos] = useState(null);
  const triggerRef = useRef(null);
  const popoverRef = useRef(null);

  const maxIso = isoDate(todayUTC());
  const committedRange = computeRange(rangePreset, customSince, customUntil);
  const triggerLabel = formatTriggerLabel(rangePreset, committedRange?.since, committedRange?.until);

  function openMenu() {
    const rect = triggerRef.current.getBoundingClientRect();
    const VIEWPORT_MARGIN = 16;
    // Two side-by-side months plus the preset list, header, compare section,
    // and footer render at a fairly fixed size — estimated rather than
    // measured post-render, so the popover is positioned correctly on its
    // very first paint instead of visibly jumping once an actual size is
    // known.
    const popoverWidth = Math.min(760, window.innerWidth - VIEWPORT_MARGIN * 2);
    const estimatedHeight = 560;
    let left = rect.left;
    if (left + popoverWidth > window.innerWidth - VIEWPORT_MARGIN) {
      left = Math.max(VIEWPORT_MARGIN, window.innerWidth - popoverWidth - VIEWPORT_MARGIN);
    }
    let top = rect.bottom + 6;
    if (top + estimatedHeight > window.innerHeight - VIEWPORT_MARGIN) {
      top = Math.max(VIEWPORT_MARGIN, rect.top - estimatedHeight - 6);
    }
    setPos({ top, left });
    const seedRange = committedRange || computeRange("last_30d", null, null);
    setDraft({
      rangePreset,
      since: seedRange?.since || null,
      until: seedRange?.until || null,
      compareToPrevious,
      compareCustomSince,
      compareDisplay,
    });
    setLeftMonth(monthKeyOf(seedRange?.since || maxIso));
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
    // Capture phase — a scrollable ancestor's own internal scroll doesn't
    // bubble a `scroll` event, so only a capturing window listener sees it.
    // Scrolling the preset list itself (it has its own `overflowY: auto`,
    // unlike the old DateRangePicker this replaced) must NOT close the
    // popover — only a scroll happening *outside* it (e.g. the page
    // scrolling underneath) should.
    function onScroll(e) {
      if (popoverRef.current?.contains(e.target)) return;
      close();
    }
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [open]);

  if (!open || !draft) {
    return (
      <button
        type="button"
        ref={triggerRef}
        className={styles.btnSecondary}
        style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
        onClick={openMenu}
      >
        <CalendarIcon size={13} />
        {triggerLabel}
        <ChevronIcon direction="down" size={11} />
      </button>
    );
  }

  const rightMonth = shiftMonth(leftMonth, 1);
  const draftDays = draft.since && draft.until ? inclusiveDayCount(draft.since, draft.until) : null;
  const draftTooLong = draftDays != null && draftDays > maxRangeDays;
  const compareEnd = draft.compareToPrevious && draft.compareCustomSince && draftDays ? addDaysUTC(draft.compareCustomSince, draftDays - 1) : null;
  const compareTooFar = !!compareEnd && compareEnd > maxIso;
  const canApply = !!draft.since && !!draft.until && !draftTooLong && !compareTooFar;

  function pickPreset(key) {
    const r = computeRange(key, null, null);
    setDraft((d) => ({ ...d, rangePreset: key, since: r?.since ?? d.since, until: r?.until ?? d.until }));
    if (r) setLeftMonth(monthKeyOf(r.since));
  }

  // Clicking a calendar day always (re)starts or completes a *custom*
  // selection — if the draft is currently showing a complete range (whether
  // from a preset or an earlier custom pick), the next click starts fresh
  // rather than extending it.
  function handleDayPick(iso) {
    setDraft((d) => {
      if (!d.since || d.until) return { ...d, rangePreset: "custom", since: iso, until: null };
      if (iso < d.since) return { ...d, rangePreset: "custom", since: iso, until: d.since };
      return { ...d, rangePreset: "custom", until: iso };
    });
  }

  function handleApply() {
    onApply({
      rangePreset: draft.rangePreset,
      customSince: draft.rangePreset === "custom" ? draft.since : "",
      customUntil: draft.rangePreset === "custom" ? draft.until : "",
      compareToPrevious: draft.compareToPrevious,
      compareCustomSince: draft.compareCustomSince,
      compareDisplay: draft.compareDisplay,
    });
    close();
  }

  return (
    <div style={{ position: "relative", display: "inline-block" }}>
      <button
        type="button"
        ref={triggerRef}
        className={styles.btnSecondary}
        style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
        onClick={close}
      >
        <CalendarIcon size={13} />
        {triggerLabel}
        <ChevronIcon direction="up" size={11} />
      </button>

      <div
        ref={popoverRef}
        className={styles.card}
        style={{
          position: "fixed",
          top: pos.top,
          left: pos.left,
          zIndex: 50,
          background: "var(--bg)",
          width: "min(760px, calc(100vw - 32px))",
          boxShadow: "var(--shadow-md)",
          display: "flex",
          padding: 0,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: 172,
            flexShrink: 0,
            borderRight: "1px solid var(--border)",
            padding: 12,
            display: "flex",
            flexDirection: "column",
            gap: 2,
            maxHeight: 520,
            overflowY: "auto",
          }}
        >
          {RANGE_PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => pickPreset(p.key)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                textAlign: "left",
                background: draft.rangePreset === p.key ? "rgba(var(--purple-rgb), 0.12)" : "none",
                border: "none",
                borderRadius: 6,
                padding: "7px 8px",
                cursor: "pointer",
                color: "var(--t1)",
                fontSize: 12.5,
                fontWeight: draft.rangePreset === p.key ? 700 : 500,
              }}
            >
              <span
                style={{
                  width: 13,
                  height: 13,
                  borderRadius: "50%",
                  border: `2px solid ${draft.rangePreset === p.key ? "var(--purple)" : "var(--border2)"}`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                {draft.rangePreset === p.key && <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--purple)" }} />}
              </span>
              {p.label}
            </button>
          ))}
        </div>

        <div style={{ flex: 1, minWidth: 0, padding: 16, display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
            <button type="button" className={styles.btnSecondary} style={{ padding: 6 }} onClick={() => setLeftMonth((m) => shiftMonth(m, -1))} aria-label="Previous month">
              <ChevronIcon direction="left" size={13} />
            </button>
            <span className={styles.muted}>
              {draft.since && draft.until
                ? `${DAY_LABEL_FMT.format(new Date(`${draft.since}T00:00:00Z`))} – ${DAY_LABEL_FMT.format(new Date(`${draft.until}T00:00:00Z`))} · ${draftDays} day${draftDays === 1 ? "" : "s"}`
                : draft.since
                  ? `${DAY_LABEL_FMT.format(new Date(`${draft.since}T00:00:00Z`))} – pick an end date`
                  : "Pick a start date"}
            </span>
            <button type="button" className={styles.btnSecondary} style={{ padding: 6 }} onClick={() => setLeftMonth((m) => shiftMonth(m, 1))} aria-label="Next month">
              <ChevronIcon direction="right" size={13} />
            </button>
          </div>
          <div style={{ display: "flex", gap: 18, marginTop: 8 }} onMouseLeave={() => setHoverDate(null)}>
            <Month monthKey={leftMonth} selStart={draft.since} selEnd={draft.until} hoverEnd={hoverDate} maxIso={maxIso} onPick={handleDayPick} onHover={setHoverDate} />
            <Month monthKey={rightMonth} selStart={draft.since} selEnd={draft.until} hoverEnd={hoverDate} maxIso={maxIso} onPick={handleDayPick} onHover={setHoverDate} />
          </div>
          {draftTooLong && (
            <p className={styles.sub} style={{ color: "var(--red)", marginTop: 10 }}>
              That&apos;s {draftDays} days — the longest range allowed is {maxRangeDays}.
            </p>
          )}

          <div style={{ borderTop: "1px solid var(--border)", marginTop: 16, paddingTop: 14 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: compareDisabled ? "default" : "pointer", fontSize: 12.5, fontWeight: 600 }}>
              <input
                type="checkbox"
                checked={!!draft.compareToPrevious}
                disabled={compareDisabled}
                onChange={(e) => setDraft((d) => ({ ...d, compareToPrevious: e.target.checked }))}
              />
              Compare to previous period
            </label>
            {compareDisabled && (
              <p className={styles.sub} style={{ marginTop: 4 }}>
                Not available together with daily/weekly/monthly grouping.
              </p>
            )}
            {draft.compareToPrevious && !compareDisabled && (
              <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 10 }}>
                <div className={styles.tabGroup}>
                  <button
                    type="button"
                    className={!draft.compareCustomSince ? `${styles.tab} ${styles.tabActive}` : styles.tab}
                    onClick={() => setDraft((d) => ({ ...d, compareCustomSince: "" }))}
                  >
                    Immediately preceding
                  </button>
                  <button
                    type="button"
                    className={draft.compareCustomSince ? `${styles.tab} ${styles.tabActive}` : styles.tab}
                    onClick={() =>
                      setDraft((d) => ({ ...d, compareCustomSince: d.compareCustomSince || (draftDays ? addDaysUTC(d.since, -draftDays) : "") }))
                    }
                  >
                    Custom start date
                  </button>
                </div>
                {draft.compareCustomSince && (
                  <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                    <input
                      type="date"
                      className={styles.select}
                      value={draft.compareCustomSince}
                      max={maxIso}
                      onChange={(e) => setDraft((d) => ({ ...d, compareCustomSince: e.target.value }))}
                    />
                    {draftDays && <span className={styles.muted}>→ {compareEnd} ({draftDays} day{draftDays === 1 ? "" : "s"})</span>}
                  </div>
                )}
                {compareTooFar && (
                  <p className={styles.sub} style={{ color: "var(--red)" }}>
                    Comparison period can&apos;t extend into the future.
                  </p>
                )}
                <div className={styles.tabGroup}>
                  <button
                    type="button"
                    className={draft.compareDisplay !== "absolute" ? `${styles.tab} ${styles.tabActive}` : styles.tab}
                    onClick={() => setDraft((d) => ({ ...d, compareDisplay: "change" }))}
                  >
                    % Change
                  </button>
                  <button
                    type="button"
                    className={draft.compareDisplay === "absolute" ? `${styles.tab} ${styles.tabActive}` : styles.tab}
                    onClick={() => setDraft((d) => ({ ...d, compareDisplay: "absolute" }))}
                  >
                    Absolute value
                  </button>
                </div>
              </div>
            )}
          </div>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 16 }}>
            <span className={styles.muted}>Dates are in your local timezone.</span>
            <div style={{ display: "flex", gap: 10 }}>
              <button type="button" className={styles.btnSecondary} onClick={close}>
                Cancel
              </button>
              <button type="button" className={styles.btnPrimary} disabled={!canApply} onClick={handleApply}>
                Update
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
