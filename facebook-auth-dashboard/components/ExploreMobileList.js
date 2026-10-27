import { useMemo, useState } from "react";
import styles from "@/styles/Home.module.css";
import Thumb from "./Thumb";
import Loader from "./Loader";
import BottomSheet from "./BottomSheet";
import { ChevronIcon, SearchIcon, SortIcon, CheckIcon } from "./icons";
import { humanizeStatus } from "@/lib/insightsMetrics";

// How many metrics a card shows before "+N more" — three columns × two rows
// is what fits a 375px screen without the numbers getting cramped.
const VISIBLE_METRICS = 9;

function statusTone(status) {
  if (status === "ACTIVE") return styles.statusDotOn;
  if (status === "PAUSED") return styles.statusDotOff;
  return styles.statusDotWarn;
}

// Phone replacement for the results *table* (pages/explore.js's
// ExploreResultsTable): the same rows, filters, selection, drill-down and row
// actions, but laid out as a ranked list of cards — one entity per card, its
// metrics in a 3-column grid — because a 10+ column table can't be read on a
// 375px screen no matter how it's squeezed. All data/state stays owned by the
// parent; this only presents it.
export default function ExploreMobileList({
  rows,
  level,
  metricColumns,
  sortColumns,
  statusAvailable,
  totalsRow,
  renderMetric,
  getTitle,
  getSubtitle,
  sortKey,
  sortDir,
  onSortChange,
  search,
  onSearchChange,
  selectedIds,
  onToggleSelected,
  onSelectAll,
  allSelected,
  drill,
  renderActions,
  onViewDetails,
  onOpenThumb,
  selectable = true,
  kpiKeys,
  toolbarExtra,
  renderLead,
}) {
  const [sortOpen, setSortOpen] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [expandedCards, setExpandedCards] = useState(() => new Set());

  const activeSort = sortColumns.find((c) => c.key === sortKey) || sortColumns.find((c) => metricColumns.some((m) => m.key === c.key)) || sortColumns[0];

  const visibleRows = useMemo(() => {
    const term = (search || "").trim().toLowerCase();
    let out = rows;
    if (term) out = out.filter((r) => `${getTitle(r)} ${getSubtitle(r)}`.toLowerCase().includes(term));
    if (!activeSort) return out;
    const getValue = activeSort.sortValue || ((r) => r[activeSort.key]);
    const copy = [...out];
    copy.sort((a, b) => {
      const av = getValue(a);
      const bv = getValue(b);
      if (av == null || av === -Infinity) return 1;
      if (bv == null || bv === -Infinity) return -1;
      if (typeof av === "string") return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      return sortDir === "asc" ? av - bv : bv - av;
    });
    return copy;
  }, [rows, search, activeSort, sortDir, getTitle, getSubtitle]);

  // The metric being sorted by leads each card's grid and is tinted, so the
  // ranking you asked for is visible on every card without hunting for it.
  const orderedMetrics = useMemo(() => {
    const lead = metricColumns.find((m) => m.key === activeSort?.key);
    return lead ? [lead, ...metricColumns.filter((m) => m !== lead)] : metricColumns;
  }, [metricColumns, activeSort]);

  function toggleCardExpanded(id) {
    setExpandedCards((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function renderMetricGrid(row, cardId) {
    const showAll = expandedCards.has(cardId);
    const shown = showAll ? orderedMetrics : orderedMetrics.slice(0, VISIBLE_METRICS);
    const hidden = orderedMetrics.length - shown.length;
    return (
      <>
        <div className={styles.cardMetrics}>
          {shown.map((m) => (
            <div key={m.key} className={styles.cardMetric}>
              <div className={m.key === activeSort?.key ? `${styles.cardMetricLabel} ${styles.cardMetricLabelActive}` : styles.cardMetricLabel}>
                {m.label}
              </div>
              <div className={styles.cardMetricValue}>{renderMetric(row, m.key)}</div>
            </div>
          ))}
        </div>
        {(hidden > 0 || showAll) && orderedMetrics.length > VISIBLE_METRICS && (
          <button type="button" className={styles.cardLinkBtn} onClick={() => toggleCardExpanded(cardId)}>
            {showAll ? "Show fewer metrics" : `+${hidden} more metric${hidden === 1 ? "" : "s"}`}
          </button>
        )}
      </>
    );
  }

  // One entity card. `depth` > 0 is a drilled-into child (ad set under a
  // campaign, ad under an ad set) — indented behind a rail so the hierarchy
  // reads at a glance.
  function renderCard(row, rowLevel, depth, onApplied) {
    const id = row.entityId;
    const selected = !!id && selectedIds.has(id);
    const title = getTitle(row);
    const subtitle = getSubtitle(row);
    const childPlural = drill.plural(drill.childLevel(rowLevel));
    const exp = id ? drill.expansions[id] : null;
    const isOpen = !!exp?.open;
    const canDrill = !!id && drill.enabled && !!drill.childLevel(rowLevel);
    return (
      <div key={id || title} className={depth > 0 ? styles.cardChildWrap : undefined}>
        <div className={selected ? `${styles.rowCard} ${styles.rowCardSelected}` : styles.rowCard}>
          <div className={styles.rowCardHead}>
            {selectMode && depth === 0 && id && (
              <button
                type="button"
                className={selected ? `${styles.selectDot} ${styles.selectDotOn}` : styles.selectDot}
                onClick={() => onToggleSelected(id)}
                aria-label={selected ? "Deselect" : "Select"}
                aria-pressed={selected}
              >
                {selected && <CheckIcon size={13} />}
              </button>
            )}
            {renderLead && renderLead(row)}
            {!renderLead && rowLevel === "ad" && (
              <Thumb
                src={row.thumbnailUrl}
                isVideo={row.isVideo}
                loading={row.thumbnailUrl === undefined}
                size={48}
                onClick={id ? () => onOpenThumb(row, title) : undefined}
              />
            )}
            <button
              type="button"
              className={styles.rowCardTitleBtn}
              onClick={() => {
                if (selectMode && depth === 0 && id) onToggleSelected(id);
                else if (id) onViewDetails({ level: rowLevel, id, name: title });
              }}
            >
              <span className={styles.rowCardTitle}>{title}</span>
              {(subtitle || (statusAvailable && row.status)) && (
                <span className={styles.rowCardSub}>
                  {statusAvailable && row.status && (
                    <>
                      <span className={`${styles.statusDot} ${statusTone(row.status)}`} />
                      {humanizeStatus(row.status)}
                    </>
                  )}
                  {statusAvailable && row.status && subtitle ? " · " : ""}
                  {subtitle}
                </span>
              )}
            </button>
            {!selectMode && id && renderActions(row, rowLevel, onApplied)}
          </div>
          {renderMetricGrid(row, `${depth}:${id || title}`)}
          {canDrill && (
            <button type="button" className={styles.cardDrillBtn} onClick={() => drill.onToggle(row, rowLevel)}>
              {isOpen ? "Hide" : "View"} {childPlural}
              <ChevronIcon direction={isOpen ? "up" : "down"} size={13} />
            </button>
          )}
        </div>
        {canDrill && exp && renderChildren(id, exp, depth)}
      </div>
    );
  }

  function renderChildren(parentId, exp, depth) {
    if (exp.status === "loading") {
      return (
        <div className={styles.cardChildWrap}>
          <Loader inline label={`Loading ${drill.plural(exp.childLevel)}…`} />
        </div>
      );
    }
    if (exp.status === "error") {
      return (
        <div className={styles.cardChildWrap}>
          <span className={styles.error} style={{ display: "block", marginBottom: 8 }}>
            {exp.error}
          </span>
          <button type="button" className={styles.btnSecondary} onClick={() => drill.onRetry(exp)}>
            Retry
          </button>
        </div>
      );
    }
    if (!exp.open) return null;
    const ordered = drill.orderChildren(exp.rows);
    if (ordered.length === 0) {
      return <div className={`${styles.cardChildWrap} ${styles.muted}`}>No {drill.plural(exp.childLevel)} match.</div>;
    }
    return ordered.map((child) => renderCard(child, exp.childLevel, depth + 1, drill.onChildApplied));
  }

  // Time-pivot mode: a card per entity (aggregate over the range) whose date
  // rows open beneath it as compact cards.
  function renderPivotCard(row) {
    const id = row.entityId;
    const open = drill.pivotOpenIds.has(id);
    const base = renderCardShell(row, 0, () => drill.onTogglePivot(id), open);
    return base;
  }

  function renderCardShell(row, depth, onToggle, open) {
    const id = row.entityId;
    const selected = !!id && selectedIds.has(id);
    const title = getTitle(row);
    return (
      <div key={id || title}>
        <div className={selected ? `${styles.rowCard} ${styles.rowCardSelected}` : styles.rowCard}>
          <div className={styles.rowCardHead}>
            {selectMode && id && (
              <button
                type="button"
                className={selected ? `${styles.selectDot} ${styles.selectDotOn}` : styles.selectDot}
                onClick={() => onToggleSelected(id)}
                aria-label={selected ? "Deselect" : "Select"}
                aria-pressed={selected}
              >
                {selected && <CheckIcon size={13} />}
              </button>
            )}
            {renderLead && renderLead(row)}
            {!renderLead && level === "ad" && (
              <Thumb src={row.thumbnailUrl} isVideo={row.isVideo} loading={row.thumbnailUrl === undefined} size={48} onClick={id ? () => onOpenThumb(row, title) : undefined} />
            )}
            <button
              type="button"
              className={styles.rowCardTitleBtn}
              onClick={() => {
                if (selectMode && id) onToggleSelected(id);
                else if (id) onViewDetails({ level, id, name: title });
              }}
            >
              <span className={styles.rowCardTitle}>{title}</span>
              {statusAvailable && row.status && (
                <span className={styles.rowCardSub}>
                  <span className={`${styles.statusDot} ${statusTone(row.status)}`} />
                  {humanizeStatus(row.status)}
                </span>
              )}
            </button>
            {!selectMode && id && renderActions(row, level, drill.onTopApplied)}
          </div>
          {renderMetricGrid(row, `p:${id}`)}
          <button type="button" className={styles.cardDrillBtn} onClick={onToggle}>
            {open ? "Hide" : "View"} day-by-day
            <ChevronIcon direction={open ? "up" : "down"} size={13} />
          </button>
        </div>
        {open && (
          <div className={styles.cardChildWrap}>
            {drill.orderChildren(drill.pivotChildren.get(id) || []).map((d) => (
              <div key={d.date} className={styles.rowCard}>
                <div className={styles.rowCardTitle} style={{ marginBottom: 8 }}>
                  {drill.pivotDateLabel(d.date)}
                </div>
                {renderMetricGrid(d, `d:${id}:${d.date}`)}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  const sortLabel = activeSort?.label || "Sort";

  return (
    <div className={styles.mobileList}>
      <div className={styles.mobileListToolbar}>
        <div className={styles.mobileSearch}>
          <SearchIcon size={15} />
          <input
            type="search"
            value={search || ""}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search"
            aria-label="Search rows"
          />
        </div>
        <button type="button" className={styles.mobileToolBtn} onClick={() => setSortOpen(true)}>
          <SortIcon size={14} />
          <span className={styles.mobileToolBtnLabel}>{sortLabel}</span>
          <span aria-hidden>{sortDir === "asc" ? "↑" : "↓"}</span>
        </button>
        {toolbarExtra}
        {selectable && rows.some((r) => r.entityId) && (
          <button
            type="button"
            className={selectMode ? `${styles.mobileToolBtn} ${styles.mobileToolBtnOn}` : styles.mobileToolBtn}
            onClick={() => setSelectMode((v) => !v)}
          >
            {selectMode ? "Done" : "Select"}
          </button>
        )}
      </div>

      {selectMode && (
        <div className={styles.selectAllRow}>
          <button type="button" className={styles.cardLinkBtn} onClick={onSelectAll}>
            {allSelected ? "Clear all" : `Select all ${rows.filter((r) => r.entityId).length}`}
          </button>
        </div>
      )}

      {totalsRow && (
        <div className={styles.kpiStrip} aria-label="Totals">
          {metricColumns.filter((m) => !kpiKeys || kpiKeys.includes(m.key)).map((m) => (
            <div key={m.key} className={styles.kpiTile}>
              <div className={styles.kpiLabel}>{m.label}</div>
              <div className={styles.kpiValue}>{renderMetric(totalsRow, m.key)}</div>
            </div>
          ))}
        </div>
      )}

      {visibleRows.length === 0 ? (
        <p className={styles.sub} style={{ textAlign: "center", padding: "24px 0" }}>
          {search ? "No rows match your search." : "No rows."}
        </p>
      ) : (
        <div className={styles.cardList}>
          {visibleRows.map((row) => (drill.pivotEnabled ? renderPivotCard(row) : renderCard(row, level, 0, drill.onTopApplied)))}
        </div>
      )}

      <BottomSheet open={sortOpen} title="Sort by" onClose={() => setSortOpen(false)}>
        <div className={styles.tabGroup} style={{ marginBottom: 12 }}>
          <button className={sortDir === "desc" ? `${styles.tab} ${styles.tabActive}` : styles.tab} onClick={() => onSortChange(activeSort.key, "desc")}>
            High → Low
          </button>
          <button className={sortDir === "asc" ? `${styles.tab} ${styles.tabActive}` : styles.tab} onClick={() => onSortChange(activeSort.key, "asc")}>
            Low → High
          </button>
        </div>
        <div className={styles.sheetList}>
          {sortColumns.map((c) => (
            <button
              key={c.key}
              type="button"
              className={styles.sheetListItem}
              onClick={() => {
                onSortChange(c.key, c.key === activeSort?.key ? sortDir : c.isName ? "asc" : "desc");
                setSortOpen(false);
              }}
            >
              <span style={{ flex: 1 }}>{c.label}</span>
              {c.key === activeSort?.key && <CheckIcon size={16} />}
            </button>
          ))}
        </div>
      </BottomSheet>
    </div>
  );
}
