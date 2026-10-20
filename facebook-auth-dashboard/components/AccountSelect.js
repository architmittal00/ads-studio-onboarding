import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import styles from "@/styles/Home.module.css";

// Search-as-you-type account picker — same combo-box pattern as
// components/InterestPicker.js's live Meta interest search, but filtering an
// already-loaded in-memory list (no API call). Built for agencies with large
// account lists (seen with 20+ connected ad accounts), where a plain native
// <select> means scrolling through every name to find the one you want.
//
// `extraOptions` appends non-account entries to the searchable list after
// every real account — e.g. pages/strategy.js's "Fresh / new account"
// sentinel, which isn't a real ad account but still needs to be findable in
// the same search box rather than living in a second, separate control.
//
// `multiple` switches this from single-select (`value`/`onChange(id)`, closes
// on pick, shows the current selection as the input's own value) to
// multi-select (`values`/`onChange(idsArray)`, selected accounts render as
// removable chips above the input, already-picked accounts are excluded from
// the dropdown entirely, and picking one leaves the dropdown open — a
// multi-add flow, not pick-once-and-close, mirroring InterestPicker.js).
// `maxSelected` (multi-select only) stops offering more once hit.
//
// `usePortal` (opt-in, default off) renders the dropdown into
// document.body via createPortal with `position: fixed`, positioned off the
// input's own measured bounding rect, instead of the normal in-flow
// `position: absolute` dropdown. BUG FIXED BY THIS: a real clipping bug
// found when this combobox is used inside CopyAdsModal.js's destination-
// account picker — that modal's card has `overflowY: auto`, which per the
// CSS spec forces `overflow-x` to compute as `auto` too, clipping the
// absolutely-positioned dropdown on both axes down to one barely-visible
// option with no way to see the rest. Portaling escapes that ancestor
// entirely — the exact fix components/DateRangeMenu.js's own popover
// already uses for an analogous stacking-context clip (PR #161), the only
// other `createPortal` precedent in this app. Off by default so every
// existing call site (none of which have this problem) renders identically
// to before.
export default function AccountSelect({
  accounts,
  value,
  onChange,
  values,
  extraOptions = [],
  placeholder = "Select an account…",
  style,
  multiple = false,
  maxSelected,
  usePortal = false,
  // Only matters with usePortal — the modal this is used inside of (if any)
  // may have its own stacking context (CopyAdsModal's overlay is 800), so
  // the default here is deliberately low; callers inside a higher context
  // must pass their own higher value.
  zIndex = 60,
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const blurTimer = useRef(null);
  const wrapperRef = useRef(null);
  const [portalPos, setPortalPos] = useState(null);

  const allOptions = [...accounts, ...extraOptions];

  function measurePortalPos() {
    if (!wrapperRef.current) return;
    const rect = wrapperRef.current.getBoundingClientRect();
    setPortalPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
  }

  function handleFocus() {
    clearTimeout(blurTimer.current);
    setQuery("");
    if (usePortal) measurePortalPos();
    setOpen(true);
  }

  // A plain onBlur fires before an option's onMouseDown would register —
  // delay closing just long enough for it to run first, same idiom as
  // InterestPicker.js.
  function handleBlur() {
    blurTimer.current = setTimeout(() => setOpen(false), 150);
  }

  // Keeps the portaled dropdown positioned correctly if the page/modal
  // scrolls or the window resizes while it's open — it's out of normal flow
  // once portaled, so nothing else would reposition it. Capture phase so a
  // scroll inside a scrollable ancestor (e.g. the modal card itself) is
  // seen too, same reasoning as DateRangeMenu's own listener.
  useEffect(() => {
    if (!usePortal || !open) return;
    window.addEventListener("scroll", measurePortalPos, true);
    window.addEventListener("resize", measurePortalPos);
    return () => {
      window.removeEventListener("scroll", measurePortalPos, true);
      window.removeEventListener("resize", measurePortalPos);
    };
  }, [usePortal, open]);

  function renderDropdown(children) {
    if (!usePortal) {
      return <div className={styles.comboDropdown}>{children}</div>;
    }
    if (!portalPos || typeof document === "undefined") return null;
    return createPortal(
      <div
        className={styles.comboDropdown}
        style={{ position: "fixed", top: portalPos.top, left: portalPos.left, width: portalPos.width, right: "auto", zIndex }}
      >
        {children}
      </div>,
      document.body
    );
  }

  if (multiple) {
    const selectedIds = new Set(values || []);
    const selectedAccounts = allOptions.filter((a) => selectedIds.has(a.id));
    const atCap = typeof maxSelected === "number" && selectedIds.size >= maxSelected;
    const selectable = allOptions.filter((a) => !selectedIds.has(a.id));
    const filtered = query.trim()
      ? selectable.filter((a) => a.name.toLowerCase().includes(query.trim().toLowerCase()))
      : selectable;

    function pick(option) {
      onChange([...(values || []), option.id]);
      setQuery("");
      // Deliberately left open — picking one account is usually the start of
      // picking several, same reasoning as InterestPicker's multi-add flow.
    }

    function remove(id) {
      onChange((values || []).filter((v) => v !== id));
    }

    return (
      <div style={style}>
        {selectedAccounts.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
            {selectedAccounts.map((a) => (
              <span key={a.id} className={styles.badgeInfo} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                {a.name}
                <button
                  type="button"
                  onClick={() => remove(a.id)}
                  aria-label={`Remove ${a.name}`}
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
            placeholder={atCap ? `Maximum ${maxSelected} accounts` : placeholder}
            value={query}
            disabled={atCap}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={handleFocus}
            onBlur={handleBlur}
          />
          {open &&
            !atCap &&
            renderDropdown(
              filtered.length === 0 ? (
                <div className={styles.comboOption}>No matches.</div>
              ) : (
                filtered.map((a) => (
                  <div key={a.id} className={styles.comboOption} onMouseDown={() => pick(a)}>
                    {a.name}
                  </div>
                ))
              )
            )}
        </div>
      </div>
    );
  }

  const selected = allOptions.find((a) => a.id === value);

  const filtered = query.trim()
    ? allOptions.filter((a) => a.name.toLowerCase().includes(query.trim().toLowerCase()))
    : allOptions;

  // While open, the input shows what's being typed (even if empty) so the
  // user can clear and search from scratch; while closed, it shows the
  // actual current selection — never a half-typed search left behind.
  const displayValue = open ? query : selected?.name || "";

  function pick(option) {
    onChange(option.id);
    setQuery("");
    setOpen(false);
  }

  return (
    <div ref={wrapperRef} className={styles.comboWrapper} style={style}>
      <input
        type="text"
        className={styles.select}
        style={{ width: "100%" }}
        placeholder={placeholder}
        value={displayValue}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={handleFocus}
        onBlur={handleBlur}
      />
      {open &&
        renderDropdown(
          filtered.length === 0 ? (
            <div className={styles.comboOption}>No matches.</div>
          ) : (
            filtered.map((a) => (
              <div
                key={a.id}
                className={styles.comboOption}
                onMouseDown={() => pick(a)}
                style={a.id === value ? { background: "rgba(var(--purple-rgb), 0.12)", fontWeight: 700 } : undefined}
              >
                {a.name}
              </div>
            ))
          )
        )}
    </div>
  );
}
