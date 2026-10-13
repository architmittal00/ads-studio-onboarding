import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { SearchIcon, GripIcon, PinIcon } from "./icons";
import styles from "@/styles/Home.module.css";

// Shared by every real row and the optional pinned row below — a standalone
// function (not a method closing over component state) since the pinned row
// needs to render identically, just from a different row array.
function renderCell(col, row, { activeFrozenKey, resizableColumns, columnWidth }) {
  const content = col.render ? col.render(row) : row[col.key];
  const width = resizableColumns ? columnWidth(col) : col.maxWidth;
  const isFrozen = col.key === activeFrozenKey;
  const frozenStyle = isFrozen
    ? {
        position: "sticky",
        left: 0,
        zIndex: 1,
        // `var(--card)` is a ~4%-alpha tint (see globals.css), not a solid
        // fill — fine for a static card background, but useless here since
        // the whole point is to occlude whatever scrolls underneath this
        // cell. Needs to be fully opaque (unlike the sticky header's own
        // 95%-alpha background, where any residual ghosting scrolls away
        // quickly) since a frozen column sits in place for as long as
        // someone's looking at it.
        background: "var(--bg)",
        boxShadow: "1px 0 0 var(--border2)",
      }
    : null;
  if (!width) {
    return (
      <td key={col.key} style={{ textAlign: col.align || "left", ...frozenStyle }}>
        {content}
      </td>
    );
  }
  const title = col.title ? col.title(row) : typeof row[col.key] === "string" ? row[col.key] : undefined;
  return (
    <td key={col.key} style={{ textAlign: col.align || "left", width: resizableColumns ? width : undefined, ...frozenStyle }}>
      <div title={title} className={styles.clamp3} style={{ maxWidth: width }}>
        {content}
      </div>
    </td>
  );
}

// Generic sortable, scroll-capped, optionally searchable table used across
// the report. `columns` is [{ key, label, align, render(row), sortValue(row),
// maxWidth, title(row) }] — sortValue defaults to row[key]; render defaults
// to the same. `maxWidth` (px) caps the column width; content wraps up to 3
// lines and only then ellipsizes (see .clamp3), rather than truncating a
// single line. `title` supplies the hover tooltip text (falls back to
// row[key] if it's a string). `searchable` adds a text filter above the
// table, matching `searchKeys` (default ["name"]) case-insensitively.
// `rowClassName(row)` optionally returns a class name applied to that row's
// `<tr>` — e.g. to highlight rows that need attention. `resizableColumns`
// lets someone drag a column's right edge to resize it (a per-render
// preference, like the sort/search/order/freeze state below — it doesn't
// persist across a fresh result, since a new query can bring an entirely
// different set of columns anyway).
//
// Column order is drag-and-drop editable (grip handle in each header, like
// a spreadsheet) via `colOrder`/the reconciliation below, and whichever
// column currently sits first can be frozen (pinned via the header's sticky
// `top` already in play, extended to `left: 0` too) so it stays visible
// while the rest of the table scrolls horizontally — on by default, with a
// toggle to turn it back off. A column marked `freezeExempt: true` (a narrow
// bulk-select checkbox column, say) is skipped when picking which column
// that "first" one is, so freezing doesn't default to pinning a column with
// nothing worth seeing while scrolled — it still takes its normal place in
// the column order, just never becomes the freeze target on its own.
// `renderRowExtra(row)`, if given, returns extra JSX (typically one or more
// `<tr>`s, e.g. for an on-demand-fetched set of child rows) inserted right
// after that row's own `<tr>` — entirely outside sorting/searching (which
// only ever operate on the top-level `rows` array), so a caller doing its
// own nested-row expansion keeps that state and gets it rendered in the
// right place without this component needing to know anything about it.
// `onSortChange(sortKey, sortDir)`/`onSearchChange(search)`/
// `onFreezeChange(frozenKey)`, if given, fire whenever this table's own
// (otherwise fully internal) sort/search/freeze state changes, including
// once on mount with its initial value — letting a caller that's rendering
// its own extra rows via `renderRowExtra` mirror the same sort/search/freeze
// the visible top-level rows are under, instead of those extra rows silently
// ignoring it. `frozenKey` is `null` when nothing's pinned.
// `pinnedRow`, if given, renders one extra row via the same `columns[].
// render`/frozen-column treatment as a normal row, pinned after every real
// row at the very end of `<tbody>` — outside sorting, searching, and
// `renderRowExtra` entirely (a
// caller's own "Total" row, say, which should never itself get sorted among
// the rows it's totaling, or disappear behind a search term that doesn't
// match its own label).
export default function SortableTable({
  columns,
  rows,
  defaultSortKey,
  defaultSortDir = "desc",
  maxHeight = 360,
  emptyMessage = "No data.",
  onRowClick,
  rowClassName,
  searchable = false,
  searchKeys = ["name"],
  searchPlaceholder = "Search…",
  resizableColumns = false,
  renderRowExtra,
  onSortChange,
  onSearchChange,
  onFreezeChange,
  pinnedRow,
}) {
  const [sortKey, setSortKey] = useState(defaultSortKey || columns[0]?.key);
  const [sortDir, setSortDir] = useState(defaultSortDir);
  const [search, setSearch] = useState("");

  useEffect(() => {
    onSortChange?.(sortKey, sortDir);
    // Only the sort state itself should re-fire this — `onSortChange` isn't
    // expected to change identity across renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortKey, sortDir]);

  useEffect(() => {
    onSearchChange?.(search);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);
  // User-dragged widths only — a column with no entry here still falls back
  // to its own `maxWidth` (or the DEFAULT_COLUMN_WIDTH below), so adding/
  // removing columns between queries never leaves a stale width behind.
  const [colWidths, setColWidths] = useState({});
  const dragRef = useRef(null);

  // User-dragged column order, by key. Reconciled against the live `columns`
  // prop below rather than trusted outright — a key that's gone (last
  // query's breakdown column, say) is just dropped, so switching queries
  // can't leave the table rendering a stale or missing column.
  const [colOrder, setColOrder] = useState(() => columns.map((c) => c.key));
  const [dragKey, setDragKey] = useState(null);
  const [dragOverKey, setDragOverKey] = useState(null);
  const [firstColFrozen, setFirstColFrozen] = useState(true);

  // Preserves the user's own relative order for every column that was
  // already part of it, but places any newly-appeared column (a Breakdown
  // column that just got turned on, say) at the natural position `columns`
  // itself puts it in, rather than always at the very end. This table
  // persists across a caller re-running its query with a different column
  // set (e.g. Explore's own SortableTable instance isn't remounted just
  // because "Update This View" changed which columns come back) — appending
  // every new column unconditionally used to silently push a fresh grouping/
  // breakdown column out past every metric column, only fixed by a full page
  // reload (which remounts this component and recomputes colOrder's initial
  // state from scratch, matching the current columns).
  const orderedColumns = useMemo(() => {
    const sortableKnown = columns
      .filter((c) => colOrder.includes(c.key))
      .sort((a, b) => colOrder.indexOf(a.key) - colOrder.indexOf(b.key));
    let i = 0;
    return columns.map((c) => (colOrder.includes(c.key) ? sortableKnown[i++] : c));
  }, [columns, colOrder]);

  // Mirrors which column (if any) is currently pinned — same convention as
  // onSortChange/onSearchChange above — so a caller rendering its own extra
  // rows via renderRowExtra (e.g. Explore's drill-down children, which don't
  // create a new column for campaign/ad set/ad name) can freeze the matching
  // cell in those rows too, instead of only the ones SortableTable renders
  // itself.
  const activeFrozenKey = firstColFrozen
    ? (orderedColumns.find((c) => !c.freezeExempt) || orderedColumns[0])?.key ?? null
    : null;
  useEffect(() => {
    onFreezeChange?.(activeFrozenKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFrozenKey]);

  function handleColumnDrop(targetKey) {
    if (!dragKey || dragKey === targetKey) return;
    const current = orderedColumns.map((c) => c.key);
    const from = current.indexOf(dragKey);
    const to = current.indexOf(targetKey);
    if (from === -1 || to === -1) return;
    const next = [...current];
    next.splice(from, 1);
    next.splice(to, 0, dragKey);
    setColOrder(next);
  }

  const filtered = useMemo(() => {
    if (!searchable || !search.trim()) return rows;
    const term = search.trim().toLowerCase();
    return rows.filter((row) => searchKeys.some((key) => String(row[key] ?? "").toLowerCase().includes(term)));
  }, [rows, search, searchable, searchKeys]);

  const sorted = useMemo(() => {
    const col = columns.find((c) => c.key === sortKey);
    if (!col) return filtered;
    const getValue = col.sortValue || ((row) => row[col.key]);
    const copy = [...filtered];
    copy.sort((a, b) => {
      const av = getValue(a);
      const bv = getValue(b);
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "string") {
        return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      return sortDir === "asc" ? av - bv : bv - av;
    });
    return copy;
  }, [filtered, sortKey, sortDir, columns]);

  function toggleSort(key) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  const DEFAULT_COLUMN_WIDTH = 120;
  const MIN_COLUMN_WIDTH = 50;
  function columnWidth(col) {
    return colWidths[col.key] ?? col.maxWidth ?? DEFAULT_COLUMN_WIDTH;
  }

  // `table-layout: fixed` (applied via .tableResizable, only while this prop
  // is on) is what makes a dragged width actually stick — with the default
  // `auto` layout the browser is still free to renegotiate every column's
  // width around its content on each render, which would fight a user's own
  // resize. Fixed layout needs an explicit width on every column to behave
  // predictably, which is exactly what columnWidth() guarantees via its
  // DEFAULT_COLUMN_WIDTH fallback.
  function startResize(e, col) {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startWidth = columnWidth(col);
    dragRef.current = { key: col.key };
    function onMove(ev) {
      const next = Math.max(MIN_COLUMN_WIDTH, Math.round(startWidth + (ev.clientX - startX)));
      setColWidths((prev) => ({ ...prev, [col.key]: next }));
    }
    function onUp() {
      dragRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  if (!rows || rows.length === 0) {
    return <p className={styles.sub}>{emptyMessage}</p>;
  }

  return (
    <div>
      {(searchable || orderedColumns.length > 1) && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 10, flexWrap: "wrap" }}>
          {searchable ? (
            <div style={{ position: "relative", width: "100%", maxWidth: 280 }}>
              <span
                style={{
                  position: "absolute",
                  left: 11,
                  top: "50%",
                  transform: "translateY(-50%)",
                  color: "var(--t3)",
                  pointerEvents: "none",
                }}
              >
                <SearchIcon size={13} />
              </span>
              <input
                type="text"
                className={styles.select}
                placeholder={searchPlaceholder}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ width: "100%", paddingLeft: 30 }}
              />
            </div>
          ) : (
            <span />
          )}
          {orderedColumns.length > 1 && (
            <button
              type="button"
              className={styles.btnSecondary}
              onClick={() => setFirstColFrozen((f) => !f)}
              style={{ display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}
            >
              <PinIcon size={12} />
              {firstColFrozen ? "Unfreeze column" : "Freeze first column"}
            </button>
          )}
        </div>
      )}

      {sorted.length === 0 ? (
        <p className={styles.sub}>No matches for &quot;{search}&quot;.</p>
      ) : (
        <div className={styles.tableScroll} style={{ maxHeight }}>
          <table
            className={resizableColumns ? `${styles.table} ${styles.tableResizable}` : styles.table}
            style={
              // table-layout: fixed only actually honors each column's own
              // width when the TABLE itself also has a definite width to
              // divide up — left as `auto` (unset), the browser silently
              // falls back to its own sizing and every per-column width set
              // below (including a user's own drag) gets ignored. Summing
              // the columns' own widths here is exactly that definite width,
              // and makes the table wider than its container whenever that
              // sum exceeds it — which is what lets .tableScroll's
              // overflow: auto actually scroll instead of squeezing columns.
              resizableColumns ? { width: orderedColumns.reduce((sum, col) => sum + columnWidth(col), 0) } : undefined
            }
          >
            <thead>
              <tr>
                {orderedColumns.map((col) => {
                  const isFrozen = col.key === activeFrozenKey;
                  return (
                    <th
                      key={col.key}
                      draggable={orderedColumns.length > 1}
                      onDragStart={() => setDragKey(col.key)}
                      onDragOver={(e) => {
                        e.preventDefault();
                        if (col.key !== dragKey) setDragOverKey(col.key);
                      }}
                      onDragLeave={() => setDragOverKey((k) => (k === col.key ? null : k))}
                      onDrop={(e) => {
                        e.preventDefault();
                        handleColumnDrop(col.key);
                        setDragKey(null);
                        setDragOverKey(null);
                      }}
                      onDragEnd={() => {
                        setDragKey(null);
                        setDragOverKey(null);
                      }}
                      onClick={() => toggleSort(col.key)}
                      className={dragOverKey === col.key && dragKey !== col.key ? styles.colDragOver : undefined}
                      style={{
                        cursor: "pointer",
                        textAlign: col.align || "left",
                        // NOT `position: resizableColumns ? "relative" : …` —
                        // that used to live here to anchor the resize
                        // handle's `position: absolute` below, but inline
                        // `position` on the `<th>` overrides the sticky
                        // header CSS below it (`.tableScroll .table thead
                        // th`), silently turning every resizable table's
                        // header back into normal, non-sticky flow content —
                        // this is what the header stopping scrolling with
                        // the top actually was. `position: sticky` (from
                        // that CSS rule, applies regardless of
                        // resizableColumns) already establishes its own
                        // containing block, so the resize handle anchors to
                        // it correctly with no inline override needed here.
                        width: resizableColumns ? columnWidth(col) : undefined,
                      }}
                    >
                      {/* A header cell that's BOTH the sticky-top header row
                          (every `th`, via the CSS class below) AND the
                          frozen column (sticky-left, like the body cells
                          below) needs both offsets on the same element —
                          browsers reliably lose the `top` stickiness the
                          moment a table cell also gets `left` stickiness.
                          Splitting them across two elements (this `th` stays
                          exactly like every other — sticky-top only — and an
                          inner wrapper does the sticky-left) sidesteps that
                          dual-axis bug entirely; a plain, non-frozen header
                          never needs the wrapper. */}
                      {isFrozen ? (
                        <div
                          style={{
                            position: "sticky",
                            left: 0,
                            zIndex: 2,
                            width: "100%",
                            background: "rgba(var(--bg-rgb), 0.95)",
                            boxShadow: "1px 0 0 var(--border2)",
                          }}
                        >
                          {orderedColumns.length > 1 && (
                            <span className={styles.colDragHandle} aria-hidden="true">
                              <GripIcon size={10} />
                            </span>
                          )}
                          {col.label}
                          {sortKey === col.key ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
                        </div>
                      ) : (
                        <>
                          {orderedColumns.length > 1 && (
                            <span className={styles.colDragHandle} aria-hidden="true">
                              <GripIcon size={10} />
                            </span>
                          )}
                          {col.label}
                          {sortKey === col.key ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
                        </>
                      )}
                      {resizableColumns && (
                        <span
                          className={styles.colResizeHandle}
                          onMouseDown={(e) => startResize(e, col)}
                          onClick={(e) => e.stopPropagation()}
                          role="separator"
                          aria-orientation="vertical"
                          aria-label={`Resize ${typeof col.label === "string" ? col.label : col.key} column`}
                        />
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {sorted.map((row, i) => (
                <Fragment key={row.id ?? i}>
                  <tr
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    className={rowClassName ? rowClassName(row) : undefined}
                    style={onRowClick ? { cursor: "pointer" } : undefined}
                  >
                    {orderedColumns.map((col) => renderCell(col, row, { activeFrozenKey, resizableColumns, columnWidth }))}
                  </tr>
                  {renderRowExtra ? renderRowExtra(row) : null}
                </Fragment>
              ))}
              {pinnedRow && (
                <tr className={styles.pinnedRow}>
                  {orderedColumns.map((col) => renderCell(col, pinnedRow, { activeFrozenKey, resizableColumns, columnWidth }))}
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
