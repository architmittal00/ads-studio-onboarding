import { readApiResponse } from "@/lib/fetchJson";
import { useState } from "react";
import styles from "@/styles/Home.module.css";

const MODES = [
  { value: "adCode", label: "Ad Code", placeholder: "e.g. PAD-SRAP04-AQUA" },
  { value: "permalink", label: "Permalink", placeholder: "e.g. https://www.instagram.com/reel/Cw7zyQ5BdEE/" },
];

// Single partnership-content lookup — by ad_code ("e.g. PAD-SRAP04-AQUA" in
// the mockup) or, per Meta's own support for it (lib/partnershipAds.js's
// lookupContent already accepts a `permalinks` array — content-lookup.js has
// wired it through since the pre-launch re-verification step was added, just
// never exposed anywhere in this UI), by pasting the Instagram permalink/URL
// directly. Useful when a creator shares a post link rather than generating
// a Partnership Code. On a hit, hands the resolved content item up to the
// parent to open FetchPreviewModal; on a miss, shows Graph's own error
// message inline rather than a separate error modal like the mockup's
// `.ferr-modal`.
export default function CodeEntryCard({ businessId, igUserId, onResolved }) {
  const [mode, setMode] = useState("adCode");
  const [value, setValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const activeMode = MODES.find((m) => m.value === mode);

  async function handleFetch() {
    if (!value.trim() || loading) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ businessId, igUserId, [mode]: value.trim() });
      const res = await fetch(`/api/fb/partnership/content-lookup?${params.toString()}`);
      const json = await readApiResponse(res);
      onResolved(json.item);
      setValue("");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className={styles.card} style={{ padding: 20 }}>
      <h2 className={styles.h2} style={{ marginBottom: 4 }}>
        Fetch by Code or Permalink
      </h2>
      <p className={styles.sub} style={{ marginBottom: 14 }}>
        Enter a Partnership Code or an Instagram post/reel permalink to preview and queue it.
      </p>
      <div className={styles.tabGroup} style={{ marginBottom: 10 }}>
        {MODES.map((m) => (
          <button
            key={m.value}
            type="button"
            className={mode === m.value ? `${styles.tab} ${styles.tabActive}` : styles.tab}
            onClick={() => {
              setMode(m.value);
              setError(null);
            }}
          >
            {m.label}
          </button>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <input
          type="text"
          className={styles.select}
          style={{ flex: 1 }}
          placeholder={activeMode.placeholder}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleFetch()}
        />
        <button type="button" className={styles.btnPrimary} onClick={handleFetch} disabled={loading || !value.trim()}>
          {loading ? "Fetching…" : "Fetch Ad"}
        </button>
      </div>
      {error && (
        <div className={styles.error} style={{ marginTop: 10 }}>
          {error}
        </div>
      )}
    </section>
  );
}
