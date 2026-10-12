import { useEffect, useRef, useState } from "react";
import styles from "@/styles/Home.module.css";

// Generic live-search multi-select backed by /api/fb/targeting-search —
// same debounced-search / comboWrapper-dropdown / chip-list shape as
// components/InterestPicker.js, generalized across whichever Meta search
// `type` is passed in (adgeolocation for Location targeting, adlocale for
// Language) instead of being interest-specific. Kept as a separate
// component rather than generalizing InterestPicker itself, since that one
// also carries interest-only concerns (audience size, the AI-suggested row)
// that don't apply here.
export default function TargetingSearchPicker({ label, type, placeholder, values, onChange }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const blurTimer = useRef(null);

  useEffect(() => {
    if (!query.trim()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- guard-clause reset when the query is cleared, not derived state
      setResults([]);
      return;
    }

    let ignore = false;
    setLoading(true);
    setError(null);

    const timer = setTimeout(() => {
      fetch(`/api/fb/targeting-search?type=${type}&q=${encodeURIComponent(query.trim())}`)
        .then((res) => res.json())
        .then((json) => {
          if (ignore) return;
          if (json.error) setError(json.error);
          else setResults(json.results || []);
        })
        .catch((err) => {
          if (!ignore) setError(err.message);
        })
        .finally(() => {
          if (!ignore) setLoading(false);
        });
    }, 500);

    return () => {
      ignore = true;
      clearTimeout(timer);
    };
  }, [query, type]);

  const selectedKeys = new Set(values.map((v) => v.key));

  function addValue(item) {
    if (selectedKeys.has(item.key)) return;
    onChange([...values, item]);
  }
  function removeValue(key) {
    onChange(values.filter((v) => v.key !== key));
  }

  function handleBlur() {
    blurTimer.current = setTimeout(() => setOpen(false), 150);
  }
  function handleFocus() {
    clearTimeout(blurTimer.current);
    if (query.trim()) setOpen(true);
  }

  return (
    <div>
      <p className={styles.sub} style={{ marginBottom: 6 }}>
        {label}
      </p>

      {values.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
          {values.map((v) => (
            <span key={v.key} className={styles.badgeInfo} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              {v.name}
              {v.region && <span style={{ opacity: 0.8 }}>· {v.region}</span>}
              <button
                type="button"
                onClick={() => removeValue(v.key)}
                aria-label={`Remove ${v.name}`}
                style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", padding: 0, fontSize: 13, lineHeight: 1 }}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <div className={styles.comboWrapper}>
        <input
          type="text"
          className={styles.select}
          style={{ width: "100%" }}
          placeholder={placeholder}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={handleFocus}
          onBlur={handleBlur}
        />
        {open && query.trim() && (
          <div className={styles.comboDropdown}>
            {loading && <div className={styles.comboOption}>Searching…</div>}
            {!loading && error && (
              <div className={styles.comboOption} style={{ color: "var(--red)" }}>
                {error}
              </div>
            )}
            {!loading && !error && results.length === 0 && <div className={styles.comboOption}>No matches.</div>}
            {!loading &&
              !error &&
              results.map((r) => (
                <div
                  key={r.key}
                  className={styles.comboOption}
                  onMouseDown={() => {
                    addValue(r);
                    setQuery("");
                    setResults([]);
                  }}
                >
                  <div style={{ fontWeight: 600 }}>
                    {r.name}
                    {selectedKeys.has(r.key) ? " (added)" : ""}
                  </div>
                  {(r.region || r.type) && (
                    <span className={styles.muted} style={{ fontSize: 11 }}>
                      {[r.region, r.type].filter(Boolean).join(" · ")}
                    </span>
                  )}
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}
