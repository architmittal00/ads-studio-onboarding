import { useEffect, useRef, useState } from "react";
import Loader from "./Loader";
import styles from "@/styles/Home.module.css";

const compactNumber = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

function formatSize(lower, upper) {
  if (!lower && !upper) return null;
  if (lower && upper) return `${compactNumber.format(lower)} – ${compactNumber.format(upper)}`;
  return compactNumber.format(lower || upper);
}

// Multi-select picker over an account's existing Custom Audiences (saved
// audiences, customer lists, and lookalikes — Meta returns lookalikes as
// just another subtype here, see pages/api/fb/custom-audiences.js) — fetched
// once per account and filtered client-side, since Meta has no live search
// endpoint for a user's own audiences the way it does for interests/
// locations/languages (components/InterestPicker.js / TargetingSearchPicker.js).
export default function CustomAudiencePicker({ accountId, values, onChange }) {
  const [all, setAll] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const blurTimer = useRef(null);

  useEffect(() => {
    let ignore = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- standard fetch-on-mount reset, same pattern as LaunchPanel.js
    setLoading(true);
    setError(null);
    fetch(`/api/fb/custom-audiences?accountId=${encodeURIComponent(accountId)}`)
      .then((res) => res.json())
      .then((json) => {
        if (ignore) return;
        if (json.error) setError(json.error);
        else setAll(json.audiences || []);
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
  const filtered = query.trim()
    ? all.filter((a) => a.name.toLowerCase().includes(query.trim().toLowerCase()))
    : all;

  function addAudience(a) {
    if (selectedIds.has(a.id)) return;
    onChange([...values, { id: a.id, name: a.name }]);
  }
  function removeAudience(id) {
    onChange(values.filter((v) => v.id !== id));
  }

  function handleBlur() {
    blurTimer.current = setTimeout(() => setOpen(false), 150);
  }
  function handleFocus() {
    clearTimeout(blurTimer.current);
    setOpen(true);
  }

  return (
    <div>
      <p className={styles.sub} style={{ marginBottom: 6 }}>
        Saved / Custom Audiences
      </p>

      {loading && <Loader inline label="Loading audiences…" />}
      {!loading && error && <p className={styles.sub} style={{ color: "var(--red)" }}>{error}</p>}

      {!loading && !error && (
        <>
          {values.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
              {values.map((v) => (
                <span key={v.id} className={styles.badgeInfo} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  {v.name}
                  <button
                    type="button"
                    onClick={() => removeAudience(v.id)}
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
              placeholder={all.length === 0 ? "No saved audiences on this account" : "Search your saved audiences…"}
              disabled={all.length === 0}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={handleFocus}
              onBlur={handleBlur}
            />
            {open && all.length > 0 && (
              <div className={styles.comboDropdown}>
                {filtered.length === 0 && <div className={styles.comboOption}>No matches.</div>}
                {filtered.map((a) => (
                  <div
                    key={a.id}
                    className={styles.comboOption}
                    onMouseDown={() => {
                      addAudience(a);
                      setQuery("");
                    }}
                  >
                    <div style={{ fontWeight: 600 }}>
                      {a.name}
                      {selectedIds.has(a.id) ? " (added)" : ""}
                    </div>
                    <span className={styles.muted} style={{ fontSize: 11 }}>
                      {[a.subtype, formatSize(a.approximate_count_lower_bound, a.approximate_count_upper_bound)]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
