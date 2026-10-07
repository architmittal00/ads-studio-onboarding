import { useEffect, useRef, useState } from "react";
import styles from "@/styles/Home.module.css";

const compactNumber = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

function formatAudienceSize(lower, upper) {
  if (!lower && !upper) return null;
  if (lower && upper) return `${compactNumber.format(lower)} – ${compactNumber.format(upper)}`;
  return compactNumber.format(lower || upper);
}

// Live, server-backed search-as-you-type picker for a single Meta ad
// interest — "exactly like search on Meta" (Ads Manager's own Detailed
// Targeting search box), not a static dropdown. Optionally pre-filled with
// an AI-suggested interest (`recommended`), which the user can freely
// override by typing, same as any other value here.
export default function InterestPicker({ label, value, onChange, recommended }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const blurTimer = useRef(null);

  useEffect(() => {
    if (!query.trim()) {
      // Guard-clause reset when the query is cleared, not derived state —
      // same justified pattern as pages/strategy.js's history-check effect.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setResults([]);
      return;
    }

    let ignore = false;
    setLoading(true);
    setError(null);

    // Same 500ms-debounce-with-stale-guard idiom used elsewhere in this app
    // (pages/strategy.js's history-check effect) — typing fires this on
    // every keystroke otherwise, each one a real Graph API call.
    const timer = setTimeout(() => {
      fetch(`/api/fb/interest-search?q=${encodeURIComponent(query.trim())}`)
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
  }, [query]);

  function handlePick(result) {
    onChange({ id: result.id, name: result.name });
    setQuery("");
    setResults([]);
    setOpen(false);
  }

  function handleInputChange(e) {
    setQuery(e.target.value);
    if (value) onChange(null);
    setOpen(true);
  }

  // A plain onBlur would fire before a result's onClick registers — delay
  // closing just long enough for onMouseDown (below) to run first.
  function handleBlur() {
    blurTimer.current = setTimeout(() => setOpen(false), 150);
  }
  function handleFocus() {
    clearTimeout(blurTimer.current);
    if (query.trim()) setOpen(true);
  }

  const isRecommended = !!(value && recommended && value.id === recommended.id);
  const audienceSize = value && formatAudienceSize(value.audienceSizeLowerBound, value.audienceSizeUpperBound);

  return (
    <div>
      <p className={styles.sub} style={{ marginBottom: 6, display: "flex", alignItems: "center", gap: 8 }}>
        {label}
        {isRecommended && <span className={styles.badgeInfo}>AI suggested</span>}
      </p>
      <div className={styles.comboWrapper}>
        <input
          type="text"
          className={styles.select}
          style={{ width: "100%" }}
          placeholder="Search Meta interests…"
          value={value ? value.name : query}
          onChange={handleInputChange}
          onFocus={handleFocus}
          onBlur={handleBlur}
        />
        {open && (query.trim() || loading) && (
          <div className={styles.comboDropdown}>
            {loading && <div className={styles.comboOption}>Searching…</div>}
            {!loading && error && (
              <div className={styles.comboOption} style={{ color: "#ff7070" }}>
                {error}
              </div>
            )}
            {!loading && !error && results.length === 0 && <div className={styles.comboOption}>No matches.</div>}
            {!loading &&
              !error &&
              results.map((r) => (
                <div
                  key={r.id}
                  className={styles.comboOption}
                  // onMouseDown (not onClick) fires before the input's onBlur.
                  onMouseDown={() => handlePick(r)}
                >
                  <div style={{ fontWeight: 600 }}>{r.name}</div>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <span className={styles.muted} style={{ fontSize: 11 }}>
                      {r.path?.slice(0, -1).join(" · ") || null}
                    </span>
                    {formatAudienceSize(r.audienceSizeLowerBound, r.audienceSizeUpperBound) && (
                      <span className={styles.muted} style={{ fontSize: 11 }}>
                        {formatAudienceSize(r.audienceSizeLowerBound, r.audienceSizeUpperBound)} people
                      </span>
                    )}
                  </div>
                </div>
              ))}
          </div>
        )}
      </div>
      {value && audienceSize && (
        <p className={styles.sub} style={{ marginTop: 4, fontSize: 11.5 }}>
          ~{audienceSize} people
        </p>
      )}
    </div>
  );
}
