import { useState } from "react";
import { CloseIcon } from "../icons";
import styles from "@/styles/Home.module.css";

// Bulk permission-request confirm dialog — `creators` is already de-duped to
// one entry per unique creator (see ExploreTab's own dedup before opening
// this), each `{creatorIgId, creatorUsername, label, contentCount}`. Streams
// progress from pages/api/fb/partnership/request-permission-bulk.js the same
// way components/LaunchPanel.js already reads pages/api/fb/launch-campaign.js's
// stream — reused pattern, not reinvented.
export default function BulkPermissionModal({ igUserId, creators, onClose, onDone }) {
  const [sending, setSending] = useState(false);
  const [progressMsg, setProgressMsg] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  // Captured once at mount: `onDone` applies the result back onto the
  // caller's own item list (ExploreTab's markRequested), which can shrink
  // the live `creators` prop to 0 on the very next render (those items no
  // longer "need" permission) — the header text needs the original count,
  // not whatever `creators` has become by the time this re-renders.
  const [initialCount] = useState(creators.length);

  async function handleConfirm() {
    setSending(true);
    setError(null);
    setProgressMsg("Starting…");
    try {
      const res = await fetch("/api/fb/partnership/request-permission-bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ igUserId, creators: creators.map((c) => ({ creatorIgId: c.creatorIgId, creatorUsername: c.creatorUsername })) }),
      });
      if (!res.ok || !res.body) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || `Request failed (${res.status})`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finalResult = null;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop();
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line);
          if (event.type === "progress") setProgressMsg(event.message);
          else if (event.type === "done") finalResult = event;
        }
      }
      setResult(finalResult);
      onDone?.(finalResult);
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
      setProgressMsg(null);
    }
  }

  return (
    <div
      onClick={sending ? undefined : onClose}
      className={styles.pvModalOverlay}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.65)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 800, padding: 24 }}
    >
      <div onClick={(e) => e.stopPropagation()} className={`${styles.card} ${styles.pvModalCard}`} style={{ background: "var(--bg)", width: "min(460px, 100%)", maxHeight: "80vh", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
          <div>
            <h2 className={styles.h2} style={{ marginBottom: 2 }}>
              Request Permission for {initialCount} Creator{initialCount === 1 ? "" : "s"}
            </h2>
            <p className={styles.sub}>Meta requires explicit creator permission before their content can be used in ads.</p>
          </div>
          <button type="button" onClick={onClose} disabled={sending} aria-label="Close" className={styles.btnSecondary} style={{ padding: 6 }}>
            <CloseIcon size={14} />
          </button>
        </div>

        {!result && (
          <div style={{ overflowY: "auto", flex: 1, marginBottom: 12 }}>
            {creators.map((c) => (
              <div key={c.creatorIgId || c.creatorUsername} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{c.label}</span>
                {c.contentCount > 1 && <span className={styles.muted} style={{ fontSize: 11 }}>{c.contentCount} posts selected</span>}
              </div>
            ))}
          </div>
        )}

        {sending && progressMsg && <p className={styles.sub}>{progressMsg}</p>}
        {error && <div className={styles.error}>{error}</div>}

        {result && (
          <div style={{ overflowY: "auto", flex: 1 }}>
            {result.results.map((r) => (
              <div key={r.creatorIgId || r.creatorUsername} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 0" }}>
                <span style={{ fontSize: 13 }}>{r.label}</span>
                <span className={r.success ? styles.badgeGood : styles.badgeDanger} title={r.error}>
                  {r.success ? "Sent" : "Failed"}
                </span>
              </div>
            ))}
          </div>
        )}

        <div style={{ display: "flex", gap: 10, marginTop: 16, justifyContent: "flex-end" }}>
          {!result ? (
            <>
              <button type="button" className={styles.btnSecondary} onClick={onClose} disabled={sending}>
                Cancel
              </button>
              <button type="button" className={styles.btnPrimary} onClick={handleConfirm} disabled={sending}>
                {sending ? "Sending…" : `Send ${initialCount} Request${initialCount === 1 ? "" : "s"}`}
              </button>
            </>
          ) : (
            <button type="button" className={styles.btnPrimary} onClick={onClose}>
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
