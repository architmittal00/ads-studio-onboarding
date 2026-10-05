import { useMemo, useState } from "react";
import styles from "@/styles/Home.module.css";

// Generic sortable, scroll-capped table used across the report. `columns` is
// [{ key, label, align, render(row), sortValue(row), maxWidth, title(row) }]
// — sortValue defaults to row[key]; render defaults to the same. `maxWidth`
// (px) caps the column width; content wraps up to 3 lines and only then
// ellipsizes (see .clamp3), rather than truncating a single line. `title`
// supplies the hover tooltip text (falls back to row[key] if it's a string).
export default function SortableTable({
  columns,
  rows,
  defaultSortKey,
  defaultSortDir = "desc",
  maxHeight = 360,
  emptyMessage = "No data.",
  onRowClick,
}) {
  const [sortKey, setSortKey] = useState(defaultSortKey || columns[0]?.key);
  const [sortDir, setSortDir] = useState(defaultSortDir);

  const sorted = useMemo(() => {
    const col = columns.find((c) => c.key === sortKey);
    if (!col) return rows;
    const getValue = col.sortValue || ((row) => row[col.key]);
    const copy = [...rows];
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
  }, [rows, sortKey, sortDir, columns]);

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
                const title = col.title ? col.title(row) : typeof row[col.key] === "string" ? row[col.key] : undefined;
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
  );
}
