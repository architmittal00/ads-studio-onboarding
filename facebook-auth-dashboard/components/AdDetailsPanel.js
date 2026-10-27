import { useEffect, useMemo, useState } from "react";
import BottomSheet from "./BottomSheet";
import AdPreviewFrame from "./AdPreviewFrame";
import { readApiResponse } from "@/lib/fetchJson";
import { track } from "@/lib/analytics";
import styles from "@/styles/Home.module.css";

// The ad level of Explore's "View details" drawer: a read view laid out as
// cards (status, preview, copy variants, call to action + link) and an edit
// mode (name, status, creative, copy). Saving goes through /api/fb/ad-update
// (lib/adEdit.js).

const CTA_TYPES = [
  "SHOP_NOW", "LEARN_MORE", "SIGN_UP", "BUY_NOW", "ORDER_NOW", "GET_OFFER", "GET_QUOTE", "CONTACT_US", "DOWNLOAD",
  "BOOK_TRAVEL", "SUBSCRIBE", "APPLY_NOW", "WATCH_MORE", "SEND_MESSAGE", "NO_BUTTON",
];
const ctaLabel = (t) => (t ? t.toLowerCase().replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : "—");

function Card({ title, action, children }) {
  return (
    <section className={styles.dtCard}>
      {(title || action) && (
        <div className={styles.dtCardHead}>
          <span className={styles.dtLabel}>{title}</span>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

// One piece of ad copy that can have several rotated variants (primary text,
// headline, description). A single value reads as plain text; several become
// numbered chips with one shown at a time instead of a stacked "1. 2. 3." list.
function VariantViewer({ label, items }) {
  const [active, setActive] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const list = items || [];
  const current = list[Math.min(active, Math.max(list.length - 1, 0))];
  const long = (current || "").length > 220 || (current || "").split("\n").length > 5;
  return (
    <Card
      title={label}
      action={list.length > 1 ? <span className={styles.dtMeta}>{list.length} variants · Meta rotates these</span> : null}
    >
      {list.length === 0 ? (
        <p className={styles.dtEmpty}>Not set</p>
      ) : (
        <>
          {list.length > 1 && (
            <div className={styles.dtChips} role="tablist" aria-label={`${label} variants`}>
              {list.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  role="tab"
                  aria-selected={i === active}
                  className={i === active ? `${styles.dtChip} ${styles.dtChipOn}` : styles.dtChip}
                  onClick={() => {
                    setActive(i);
                    setExpanded(false);
                  }}
                >
                  {i + 1}
                </button>
              ))}
            </div>
          )}
          <div className={expanded || !long ? styles.dtText : `${styles.dtText} ${styles.dtTextClamp}`}>{current}</div>
          {long && (
            <button type="button" className={styles.dtLink} onClick={() => setExpanded((v) => !v)}>
              {expanded ? "Show less" : "Show more"}
            </button>
          )}
        </>
      )}
    </Card>
  );
}

// Editable list of text variants. `multi` = the ad has a real variant pool;
// otherwise exactly one box (Meta stores one text of each kind).
function VariantEditor({ label, items, onChange, multi, required, rows = 3 }) {
  const list = items.length ? items : [""];
  const set = (i, v) => onChange(list.map((t, j) => (j === i ? v : t)));
  return (
    <div className={styles.dtField}>
      <div className={styles.dtFieldHead}>
        <label className={styles.dtLabel}>
          {label}
          {required ? " *" : ""}
        </label>
        {multi && list.length > 1 && <span className={styles.dtMeta}>{list.length} variants</span>}
      </div>
      {list.map((text, i) => (
        <div key={i} className={styles.dtVariantRow}>
          <textarea className={styles.select} rows={rows} value={text} placeholder={multi && list.length > 1 ? `Variant ${i + 1}` : ""} onChange={(e) => set(i, e.target.value)} />
          {multi && list.length > 1 && (
            <button type="button" className={styles.btnSecondary} aria-label={`Remove variant ${i + 1}`} onClick={() => onChange(list.filter((_, j) => j !== i))}>
              ×
            </button>
          )}
        </div>
      ))}
      {multi && (
        <button type="button" className={styles.dtLink} onClick={() => onChange([...list, ""])}>
          + Add variant
        </button>
      )}
    </div>
  );
}

function CreativePicker({ accountId, currentId, onPick, onClose }) {
  const [state, setState] = useState({ loading: true, error: null, creatives: [] });
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/fb/account-creatives?accountId=${encodeURIComponent(accountId)}`)
      .then(readApiResponse)
      .then((json) => !cancelled && setState({ loading: false, error: null, creatives: json.creatives || [] }))
      .catch((err) => !cancelled && setState({ loading: false, error: err.message, creatives: [] }));
    return () => {
      cancelled = true;
    };
  }, [accountId]);
  return (
    <BottomSheet open title="Choose a creative" onClose={onClose}>
      {state.loading && <p className={styles.sub}>Loading creatives…</p>}
      {state.error && <div className={styles.error}>{state.error}</div>}
      <div className={styles.dtCreativeGrid}>
        {state.creatives.map((c) => (
          <button
            key={c.id}
            type="button"
            className={c.id === currentId ? `${styles.dtCreative} ${styles.dtCreativeOn}` : styles.dtCreative}
            onClick={() => onPick(c)}
          >
            {c.thumbnailUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={c.thumbnailUrl} alt="" />
            ) : (
              <span className={styles.dtCreativeBlank} />
            )}
            <span className={styles.dtCreativeName}>{c.name || `Creative ${c.id.slice(-6)}`}{c.isVideo ? " · video" : ""}</span>
          </button>
        ))}
      </div>
      {!state.loading && !state.error && state.creatives.length === 0 && <p className={styles.sub}>No creatives found on this ad account.</p>}
    </BottomSheet>
  );
}

const statusTone = (s) => (s === "ACTIVE" ? styles.badgeGood : styles.badgeInfo);
const humanStatus = (s) => (s || "").toLowerCase().replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

function ParentLink({ level, id, name, onNavigate }) {
  if (!id) return <span className={styles.dtEmpty}>—</span>;
  if (!onNavigate) return <span>{name || id}</span>;
  return (
    <button type="button" className={styles.dtLink} onClick={() => onNavigate({ level, id, name })}>
      {name || id}
    </button>
  );
}

export default function AdDetailsPanel({ adId, data, onNavigate, onSaved }) {
  const [mode, setMode] = useState("view"); // view | edit
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [picking, setPicking] = useState(false);

  const initial = useMemo(
    () => ({
      name: data.name || "",
      status: data.status === "ACTIVE" ? "ACTIVE" : "PAUSED",
      primaryTexts: data.primaryTexts || [],
      headlines: data.headlines || [],
      descriptions: data.descriptions || [],
      ctaType: data.ctaType || "",
      landingUrl: data.landingUrl || "",
    }),
    [data]
  );
  const [draft, setDraft] = useState(initial);
  const [newCreative, setNewCreative] = useState(null); // { id, name, thumbnailUrl }

  const canEditCopy = !!data.editable?.copy;
  const multi = !!data.editable?.multiText;
  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));

  const copyChanged =
    JSON.stringify([draft.primaryTexts, draft.headlines, draft.descriptions, draft.ctaType, draft.landingUrl]) !==
    JSON.stringify([initial.primaryTexts, initial.headlines, initial.descriptions, initial.ctaType, initial.landingUrl]);
  const nameChanged = draft.name.trim() !== initial.name;
  const statusChanged = draft.status !== initial.status;
  const creativeChanged = !!newCreative;
  const anyChange = nameChanged || statusChanged || creativeChanged || (canEditCopy && copyChanged && !creativeChanged);
  const needsReviewWarning = creativeChanged || (canEditCopy && copyChanged);

  function startEdit() {
    setDraft(initial);
    setNewCreative(null);
    setError(null);
    setNotice(null);
    setConfirming(false);
    setMode("edit");
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const body = { adId };
      if (nameChanged) body.name = draft.name.trim();
      if (statusChanged) body.status = draft.status;
      if (creativeChanged) body.creativeId = newCreative.id;
      else if (canEditCopy && copyChanged) {
        body.copy = {
          primaryTexts: draft.primaryTexts,
          headlines: draft.headlines,
          descriptions: draft.descriptions,
          ctaType: draft.ctaType,
          landingUrl: draft.landingUrl,
        };
      }
      const res = await fetch("/api/fb/ad-update", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const json = await readApiResponse(res);
      track("ad_edited", { changed: (json.changed || []).join(",") });
      setMode("view");
      setConfirming(false);
      setNotice(
        json.changed?.length
          ? `Saved: ${json.changed.join(", ")}.${json.changed.includes("copy") || json.changed.includes("creative") ? " The ad goes back into review before it delivers again." : ""}`
          : "Nothing to save."
      );
      onSaved?.(json);
    } catch (err) {
      setError(err.message);
      setConfirming(false);
    } finally {
      setSaving(false);
    }
  }

  if (mode === "edit") {
    return (
      <div className={styles.dtStack}>
        <Card title="Ad name & status">
          <div className={styles.dtField}>
            <input className={styles.select} value={draft.name} onChange={(e) => set({ name: e.target.value })} aria-label="Ad name" />
          </div>
          <div className={styles.dtField}>
            <div className={styles.tabGroup} role="radiogroup" aria-label="Status">
              {[
                ["PAUSED", "Paused"],
                ["ACTIVE", "Active"],
              ].map(([v, l]) => (
                <button key={v} type="button" role="radio" aria-checked={draft.status === v} className={draft.status === v ? `${styles.tab} ${styles.tabActive}` : styles.tab} onClick={() => set({ status: v })}>
                  {l}
                </button>
              ))}
            </div>
            {draft.status === "ACTIVE" && statusChanged && <p className={styles.dtWarn}>Turning this ad on lets it deliver and spend (if its ad set and campaign are on).</p>}
          </div>
        </Card>

        <Card title="Creative">
          <div className={styles.dtCreativeRow}>
            {(newCreative?.thumbnailUrl || data.thumbnailUrl) ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className={styles.dtCreativeThumb} src={newCreative?.thumbnailUrl || data.thumbnailUrl} alt="" />
            ) : (
              <span className={styles.dtCreativeThumb} />
            )}
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className={styles.dtText}>{newCreative ? newCreative.name || `Creative ${newCreative.id.slice(-6)}` : "Current creative"}</div>
              {newCreative && <p className={styles.dtWarn}>Replaces this ad’s creative on save. Its copy comes with it.</p>}
            </div>
            <button type="button" className={styles.btnSecondary} onClick={() => setPicking(true)} disabled={!data.accountId}>
              {newCreative ? "Change" : "Change creative"}
            </button>
          </div>
          {newCreative && (
            <button type="button" className={styles.dtLink} onClick={() => setNewCreative(null)}>
              Keep the current creative
            </button>
          )}
        </Card>

        {!canEditCopy && (
          <Card title="Copy">
            <p className={styles.dtEmpty}>{data.editable?.reason || "This ad’s copy can’t be edited here."}</p>
          </Card>
        )}
        {canEditCopy && (
          <Card title="Copy">
            {creativeChanged ? (
              <p className={styles.dtEmpty}>The new creative brings its own copy. Save it, then edit the copy afterwards.</p>
            ) : (
              <>
                <VariantEditor label="Primary text" required items={draft.primaryTexts} onChange={(v) => set({ primaryTexts: v })} multi={multi} rows={5} />
                <VariantEditor label="Headline" items={draft.headlines} onChange={(v) => set({ headlines: v })} multi={multi} rows={2} />
                <VariantEditor label="Description" items={draft.descriptions} onChange={(v) => set({ descriptions: v })} multi={multi} rows={2} />
                <div className={styles.dtField}>
                  <label className={styles.dtLabel}>Call to action</label>
                  <select className={styles.select} value={draft.ctaType} onChange={(e) => set({ ctaType: e.target.value })}>
                    {!draft.ctaType && <option value="">—</option>}
                    {[...new Set([draft.ctaType, ...CTA_TYPES].filter(Boolean))].map((t) => (
                      <option key={t} value={t}>
                        {ctaLabel(t)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className={styles.dtField}>
                  <label className={styles.dtLabel}>Website URL</label>
                  <input className={styles.select} type="url" inputMode="url" value={draft.landingUrl} onChange={(e) => set({ landingUrl: e.target.value })} placeholder="https://" />
                </div>
              </>
            )}
          </Card>
        )}

        {error && <div className={styles.error}>{error}</div>}

        {confirming && (
          <div className={styles.dtConfirm}>
            <strong>Replace this ad’s {creativeChanged ? "creative" : "copy"}?</strong>
            <p className={styles.dtMeta}>
              Meta can’t edit a creative in place, so a new one is created and attached. The ad goes back into review, can stop delivering until it’s approved, and may lose its learning.
            </p>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" className={styles.btnSecondary} onClick={() => setConfirming(false)} disabled={saving}>
                Back
              </button>
              <button type="button" className={styles.btnPrimary} onClick={save} disabled={saving}>
                {saving ? "Saving…" : "Yes, save changes"}
              </button>
            </div>
          </div>
        )}

        <div className={styles.dtSaveBar}>
          <button type="button" className={styles.btnSecondary} onClick={() => setMode("view")} disabled={saving}>
            Cancel
          </button>
          <button
            type="button"
            className={styles.btnPrimary}
            style={{ flex: 1 }}
            disabled={saving || !anyChange || confirming || (canEditCopy && copyChanged && !creativeChanged && !draft.primaryTexts.some((t) => t.trim()))}
            onClick={() => (needsReviewWarning ? setConfirming(true) : save())}
          >
            {saving ? "Saving…" : anyChange ? "Save changes" : "No changes"}
          </button>
        </div>

        {picking && (
          <CreativePicker
            accountId={data.accountId}
            currentId={newCreative?.id || data.creativeId}
            onClose={() => setPicking(false)}
            onPick={(c) => {
              setPicking(false);
              setNewCreative(c.id === data.creativeId ? null : c);
            }}
          />
        )}
      </div>
    );
  }

  return (
    <div className={styles.dtStack}>
      {notice && <div className={styles.dtNotice}>{notice}</div>}
      <Card
        title="Status"
        action={
          <button type="button" className={styles.btnPrimary} onClick={startEdit}>
            Edit ad
          </button>
        }
      >
        <div className={styles.dtRow}>
          {data.effectiveStatus && <span className={statusTone(data.effectiveStatus)}>{humanStatus(data.effectiveStatus)}</span>}
        </div>
        <div className={styles.dtRow}>
          <span className={styles.dtMeta}>Campaign</span>
          <ParentLink level="campaign" id={data.campaign?.id} name={data.campaign?.name} onNavigate={onNavigate} />
        </div>
        <div className={styles.dtRow}>
          <span className={styles.dtMeta}>Ad set</span>
          <ParentLink level="adset" id={data.adset?.id} name={data.adset?.name} onNavigate={onNavigate} />
        </div>
      </Card>

      <Card title="Preview">
        <AdPreviewFrame adId={adId} />
        {data.landingUrl && (
          <a href={data.landingUrl} target="_blank" rel="noopener noreferrer" className={styles.btnPrimary} style={{ display: "inline-block", marginTop: 10, textDecoration: "none" }}>
            {data.ctaLabel || "Visit landing page"} ↗
          </a>
        )}
      </Card>

      <VariantViewer label="Primary text" items={data.primaryTexts} />
      <VariantViewer label="Headline" items={data.headlines} />
      <VariantViewer label="Description" items={data.descriptions} />

      <Card title="Call to action & link">
        <div className={styles.dtRow}>
          <span className={styles.dtMeta}>Button</span>
          <span className={styles.badgeInfo}>{data.ctaLabel || "—"}</span>
        </div>
        <div className={styles.dtRow} style={{ alignItems: "flex-start" }}>
          <span className={styles.dtMeta}>Website</span>
          {data.landingUrl ? (
            <a href={data.landingUrl} target="_blank" rel="noopener noreferrer" className={styles.dtUrl}>
              {data.landingUrl}
            </a>
          ) : (
            <span className={styles.dtEmpty}>No landing page detected for this ad.</span>
          )}
        </div>
      </Card>
    </div>
  );
}
