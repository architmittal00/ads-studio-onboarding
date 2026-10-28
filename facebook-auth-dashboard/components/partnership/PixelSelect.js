import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { fetchWithTimeout, parseJsonResponse } from "@/lib/fetchJson";
import styles from "@/styles/Home.module.css";
import { cachedGet } from "@/lib/cachedGet";

// Searchable Facebook Pixel picker for the launch wizard's Step 1 — reported
// by the user as a plain free-text ID field before this, with nothing to
// confirm they'd typed the right pixel. Reuses pages/api/fb/targeting-data.js
// (already fetches `/{accountId}/adspixels?fields=id,name`, same endpoint
// components/LaunchPanel.js's own pixel picker already calls) rather than a
// new route. Search matches name OR id, since a pixel id by itself means
// nothing to look at but is exactly what someone might paste in to confirm.
//
// Portals its dropdown into document.body, same mechanism
// components/AccountSelect.js's own `usePortal` option and
// components/partnership/AdSetMultiSelect.js's dropdown both use — this
// component's only caller (LaunchWizardModal's Step 1) sits inside the same
// `overflowY: "auto"` step container that clipped AdSetMultiSelect's own
// dropdown, so an in-flow absolutely-positioned one would have the identical
// problem here.
export default function PixelSelect({ accountId, value, onChange }) {
  const [pixels, setPixels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const blurTimer = useRef(null);
  const wrapperRef = useRef(null);
  const [portalPos, setPortalPos] = useState(null);

  useEffect(() => {
    let ignore = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- standard fetch-on-mount reset, same pattern as AdSetMultiSelect.js
    setLoading(true);
    setError(null);
    cachedGet(`/api/fb/targeting-data?accountId=${encodeURIComponent(accountId)}`)
      .then((json) => {
        if (ignore) return;
        if (json.error) setError(json.error);
        else setPixels(json.pixels || []);
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

  function measurePortalPos() {
    if (!wrapperRef.current) return;
    const rect = wrapperRef.current.getBoundingClientRect();
    setPortalPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
  }

  const selected = pixels.find((p) => p.id === value);
  const q = query.trim().toLowerCase();
  const filtered = q ? pixels.filter((p) => p.name.toLowerCase().includes(q) || p.id.includes(q)) : pixels;
  const displayValue = open ? query : selected ? `${selected.name} (${selected.id})` : value || "";

  function handleFocus() {
    clearTimeout(blurTimer.current);
    setQuery("");
    measurePortalPos();
    setOpen(true);
  }
  function handleBlur() {
    blurTimer.current = setTimeout(() => setOpen(false), 150);
  }

  useEffect(() => {
    if (!open) return;
    window.addEventListener("scroll", measurePortalPos, true);
    window.addEventListener("resize", measurePortalPos);
    return () => {
      window.removeEventListener("scroll", measurePortalPos, true);
      window.removeEventListener("resize", measurePortalPos);
    };
  }, [open]);

  function pick(pixel) {
    onChange(pixel.id);
    setQuery("");
    setOpen(false);
  }

  if (loading) {
    return <input className={styles.select} style={{ width: "100%" }} disabled placeholder="Loading pixels…" />;
  }
  if (error) {
    return <p className={styles.sub} style={{ color: "var(--red)" }}>{error}</p>;
  }

  const dropdown =
    open && portalPos && typeof document !== "undefined"
      ? createPortal(
          <div
            className={styles.comboDropdown}
            style={{ position: "fixed", top: portalPos.top, left: portalPos.left, width: portalPos.width, right: "auto", zIndex: 900 }}
          >
            {pixels.length === 0 && <div className={styles.comboOption}>No pixels found on this ad account.</div>}
            {pixels.length > 0 && filtered.length === 0 && <div className={styles.comboOption}>No matches.</div>}
            {filtered.map((p) => (
              <div key={p.id} className={styles.comboOption} onMouseDown={() => pick(p)}>
                <div style={{ fontWeight: 600 }}>{p.name}</div>
                <span className={styles.muted} style={{ fontSize: 11 }}>
                  {p.id}
                </span>
              </div>
            ))}
          </div>,
          document.body
        )
      : null;

  return (
    <div ref={wrapperRef} className={styles.comboWrapper}>
      <input
        type="text"
        className={styles.select}
        style={{ width: "100%" }}
        placeholder="Search by pixel name or ID…"
        value={displayValue}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={handleFocus}
        onBlur={handleBlur}
      />
      {dropdown}
    </div>
  );
}
