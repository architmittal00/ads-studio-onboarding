import { useEffect, useState } from "react";
import InvestigateResults from "./InvestigateResults";
import CopyIdButton from "./CopyIdButton";
import { CloseIcon } from "./icons";
import DatePicker from "./DatePicker";
import { humanizeStatus } from "@/lib/insightsMetrics";
import { useMonitor, monitorKey } from "@/lib/monitorStore";
import styles from "@/styles/Home.module.css";

const LEVEL_LABEL = { campaign: "Campaign", adset: "Ad Set", ad: "Ad" };

const QUICK_DAYS = [
  { days: 1, label: "Yesterday" },
  { days: 3, label: "3 days ago" },
  { days: 7, label: "7 days ago" },
  { days: 14, label: "14 days ago" },
];
const daysBefore = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) - n * 86400000).toISOString().slice(0, 10);

const pad = (n) => String(n).padStart(2, "0");
const localDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// The calendar day (YYYY-MM-DD) a moment falls on, in the ad account's time zone when it is known, else the browser's.
function dayOf(ms, timeZone) {
  try {
    if (timeZone) return new Date(ms).toLocaleDateString("en-CA", { timeZone });
  } catch {}
  return localDate(new Date(ms));
}

function formatDayLabel(dateStr) {
  return new Date(`${dateStr}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

// Custom Views' "Investigate": the Recent Changes investigation for any campaign or ad set, with the day picked by the
// user instead of being the day a change happened. Everything below the date — the metric picker, the before/after
// comparison windows, and the drill-down into the ads inside — is the same as there.
// An item on the Monitor list opens on the day it was added to Monitor (from the database); any other row starts empty.
// entity: { level: "campaign" | "adset", entityId, entityName, accountId, status }
export default function EntityInvestigateDrawer({ entity, onClose, currency, timeZone }) {
  const monitor = useMonitor();
  const addedAt = entity ? monitor.items.find((i) => i.key === monitorKey(entity.level, entity.entityId))?.addedAt : null;
  const today = localDate(new Date());
  const addedDate = addedAt ? dayOf(addedAt, timeZone) : "";
  // What the person picked in this drawer; until they pick, the day it was added to Monitor (if it was) is used.
  const [picked, setPicked] = useState(null);
  const date = picked ?? (addedDate && addedDate <= today ? addedDate : "");
  const setDate = setPicked;
  // A different row opened: start again from an empty date.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resets the drawer's own state when the entity prop changes
    setPicked(null);
  }, [entity?.level, entity?.entityId]);

  useEffect(() => {
    if (!entity) return;
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [entity, onClose]);

  if (!entity) return null;

  return (
    <div className={styles.drawerOverlay} onClick={onClose}>
      <div className={styles.drawerPanel} onClick={(e) => e.stopPropagation()} style={{ display: "flex", flexDirection: "column", padding: 0, overflowY: "hidden" }}>
        <div style={{ flexShrink: 0, padding: "28px 28px 0" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <p className={styles.muted} style={{ margin: 0 }}>
              Investigate · {LEVEL_LABEL[entity.level] || "Entity"}
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
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "0 28px 28px" }}>
          <div className={styles.card} style={{ marginTop: 20, padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
            <label htmlFor="investigate-date" style={{ fontWeight: 700, fontSize: 13 }}>
              Date to investigate
            </label>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
              <DatePicker id="investigate-date" value={date} onChange={setDate} maxIso={today} />
              {QUICK_DAYS.map((q) => {
                const iso = daysBefore(today, q.days);
                return (
                  <button key={q.days} type="button" onClick={() => setDate(iso)} className={date === iso ? `${styles.tab} ${styles.tabActive}` : styles.tab} style={{ padding: "6px 12px", fontSize: 11.5 }}>
                    {q.label}
                  </button>
                );
              })}
            </div>
            <p className={styles.sub} style={{ margin: 0 }}>
              {addedDate && date === addedDate
                ? "Set to the day this was added to Monitor. "
                : "Pick the day something changed. "}
              Compare the days before it with what came after, or see every day on its own.
            </p>
          </div>

          {!date && (
            <p className={styles.sub} style={{ marginTop: 18 }}>
              Choose a date to see how performance moved around it.
            </p>
          )}

          {date && (
            <>
              <p className={styles.sub} style={{ marginTop: 18 }}>
                {formatDayLabel(date)}
              </p>
              <InvestigateResults key={`${entity.entityId}:${date}`} entity={entity} date={date} currency={currency} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
