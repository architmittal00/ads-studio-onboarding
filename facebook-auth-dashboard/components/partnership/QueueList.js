import { useState } from "react";
import { ChevronIcon } from "../icons";
import MediaThumbButton from "./MediaThumbButton";
import styles from "@/styles/Home.module.css";

const CTA_OPTIONS = ["SHOP_NOW", "LEARN_MORE", "SIGN_UP", "GET_OFFER", "BOOK_NOW"];

// One queued item — expandable to edit its own copy fields, same 5 fields
// as ready-to-launch.html's own per-item body (Primary Text/Headline/
// Description/CTA/Redirection Link), writing straight back to the
// localStorage queue on every change (no "save" step — there's no server
// round trip to debounce against).
function QueueRow({ item, checked, onToggleCheck, onChange, onRemove }) {
  const [expanded, setExpanded] = useState(false);
  const missingRequired = !item.primaryText?.trim() || !item.redirectionLink?.trim();

  return (
    <div className={styles.card} style={{ padding: 0, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", cursor: "pointer" }} onClick={() => setExpanded((e) => !e)}>
        <input type="checkbox" checked={checked} onChange={(e) => { e.stopPropagation(); onToggleCheck(); }} onClick={(e) => e.stopPropagation()} />
        <MediaThumbButton contentId={item.contentId} permalink={item.permalink} mediaType={item.mediaType} size={48} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ margin: 0, fontWeight: 700, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.name}</p>
          <span className={missingRequired ? styles.badgeWarn : styles.badgeGood} style={{ marginTop: 4, display: "inline-block" }}>
            {missingRequired ? "Needs copy" : "Ready for Review"}
          </span>
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className={styles.btnSecondary}
          style={{ padding: "4px 8px", fontSize: 11 }}
        >
          Remove
        </button>
        <ChevronIcon direction={expanded ? "up" : "down"} size={12} />
      </div>

      {expanded && (
        <div style={{ padding: "0 14px 14px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div style={{ gridColumn: "1 / -1" }}>
            <label className={styles.muted} style={{ fontSize: 11 }}>
              Ad Name
            </label>
            <input className={styles.select} style={{ width: "100%" }} value={item.name} onChange={(e) => onChange({ name: e.target.value })} />
          </div>
          <div>
            <label className={styles.muted} style={{ fontSize: 11 }}>
              Primary Text <span style={{ color: "var(--red)" }}>*</span>
            </label>
            <input className={styles.select} style={{ width: "100%" }} value={item.primaryText} onChange={(e) => onChange({ primaryText: e.target.value })} />
          </div>
          <div>
            <label className={styles.muted} style={{ fontSize: 11 }}>
              Headline
            </label>
            <input className={styles.select} style={{ width: "100%" }} value={item.headline} onChange={(e) => onChange({ headline: e.target.value })} />
          </div>
          <div>
            <label className={styles.muted} style={{ fontSize: 11 }}>
              Description
            </label>
            <input className={styles.select} style={{ width: "100%" }} value={item.description} onChange={(e) => onChange({ description: e.target.value })} />
          </div>
          <div>
            <label className={styles.muted} style={{ fontSize: 11 }}>
              CTA
            </label>
            <select className={styles.select} style={{ width: "100%" }} value={item.cta} onChange={(e) => onChange({ cta: e.target.value })}>
              {CTA_OPTIONS.map((o) => (
                <option key={o} value={o}>
                  {o.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <label className={styles.muted} style={{ fontSize: 11 }}>
              Redirection Link <span style={{ color: "var(--red)" }}>*</span>
            </label>
            <input className={styles.select} style={{ width: "100%" }} value={item.redirectionLink} onChange={(e) => onChange({ redirectionLink: e.target.value })} placeholder="https://..." />
          </div>
        </div>
      )}
    </div>
  );
}

export default function QueueList({ items, checkedIds, onToggleCheck, onChangeItem, onRemoveItem }) {
  if (items.length === 0) {
    return (
      <section className={styles.card} style={{ textAlign: "center", padding: "48px 24px" }}>
        <p style={{ fontWeight: 700, marginBottom: 6 }}>No ads in queue yet</p>
        <p className={styles.sub}>Go to Explore Ads or Partnership Code to add some.</p>
      </section>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {items.map((item) => (
        <QueueRow
          key={item.id}
          item={item}
          checked={checkedIds.has(item.id)}
          onToggleCheck={() => onToggleCheck(item.id)}
          onChange={(patch) => onChangeItem(item.id, patch)}
          onRemove={() => onRemoveItem(item.id)}
        />
      ))}
    </div>
  );
}
