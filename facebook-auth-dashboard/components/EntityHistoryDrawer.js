import { useEffect, useMemo, useState } from "react";
import CopyIdButton from "./CopyIdButton";
import { CloseIcon, ChevronIcon } from "./icons";
import Loader from "./Loader";
import { humanizeStatus } from "@/lib/insightsMetrics";
import { describeChangeDetail } from "@/lib/activityChangeDetail";
import { parseJsonResponse } from "@/lib/fetchJson";
import styles from "@/styles/Home.module.css";

const LEVEL_LABEL = { campaign: "Campaign", adset: "Ad Set", ad: "Ad" };
const CHILDREN_NOTE = { campaign: "this campaign, its ad sets and its ads", adset: "this ad set and its ads", ad: "this ad" };
const CACHE_MS = 5 * 60 * 1000;
const cache = new Map(); // entityId -> { at, data }

// What changed, in a few words: a budget shows "₹1,500/day → ₹1,650/day", a status change shows where it went.
function detailOf(extraData) {
  const detail = describeChangeDetail(extraData);
  if (detail) return detail.text;
  const to = extraData?.new_value;
  return typeof to === "string" || typeof to === "number" ? `→ ${to}` : null;
}

// What kind of change an entry is, so the list can be read by type ("marked paused", "budget changes", …) instead of as one
// long stream. Meta's wording differs per level, so this goes by the event name, its label and the new value.
const CATEGORIES = [
  { key: "activated", label: "Marked active", badge: "badgeGood" },
  { key: "paused", label: "Marked paused", badge: "badgeDanger" },
  { key: "budget", label: "Budget changes", badge: "badgeWarn" },
  { key: "created", label: "Created", badge: "badgeInfo" },
  { key: "delivery", label: "Delivery started or stopped", badge: "badgeInfo" },
  { key: "targeting", label: "Targeting", badge: "badgeInfo" },
  { key: "creative", label: "Creative and copy", badge: "badgeInfo" },
  { key: "bidding", label: "Bid and goal", badge: "badgeInfo" },
  { key: "schedule", label: "Schedule", badge: "badgeInfo" },
  { key: "removed", label: "Archived or deleted", badge: "badgeDanger" },
  { key: "review", label: "Review status", badge: "badgeInfo" },
  { key: "other", label: "Other changes", badge: "badgeInfo" },
];
const CATEGORY_BY_KEY = Object.fromEntries(CATEGORIES.map((c) => [c.key, c]));

function categoryOf(e) {
  const text = `${e.eventType || ""} ${e.label || ""}`.toLowerCase();
  const to = String(e.extraData?.new_value ?? "").toLowerCase();
  if (/deliver/.test(text)) return "delivery";
  if (/run_status|status updated|status changed/.test(text)) {
    if (to === "active") return "activated";
    if (to === "paused" || to === "inactive") return "paused";
    if (/archiv|delet/.test(to)) return "removed";
    return "review"; // Pending Review, Disapproved, …
  }
  if (/budget/.test(text)) return "budget";
  if (/creat/.test(text)) return "created";
  if (/archiv|delet/.test(text)) return "removed";
  if (/target|audience|placement/.test(text)) return "targeting";
  if (/creative|\bcopy\b|image|video|headline|text/.test(text)) return "creative";
  if (/\bbid\b|cost cap|roas|goal|optimi[sz]ation|attribution/.test(text)) return "bidding";
  if (/schedule|start time|end time|date|run time/.test(text)) return "schedule";
  return "other";
}

const dayKey = (iso) => new Date(iso).toDateString();
const dayLabel = (iso) => new Date(iso).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
const timeLabel = (iso) => new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
const shortWhen = (iso) => `${new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" })}, ${timeLabel(iso)}`;
const SECTION_PREVIEW = 10; // rows shown per type before "Show more"

// One change: when, which item (and its level), what the log says, what changed, who did it. In the by-day view `tag`
// shows the change's type next to the item, since the list is no longer split by type there.
function ChangeRow({ e, entity, when, tag }) {
  const detail = detailOf(e.extraData);
  const isSelf = e.objectId === entity.entityId;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "88px minmax(0, 1fr)", gap: 12, padding: "10px 0", borderTop: "1px solid var(--border)" }}>
      <span className={styles.muted} style={{ fontWeight: 600 }}>
        {when}
      </span>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <span className={styles.badgeInfo} style={{ flexShrink: 0 }}>
            {LEVEL_LABEL[e.level] || e.level}
          </span>
          <strong style={{ fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={e.objectName || e.objectId}>
            {isSelf ? "This " + (LEVEL_LABEL[e.level] || "item").toLowerCase() : e.objectName || e.objectId}
          </strong>
          {tag && (
            <span className={styles[tag.badge]} style={{ flexShrink: 0, marginLeft: "auto" }}>
              {tag.label}
            </span>
          )}
        </div>
        <p style={{ margin: "4px 0 0", fontSize: 13 }}>
          {e.label}
          {detail ? <strong>{detail.startsWith("→") ? ` ${detail}` : ` · ${detail}`}</strong> : null}
        </p>
        <p className={styles.muted} style={{ margin: "2px 0 0", fontWeight: 400 }}>
          by {e.actor}
        </p>
      </div>
    </div>
  );
}

// Custom Views' "Change history": every change the Activity Log recorded in the last 72 hours for one campaign, ad set
// or ad — including what happened below it (a campaign: its ad sets and ads; an ad set: its ads). Read-only.
// entity: { level, entityId, entityName, accountId, status }
export default function EntityHistoryDrawer({ entity, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [levelFilter, setLevelFilter] = useState("all");
  const [groupBy, setGroupBy] = useState("type"); // "type" | "time"
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [showAll, setShowAll] = useState(() => new Set());

  useEffect(() => {
    if (!entity) return;
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [entity, onClose]);

  const entityKey = entity ? `${entity.accountId}:${entity.entityId}` : null;
  useEffect(() => {
    if (!entityKey) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- starts again for the newly opened row
    setLevelFilter("all");
    const hit = cache.get(entityKey);
    if (hit && Date.now() - hit.at < CACHE_MS) {
      setData(hit.data);
      setError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setData(null);
    setError(null);
    setLoading(true);
    const params = new URLSearchParams({ accountId: entity.accountId, level: entity.level, entityId: entity.entityId });
    fetch(`/api/fb/entity-history?${params.toString()}`)
      .then(parseJsonResponse)
      .then((json) => {
        if (cancelled) return;
        if (json.error) {
          setError(json.error);
          return;
        }
        cache.set(entityKey, { at: Date.now(), data: json });
        setData(json);
      })
      .catch((err) => !cancelled && setError(err.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by the row, not the object
  }, [entityKey]);

  const events = useMemo(() => data?.events || [], [data]);
  const counts = useMemo(() => {
    const c = {};
    for (const e of events) c[e.level] = (c[e.level] || 0) + 1;
    return c;
  }, [events]);
  const visible = levelFilter === "all" ? events : events.filter((e) => e.level === levelFilter);
  const sections = useMemo(() => {
    const byKey = new Map();
    for (const e of visible) {
      const key = categoryOf(e);
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(e);
    }
    return CATEGORIES.filter((c) => byKey.has(c.key)).map((c) => ({ ...c, items: byKey.get(c.key) }));
  }, [visible]);
  const days = useMemo(() => {
    const groups = [];
    for (const e of visible) {
      const key = dayKey(e.time);
      if (!groups.length || groups[groups.length - 1].key !== key) groups.push({ key, label: dayLabel(e.time), items: [] });
      groups[groups.length - 1].items.push(e);
    }
    return groups;
  }, [visible]);

  if (!entity) return null;
  const levelsPresent = ["campaign", "adset", "ad"].filter((l) => counts[l]);

  return (
    <div className={styles.drawerOverlay} onClick={onClose}>
      <div className={styles.drawerPanel} onClick={(e) => e.stopPropagation()} style={{ display: "flex", flexDirection: "column", padding: 0, overflowY: "hidden" }}>
        <div style={{ flexShrink: 0, padding: "28px 28px 0" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <p className={styles.muted} style={{ margin: 0 }}>
              Change history · {LEVEL_LABEL[entity.level] || "Entity"}
            </p>
            <button type="button" onClick={onClose} aria-label="Close" className={styles.btnSecondary} style={{ padding: 6 }}>
              <CloseIcon size={14} />
            </button>
          </div>
          <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 8 }}>
            <h2 className={styles.h2} style={{ marginBottom: 4 }}>
              {entity.entityName || entity.entityId}
            </h2>
            <CopyIdButton id={entity.entityId} />
            {entity.status && <span className={entity.status === "ACTIVE" ? styles.badgeGood : styles.badgeInfo}>{humanizeStatus(entity.status)}</span>}
          </div>
          <p className={styles.sub} style={{ margin: "0 0 12px" }}>
            Changes in the last 72 hours to {CHILDREN_NOTE[entity.level] || "this item"}.
          </p>
          {levelsPresent.length > 1 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, paddingBottom: 12 }}>
              <button type="button" onClick={() => setLevelFilter("all")} className={levelFilter === "all" ? `${styles.tab} ${styles.tabActive}` : styles.tab} style={{ padding: "4px 10px", fontSize: 11 }}>
                All ({events.length})
              </button>
              {levelsPresent.map((l) => (
                <button key={l} type="button" onClick={() => setLevelFilter(l)} className={levelFilter === l ? `${styles.tab} ${styles.tabActive}` : styles.tab} style={{ padding: "4px 10px", fontSize: 11 }}>
                  {LEVEL_LABEL[l]} ({counts[l]})
                </button>
              ))}
            </div>
          )}
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "0 28px 28px" }}>
          {loading && <Loader label="Reading the activity log…" />}
          {error && <div className={styles.error}>{error}</div>}
          {!loading && !error && data && events.length === 0 && <p className={styles.sub}>No changes recorded in the last 72 hours.</p>}
          {data?.truncated && <p className={styles.sub}>Showing the latest {events.length} changes.</p>}
          {data?.partial && <p className={styles.sub}>This is a very large item, so part of the history below it may be missing.</p>}
          {!loading && !error && events.length > 0 && (
            <div className={styles.tabGroup} role="radiogroup" aria-label="Group by" style={{ margin: "4px 0 10px" }}>
              <button type="button" role="radio" aria-checked={groupBy === "type"} className={`${styles.tab} ${groupBy === "type" ? styles.tabActive : ""}`} onClick={() => setGroupBy("type")}>
                By type
              </button>
              <button type="button" role="radio" aria-checked={groupBy === "time"} className={`${styles.tab} ${groupBy === "time" ? styles.tabActive : ""}`} onClick={() => setGroupBy("time")}>
                By day
              </button>
            </div>
          )}

          {groupBy === "type" &&
            sections.map((sec) => {
              const isCollapsed = collapsed.has(sec.key);
              const expanded = showAll.has(sec.key);
              const shown = expanded ? sec.items : sec.items.slice(0, SECTION_PREVIEW);
              return (
                <section key={sec.key} className={styles.card} style={{ padding: 0, marginTop: 10, overflow: "hidden" }}>
                  <button
                    type="button"
                    onClick={() => setCollapsed((prev) => { const next = new Set(prev); if (next.has(sec.key)) next.delete(sec.key); else next.add(sec.key); return next; })}
                    aria-expanded={!isCollapsed}
                    style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "10px 14px", border: 0, background: "none", cursor: "pointer", font: "inherit", color: "var(--t1)", textAlign: "left" }}
                  >
                    <ChevronIcon direction={isCollapsed ? "right" : "down"} size={12} />
                    <span className={styles[sec.badge]}>{sec.label}</span>
                    <span className={styles.muted} style={{ fontWeight: 600 }}>
                      {sec.items.length}
                    </span>
                  </button>
                  {!isCollapsed && (
                    <div style={{ padding: "0 14px 6px" }}>
                      {shown.map((e) => (
                        <ChangeRow key={e.id} e={e} entity={entity} when={shortWhen(e.time)} />
                      ))}
                      {sec.items.length > SECTION_PREVIEW && (
                        <button type="button" className={styles.recWhyBtn} style={{ margin: "6px 0 8px" }} onClick={() => setShowAll((prev) => { const next = new Set(prev); if (next.has(sec.key)) next.delete(sec.key); else next.add(sec.key); return next; })}>
                          {expanded ? "Show fewer" : `Show ${sec.items.length - SECTION_PREVIEW} more`}
                        </button>
                      )}
                    </div>
                  )}
                </section>
              );
            })}

          {groupBy === "time" &&
            days.map((day) => (
              <section key={day.key} style={{ marginTop: 6 }}>
                <p className={styles.muted} style={{ margin: "10px 0 6px" }}>
                  {day.label}
                </p>
                <div style={{ display: "flex", flexDirection: "column" }}>
                  {day.items.map((e) => (
                    <ChangeRow key={e.id} e={e} entity={entity} when={timeLabel(e.time)} tag={CATEGORY_BY_KEY[categoryOf(e)]} />
                  ))}
                </div>
              </section>
            ))}
        </div>
      </div>
    </div>
  );
}
