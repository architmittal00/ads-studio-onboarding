import { useMemo, useState } from "react";
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
// `<tr>` — e.g. to highlight rows that need attention.
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
}) {
  const [sortKey, setSortKey] = useState(defaultSortKey || columns[0]?.key);
  const [sortDir, setSortDir] = useState(defaultSortDir);
  const [search, setSearch] = useState("");

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
          <table className={styles.table}>
            <thead>
              <tr>
                {columns.map((col) => (
                  <th
                    key={col.key}
                    onClick={() => toggleSort(col.key)}
                    style={{ cursor: "pointer", textAlign: col.align || "left" }}
                  >
                    {col.label}
                    {sortKey === col.key ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
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
                    if (!col.maxWidth) {
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
                      <td key={col.key} style={{ textAlign: col.align || "left" }}>
                        <div title={title} className={styles.clamp3} style={{ maxWidth: col.maxWidth }}>
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
