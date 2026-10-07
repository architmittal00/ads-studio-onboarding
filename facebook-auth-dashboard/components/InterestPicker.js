import { useEffect, useRef, useState } from "react";
import Loader from "./Loader";
import styles from "@/styles/Home.module.css";

const compactNumber = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

function formatAudienceSize(lower, upper) {
  if (!lower && !upper) return null;
  if (lower && upper) return `${compactNumber.format(lower)} – ${compactNumber.format(upper)}`;
  return compactNumber.format(lower || upper);
}

// Multi-select, live-search Meta interest picker for one ad set — "exactly
// like search on Meta" (Ads Manager's own Detailed Targeting box). More than
// one interest can be added to the same ad set: Meta ORs them together
// within one `flexible_spec` entry (reach anyone matching ANY of them), not
// AND — see lib/campaignLaunch.js's buildAdsetPayload.
//
// `suggested` is the shared, account-wide AI-recommended pool (the same
// list passed to every ad set's picker) rendered as an always-visible,
// click-to-add list below the search box — not hidden behind typing, so the
// user can browse everything the AI found rather than only whatever got
// auto-filled. `suggestedLoading` shows a small inline loader here while
// that background fetch is still in flight.
export default function InterestPicker({ label, values, onChange, suggested, suggestedLoading }) {
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

    // Same 500ms-debounce-with-stale-guard idiom used elsewhere in this app.
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

  const selectedIds = new Set(values.map((v) => v.id));

  function addInterest(interest) {
    if (selectedIds.has(interest.id)) return;
    onChange([...values, interest]);
  }
  function removeInterest(id) {
    onChange(values.filter((v) => v.id !== id));
  }

  // A plain onBlur would fire before a result's onClick registers — delay
  // closing just long enough for onMouseDown (below) to run first. `open`
  // deliberately isn't reset to false after adding an interest, so typing
  // the next search term reopens the dropdown immediately without an extra
  // blur/refocus — this is a multi-add flow, not pick-once-and-close.
  function handleBlur() {
    blurTimer.current = setTimeout(() => setOpen(false), 150);
  }
  function handleFocus() {
    clearTimeout(blurTimer.current);
    if (query.trim()) setOpen(true);
  }

  const suggestedToShow = (suggested || []).filter((s) => !selectedIds.has(s.id));

  return (
    <div>
      <p className={styles.sub} style={{ marginBottom: 6 }}>
        {label}
      </p>

      {values.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
          {values.map((v) => (
            <span key={v.id} className={styles.badgeInfo} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              {v.name}
              {formatAudienceSize(v.audienceSizeLowerBound, v.audienceSizeUpperBound) && (
                <span style={{ opacity: 0.8 }}>· {formatAudienceSize(v.audienceSizeLowerBound, v.audienceSizeUpperBound)}</span>
              )}
              <button
                type="button"
                onClick={() => removeInterest(v.id)}
                aria-label={`Remove ${v.name}`}
                style={{
                  background: "none",
                  border: "none",
                  color: "inherit",
                  cursor: "pointer",
                  padding: 0,
                  fontSize: 13,
                  lineHeight: 1,
                }}
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
          placeholder="Search Meta interests to add…"
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
                  onMouseDown={() => {
                    addInterest(r);
                    setQuery("");
                    setResults([]);
                  }}
                >
                  <div style={{ fontWeight: 600 }}>
                    {r.name}
                    {selectedIds.has(r.id) ? " (added)" : ""}
                  </div>
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

      {suggestedLoading ? (
        <div style={{ marginTop: 8 }}>
          <Loader inline label="Finding suggestions…" />
        </div>
      ) : (
        suggestedToShow.length > 0 && (
          <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
            <span className={styles.muted}>Suggested — click to add</span>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {suggestedToShow.map((s) => {
                const size = formatAudienceSize(s.audienceSizeLowerBound, s.audienceSizeUpperBound);
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => addInterest(s)}
                    className={styles.pill}
                    style={{ cursor: "pointer", background: "transparent", border: "1px dashed var(--border)", color: "var(--t2)" }}
                    title={size ? `${size} people` : undefined}
                  >
                    + {s.name}
                    {size && <span style={{ opacity: 0.7 }}> · {size}</span>}
                  </button>
                );
              })}
            </div>
          </div>
        )
      )}
    </div>
  );
}
