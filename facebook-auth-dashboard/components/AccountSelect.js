import { useRef, useState } from "react";
import styles from "@/styles/Home.module.css";

// Search-as-you-type account picker — same combo-box pattern as
// components/InterestPicker.js's live Meta interest search, but filtering an
// already-loaded in-memory list (no API call) and single-select. Built for
// agencies with large account lists (seen with 20+ connected ad accounts),
// where a plain native <select> means scrolling through every name to find
// the one you want.
//
// `extraOptions` appends non-account entries to the searchable list after
// every real account — e.g. pages/strategy.js's "Fresh / new account"
// sentinel, which isn't a real ad account but still needs to be findable in
// the same search box rather than living in a second, separate control.
export default function AccountSelect({ accounts, value, onChange, extraOptions = [], placeholder = "Select an account…", style }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const blurTimer = useRef(null);

  const allOptions = [...accounts, ...extraOptions];
  const selected = allOptions.find((a) => a.id === value);

  const filtered = query.trim()
    ? allOptions.filter((a) => a.name.toLowerCase().includes(query.trim().toLowerCase()))
    : allOptions;

  // While open, the input shows what's being typed (even if empty) so the
  // user can clear and search from scratch; while closed, it shows the
  // actual current selection — never a half-typed search left behind.
  const displayValue = open ? query : selected?.name || "";

  function handleFocus() {
    clearTimeout(blurTimer.current);
    setQuery("");
    setOpen(true);
  }

  // A plain onBlur fires before an option's onClick would register — delay
  // closing just long enough for onMouseDown (below) to run first, same
  // idiom as InterestPicker.js.
  function handleBlur() {
    blurTimer.current = setTimeout(() => setOpen(false), 150);
  }

  function pick(option) {
    onChange(option.id);
    setQuery("");
    setOpen(false);
  }

  return (
    <div className={styles.comboWrapper} style={style}>
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
      {open && (
        <div className={styles.comboDropdown}>
          {filtered.length === 0 ? (
            <div className={styles.comboOption}>No matches.</div>
          ) : (
            filtered.map((a) => (
              <div
                key={a.id}
                className={styles.comboOption}
                onMouseDown={() => pick(a)}
                style={a.id === value ? { background: "rgba(175, 70, 253, 0.12)", fontWeight: 700 } : undefined}
              >
                {a.name}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
