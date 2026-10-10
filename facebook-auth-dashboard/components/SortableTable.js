import { useMemo, useRef, useState } from "react";
import { SearchIcon } from "./icons";
import styles from "@/styles/Home.module.css";

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
// preference, like the sort/search state below — it doesn't persist across
// a fresh result, since a new query can bring an entirely different set of
// columns anyway).
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
}) {
  const [sortKey, setSortKey] = useState(defaultSortKey || columns[0]?.key);
  const [sortDir, setSortDir] = useState(defaultSortDir);
  const [search, setSearch] = useState("");
  // User-dragged widths only — a column with no entry here still falls back
  // to its own `maxWidth` (or the DEFAULT_COLUMN_WIDTH below), so adding/
  // removing columns between queries never leaves a stale width behind.
  const [colWidths, setColWidths] = useState({});
  const dragRef = useRef(null);

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
      {searchable && (
        <div style={{ position: "relative", marginBottom: 10, width: "100%", maxWidth: 280 }}>
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
              resizableColumns ? { width: columns.reduce((sum, col) => sum + columnWidth(col), 0) } : undefined
            }
          >
            <thead>
              <tr>
                {columns.map((col) => (
                  <th
                    key={col.key}
                    onClick={() => toggleSort(col.key)}
                    style={{
                      cursor: "pointer",
                      textAlign: col.align || "left",
                      position: resizableColumns ? "relative" : undefined,
                      width: resizableColumns ? columnWidth(col) : undefined,
                    }}
                  >
                    {col.label}
                    {sortKey === col.key ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
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
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((row, i) => (
                <tr
                  key={row.id ?? i}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={rowClassName ? rowClassName(row) : undefined}
                  style={onRowClick ? { cursor: "pointer" } : undefined}
                >
                  {columns.map((col) => {
                    const content = col.render ? col.render(row) : row[col.key];
                    const width = resizableColumns ? columnWidth(col) : col.maxWidth;
                    if (!width) {
                      return (
                        <td key={col.key} style={{ textAlign: col.align || "left" }}>
                          {content}
                        </td>
                      );
                    }
                    const title = col.title
                      ? col.title(row)
                      : typeof row[col.key] === "string"
                      ? row[col.key]
                      : undefined;
                    return (
                      <td key={col.key} style={{ textAlign: col.align || "left", width: resizableColumns ? width : undefined }}>
                        <div title={title} className={styles.clamp3} style={{ maxWidth: width }}>
                          {content}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
