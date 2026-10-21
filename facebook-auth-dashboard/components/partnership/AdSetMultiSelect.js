import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Loader from "../Loader";
import { formatMetricValue, humanizeStatus } from "@/lib/insightsMetrics";
import { fetchWithTimeout, parseJsonResponse } from "@/lib/fetchJson";
import styles from "@/styles/Home.module.css";

// Multi-select ad-set picker for the launch wizard's Step 2 — chip + combo
// dropdown interaction pattern copied from components/CustomAudiencePicker.js
// (same reasoning there: no live Graph search for "my own ad sets," fetch
// once per account and filter client-side), but hitting
// pages/api/fb/adsets-list.js's existing `?accountId=` list mode instead —
// already returns exactly what the mockup's own "Selected Ad Set" detail
// card shows (budget/status/objective via its own `campaign`/`performance`
// fields), no new endpoint needed.
//
// The dropdown always portals into document.body (position: fixed), same
// mechanism components/AccountSelect.js's own `usePortal` option uses — this
// component's only caller (LaunchWizardModal's Step 2) wraps it in a step
// container with `overflowY: "auto"`, which per the CSS spec forces
// overflow-x to compute as `auto` too, clipping an in-flow absolutely-
// positioned dropdown down to a sliver with no way to see the rest of the
// results (reported by the user: searching "bof" showed only one barely-
// visible row). Always on rather than opt-in since there's only one caller
// and it's always inside that same clipping container.
export default function AdSetMultiSelect({ accountId, currency, values, onChange }) {
  const [all, setAll] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const blurTimer = useRef(null);
  const wrapperRef = useRef(null);
  const [portalPos, setPortalPos] = useState(null);

  function measurePortalPos() {
    if (!wrapperRef.current) return;
    const rect = wrapperRef.current.getBoundingClientRect();
    setPortalPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
  }

  useEffect(() => {
    let ignore = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- standard fetch-on-mount reset, same pattern as CustomAudiencePicker.js
    setLoading(true);
    setError(null);
    fetchWithTimeout(`/api/fb/adsets-list?accountId=${encodeURIComponent(accountId)}`)
      .then(parseJsonResponse)
      .then((json) => {
        if (ignore) return;
        if (json.error) setError(json.error);
        else setAll(json.adsets || []);
      })
      .catch((err) => {
        if (!ignore) setError(err.message);
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [accountId]);

  const selectedIds = new Set(values.map((v) => v.id));
  const filtered = query.trim() ? all.filter((a) => a.name.toLowerCase().includes(query.trim().toLowerCase())) : all;

  function toggle(adset) {
    if (selectedIds.has(adset.id)) onChange(values.filter((v) => v.id !== adset.id));
    else onChange([...values, adset]);
  }

  function handleBlur() {
    blurTimer.current = setTimeout(() => setOpen(false), 150);
  }
  function handleFocus() {
    clearTimeout(blurTimer.current);
    measurePortalPos();
    setOpen(true);
  }

  // Keeps the portaled dropdown positioned correctly if the modal scrolls,
  // the window resizes, or the selected-chips row above the input wraps onto
  // a new line (shifting the input itself down) while open.
  useEffect(() => {
    if (!open) return;
    measurePortalPos();
    window.addEventListener("scroll", measurePortalPos, true);
    window.addEventListener("resize", measurePortalPos);
    return () => {
      window.removeEventListener("scroll", measurePortalPos, true);
      window.removeEventListener("resize", measurePortalPos);
    };
  }, [open, values.length]);

  if (loading) return <Loader inline label="Loading ad sets…" />;
  if (error) return <p className={styles.sub} style={{ color: "var(--red)" }}>{error}</p>;

  const dropdown =
    open && all.length > 0 && portalPos && typeof document !== "undefined"
      ? createPortal(
          <div
            className={styles.comboDropdown}
            style={{ position: "fixed", top: portalPos.top, left: portalPos.left, width: portalPos.width, right: "auto", zIndex: 900 }}
          >
            {filtered.length === 0 && <div className={styles.comboOption}>No matches.</div>}
            {filtered.map((a) => (
              <div key={a.id} className={styles.comboOption} onMouseDown={() => toggle(a)}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <span style={{ fontWeight: 600 }}>
                    {a.name}
                    {selectedIds.has(a.id) ? " (added)" : ""}
                  </span>
                  <span className={a.status === "ACTIVE" ? styles.badgeGood : styles.badgeInfo} style={{ flexShrink: 0 }}>
                    {humanizeStatus(a.status)}
                  </span>
                </div>
                <span className={styles.muted} style={{ fontSize: 11 }}>
                  {a.campaign?.name} · {formatMetricValue((a.daily_budget || a.lifetime_budget) / 100, "currency", currency)}
                  {a.daily_budget ? "/day" : a.lifetime_budget ? " lifetime" : ""}
                </span>
              </div>
            ))}
          </div>,
          document.body
        )
      : null;

  return (
    <div>
      {values.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
          {values.map((v) => (
            <span key={v.id} className={styles.badgeInfo} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              {v.name}
              <button
                type="button"
                onClick={() => toggle(v)}
                aria-label={`Remove ${v.name}`}
                style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", padding: 0, fontSize: 13, lineHeight: 1 }}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <div ref={wrapperRef} className={styles.comboWrapper}>
        <input
          type="text"
          className={styles.select}
          style={{ width: "100%" }}
          placeholder={all.length === 0 ? "No ad sets on this account" : "Search target ad sets…"}
          disabled={all.length === 0}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={handleFocus}
          onBlur={handleBlur}
        />
        {dropdown}
      </div>
    </div>
  );
}
