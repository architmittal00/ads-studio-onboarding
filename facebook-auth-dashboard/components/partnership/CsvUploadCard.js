import { useRef, useState } from "react";
import { firstPartnershipInfo } from "@/lib/partnershipContent";
import styles from "@/styles/Home.module.css";

function downloadText(text, filename, mime = "text/csv;charset=utf-8;") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function parseLinesFromCsv(text) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !/^(partnership_code|code|permalink)$/i.test(line));
}

// Same detection CodeEntryCard.js's two Ad Code/Permalink tabs let the user
// pick explicitly for a single lookup — a bulk CSV can freely mix both kinds
// of line (a creator might send an ad_code for one post and a link for
// another), and the two are trivially distinguishable, so there's no need to
// make someone split their list into two separate uploads or pick one mode
// for the whole batch.
function detectInputType(line) {
  return /^https?:\/\//i.test(line) || /instagram\.com/i.test(line) ? "permalink" : "adCode";
}

// Bulk CSV upload — codes/permalinks resolve via one streamed request
// (content-lookup-bulk.js, chunked server-side), rendered here as a live
// per-row status list matching the mockup's own validating→valid/invalid
// animation, just driven by real NDJSON progress instead of staggered
// setTimeouts. Every valid row queues directly (minimal default copy
// fields — edited later from the queue page itself) rather than opening one
// FetchPreviewModal per row, which wouldn't scale to a CSV of any real size.
//
// Each line's type (Ad Code vs Permalink) is auto-detected, not a mode the
// user picks for the whole file (see detectInputType above) — CodeEntryCard's
// single-lookup flow already supports both, and a CSV mixing them is a
// perfectly normal thing to end up with (codes from one creator, links
// pasted from another), so forcing an upload to be one type only would just
// mean splitting one list into two uploads for no real benefit.
export default function CsvUploadCard({ businessId, igUserId, onQueued }) {
  const [rows, setRows] = useState(null); // [{value, type: "adCode"|"permalink", status: "pending"|"valid"|"invalid", item}]
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);

  function handleFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      const lines = parseLinesFromCsv(String(reader.result));
      if (lines.length === 0) return;
      const parsedRows = lines.map((value) => ({ value, type: detectInputType(value), status: "pending", item: null }));
      setRows(parsedRows);
      runLookup(parsedRows);
    };
    reader.readAsText(file);
  }

  async function runLookup(parsedRows) {
    try {
      const items = parsedRows.map((r) => ({ value: r.value, type: r.type }));
      const res = await fetch("/api/fb/partnership/content-lookup-bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId, igUserId, items }),
      });
      if (!res.ok || !res.body) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || `Request failed (${res.status})`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value: chunkValue } = await reader.read();
        if (done) break;
        buffer += decoder.decode(chunkValue, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop();
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line);
          if (event.type === "row") {
            setRows((prev) =>
              prev.map((r) => (r.value === event.value ? { ...r, status: event.found ? "valid" : "invalid", item: event.item, error: event.error || null } : r))
            );
          }
        }
      }
    } catch (err) {
      setRows((prev) => prev.map((r) => (r.status === "pending" ? { ...r, status: "invalid", error: err.message } : r)));
    }
  }

  const resolved = rows?.filter((r) => r.status !== "pending") || [];
  const allDone = rows && resolved.length === rows.length;
  const validRows = resolved.filter((r) => r.status === "valid");
  const invalidRows = resolved.filter((r) => r.status === "invalid");

  function handleQueueValid() {
    const items = validRows.map((r) => {
      const info = firstPartnershipInfo(r.item);
      return {
        id: `code_${r.item.content_id}`,
        source: "code",
        contentId: r.item.content_id,
        adCode: info.ad_code,
        name: `@${r.item.author?.display_name || "unknown"} — ${info.ad_code || r.item.content_id}`,
        mediaType: r.item.media_type,
        permalink: r.item.permalink,
        primaryText: "",
        headline: "",
        description: "",
        cta: "SHOP_NOW",
        redirectionLink: "",
      };
    });
    onQueued(items);
  }

  return (
    <section className={styles.card} style={{ padding: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h2 className={styles.h2} style={{ marginBottom: 4 }}>
            Bulk Upload
          </h2>
          <p className={styles.sub}>
            Upload a CSV of Partnership Codes and/or Instagram permalinks (one per line, either kind, mixed is fine)
            to validate and queue them all at once.
          </p>
        </div>
        <button
          type="button"
          className={styles.btnSecondary}
          onClick={() => downloadText("partnership_code\nPAD-EXAMPLE01\nPAD-EXAMPLE02\n", "partnership-codes-template.csv")}
        >
          Download template
        </button>
      </div>

      {!rows && (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            if (e.dataTransfer.files?.[0]) handleFile(e.dataTransfer.files[0]);
          }}
          onClick={() => fileInputRef.current?.click()}
          style={{
            marginTop: 14,
            border: `1.5px dashed ${dragOver ? "var(--purple)" : "var(--border2)"}`,
            borderRadius: 12,
            padding: "28px 16px",
            textAlign: "center",
            cursor: "pointer",
            background: dragOver ? "rgba(var(--purple-rgb), 0.05)" : undefined,
          }}
        >
          <p className={styles.sub} style={{ margin: 0 }}>
            Drag & drop a CSV here, or click to browse
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            style={{ display: "none" }}
            onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
          />
        </div>
      )}

      {rows && (
        <div style={{ marginTop: 14 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 260, overflowY: "auto" }}>
            {rows.map((r) => (
              <div key={r.value} style={{ padding: "6px 10px", borderRadius: 8, background: "var(--card2)" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                    <span className={styles.muted} style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.3, flexShrink: 0 }}>
                      {r.type === "permalink" ? "Link" : "Code"}
                    </span>
                    <span style={{ fontSize: 12.5, fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.value}</span>
                  </span>
                  {r.status === "pending" && <span className={styles.muted} style={{ flexShrink: 0 }}>Validating…</span>}
                  {r.status === "valid" && <span className={styles.badgeGood} style={{ flexShrink: 0 }}>✓ Valid</span>}
                  {r.status === "invalid" && <span className={styles.badgeDanger} style={{ flexShrink: 0 }}>✕ Invalid</span>}
                </div>
                {/* The real reason a row failed — a Graph error_user_msg/
                    code/subcode when the lookup call itself errored, or why
                    a permalink couldn't even be attempted — rather than
                    leaving every invalid row looking identically
                    unexplained. Reported by the user: ad-code rows were
                    failing with nothing to go on. */}
                {r.status === "invalid" && r.error && (
                  <p className={styles.error} style={{ margin: "4px 0 0", fontSize: 11 }}>
                    {r.error}
                  </p>
                )}
              </div>
            ))}
          </div>

          {allDone && (
            <div style={{ marginTop: 14, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
              <p className={styles.sub} style={{ margin: 0 }}>
                {validRows.length} valid · {invalidRows.length} failed
              </p>
              <div style={{ display: "flex", gap: 8 }}>
                {invalidRows.length > 0 && (
                  <button
                    type="button"
                    className={styles.btnSecondary}
                    onClick={() => downloadText(`${invalidRows.map((r) => r.value).join("\n")}\n`, "failed-codes.csv")}
                  >
                    Download Failed
                  </button>
                )}
                <button type="button" className={styles.btnSecondary} onClick={() => setRows(null)}>
                  ✕ Clear
                </button>
                {validRows.length > 0 && (
                  <button type="button" className={styles.btnPrimary} onClick={handleQueueValid}>
                    Add {validRows.length} to Queue
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
