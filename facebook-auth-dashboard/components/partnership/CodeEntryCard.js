import { useState } from "react";
import styles from "@/styles/Home.module.css";

// Single partnership-code lookup — "e.g. PAD-SRAP04-AQUA" in the mockup. On
// a hit, hands the resolved content item up to the parent to open
// FetchPreviewModal; on a miss, shows Graph's own error message inline
// rather than a separate error modal like the mockup's `.ferr-modal`.
export default function CodeEntryCard({ businessId, igUserId, onResolved }) {
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  async function handleFetch() {
    if (!code.trim() || loading) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ businessId, igUserId, adCode: code.trim() });
      const res = await fetch(`/api/fb/partnership/content-lookup?${params.toString()}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Lookup failed");
      onResolved(json.item);
      setCode("");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className={styles.card} style={{ padding: 20 }}>
      <h2 className={styles.h2} style={{ marginBottom: 4 }}>
        Fetch by Code
      </h2>
      <p className={styles.sub} style={{ marginBottom: 14 }}>
        Enter a single Partnership Code to preview and queue it.
      </p>
      <div style={{ display: "flex", gap: 8 }}>
        <input
          type="text"
          className={styles.select}
          style={{ flex: 1 }}
          placeholder="e.g. PAD-SRAP04-AQUA"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleFetch()}
        />
        <button type="button" className={styles.btnPrimary} onClick={handleFetch} disabled={loading || !code.trim()}>
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
