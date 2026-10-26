import { useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import styles from "@/styles/Home.module.css";
import { useIsMobile } from "@/lib/useIsMobile";
import { ListIcon, CloseIcon, RefreshIcon } from "./icons";

const POLL_MS = 5000;

// Same data pages/logs.js already shows (GET/DELETE /api/logs, backed by
// lib/apiLogger.js's in-memory, per-server-instance ring buffer) — this
// doesn't change what's logged or how long it survives (that's inherent to
// the in-memory store: it resets on a dev Fast Refresh or a serverless cold
// start, same as the full /logs page already says). What this adds is a way
// to glance at it from wherever you already are, without navigating away and
// losing whatever you were doing on the current page. The full /logs page
// stays as-is for anyone who wants the larger, dedicated view.
export default function ApiLogsFab() {
  const { status } = useSession();
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const containerRef = useRef(null);

  function load() {
    setLoading(true);
    fetch("/api/logs")
      .then((res) => res.json())
      .then((json) => setLogs(json.logs || []))
      .finally(() => setLoading(false));
  }

  function clear() {
    fetch("/api/logs", { method: "DELETE" }).then(load);
  }

  useEffect(() => {
    if (!open) return;
    // Kicks off an async fetch (which itself sets loading/logs state) on
    // open, then on each poll tick — same precedent as
    // components/AccountProvider.js's load().
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    const interval = setInterval(load, POLL_MS);
    return () => clearInterval(interval);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleClick(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false);
    }
    function handleKey(e) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    window.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      window.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  // No session yet (pre-login screen) — nothing to log in on, and /api/logs
  // would just 401.
  // Phone layout has no room for a floating button (and /logs itself isn't
  // adapted for mobile yet).
  if (status !== "authenticated" || isMobile) return null;

  return (
    <div ref={containerRef} style={{ position: "fixed", bottom: 24, right: 24, zIndex: 900 }}>
      {open && (
        <div
          className={styles.card}
          style={{
            position: "absolute",
            bottom: "calc(100% + 12px)",
            right: 0,
            width: 420,
            maxWidth: "calc(100vw - 48px)",
            maxHeight: "70vh",
            overflowY: "auto",
            padding: 14,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <h2 className={styles.h2} style={{ marginBottom: 0 }}>
              API Logs
            </h2>
            <div style={{ display: "flex", gap: 6 }}>
              <button type="button" className={styles.btnSecondary} style={{ padding: 6 }} onClick={load} title="Refresh">
                <RefreshIcon size={13} />
              </button>
              <button type="button" className={styles.btnSecondary} style={{ padding: "6px 10px" }} onClick={clear}>
                Clear
              </button>
              <button
                type="button"
                className={styles.btnSecondary}
                style={{ padding: 6 }}
                onClick={() => setOpen(false)}
                aria-label="Close"
              >
                <CloseIcon size={13} />
              </button>
            </div>
          </div>

          <p className={styles.sub} style={{ marginBottom: 10 }}>
            Most recent Graph API requests from this server instance (resets on cold start or redeploy).
          </p>

          {loading && logs.length === 0 && <p className={styles.sub}>Loading…</p>}
          {!loading && logs.length === 0 && <p className={styles.sub}>No API calls logged yet.</p>}

          {logs.map((log) => (
            <div
              key={log.id}
              style={{ borderBottom: "1px solid var(--border)", padding: "8px 0", cursor: "pointer" }}
              onClick={() => setExpandedId(expandedId === log.id ? null : log.id)}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
                <span className={log.method === "POST" ? styles.badgeWarn : styles.badgeInfo}>{log.method || "GET"}</span>
                <span className={log.error ? styles.badgeDanger : styles.badgeGood}>{log.status ?? "ERR"}</span>
                <span style={{ fontFamily: "monospace", color: "var(--t2)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {log.path}
                </span>
                <span className={styles.muted}>{log.durationMs}ms</span>
              </div>
              <div className={styles.muted} style={{ marginTop: 2 }}>
                {new Date(log.timestamp).toLocaleTimeString()}
                {log.error ? ` · ${log.error}` : ""}
              </div>
              {expandedId === log.id && (
                <pre
                  style={{
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-all",
                    fontSize: 10.5,
                    color: "var(--t2)",
                    marginTop: 6,
                  }}
                >
                  {log.url}
                  {"\n\n"}
                  {log.responsePreview || "(no response body captured)"}
                </pre>
              )}
            </div>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="API Logs"
        title="API Logs"
        style={{
          width: 48,
          height: 48,
          borderRadius: "50%",
          border: "1px solid var(--border)",
          background: "var(--bg)",
          color: "var(--t1)",
          boxShadow: "var(--shadow-md)",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {open ? <CloseIcon size={18} /> : <ListIcon size={18} />}
      </button>
    </div>
  );
}
