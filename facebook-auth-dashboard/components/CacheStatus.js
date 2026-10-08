import { useEffect, useState } from "react";
import Loader from "./Loader";
import { RefreshIcon } from "./icons";
import { formatAge } from "@/lib/clientCache";
import styles from "@/styles/Home.module.css";

// One shared "<label> loaded Xm ago · Hard Refresh" status line for anything
// backed by lib/clientCache.js's 30-min TTL cache, so new call sites
// (dashboard, Explore) read identically instead of each inventing its own
// wording — matches the row report.js already used for its report payload,
// minus the fromCache/freshly-fetched distinction that's specific to that
// page's server+client two-layer cache.
export default function CacheStatus({ label = "Data", fetchedAt, loading, onRefresh }) {
  // Ticked periodically (not read via Date.now() directly in render, which
  // is impure) so "Xm ago" keeps advancing while the page sits open — same
  // pattern pages/report.js already uses for its own freshness line.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(interval);
  }, []);

  if (!fetchedAt && !loading) return null;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      <p className={styles.sub} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 0 }}>
        {fetchedAt && <span>{label} loaded {formatAge(now - fetchedAt)}.</span>}
        {loading && <Loader inline label="Refreshing…" />}
      </p>
      {onRefresh && (
        <button type="button" className={styles.btnSecondary} onClick={onRefresh} disabled={loading}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <RefreshIcon size={13} />
            {loading ? "Refreshing…" : "Hard Refresh"}
          </span>
        </button>
      )}
    </div>
  );
}
