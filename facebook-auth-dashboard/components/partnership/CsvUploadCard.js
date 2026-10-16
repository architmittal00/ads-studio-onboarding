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

function parseCodesFromCsv(text) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !/^(partnership_code|code)$/i.test(line));
}

// Bulk CSV upload — codes resolve via one streamed request
// (content-lookup-bulk.js, chunked server-side), rendered here as a live
// per-row status list matching the mockup's own validating→valid/invalid
// animation, just driven by real NDJSON progress instead of staggered
// setTimeouts. Every valid row queues directly (minimal default copy
// fields — edited later from the queue page itself) rather than opening one
// FetchPreviewModal per row, which wouldn't scale to a CSV of any real size.
export default function CsvUploadCard({ businessId, igUserId, onQueued }) {
  const [rows, setRows] = useState(null); // [{code, status: "pending"|"valid"|"invalid", item}]
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);

  function handleFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      const codes = parseCodesFromCsv(String(reader.result));
      if (codes.length === 0) return;
      setRows(codes.map((code) => ({ code, status: "pending", item: null })));
      runLookup(codes);
    };
    reader.readAsText(file);
  }

  async function runLookup(codes) {
    try {
      const res = await fetch("/api/fb/partnership/content-lookup-bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId, igUserId, codes }),
      });
      if (!res.ok || !res.body) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || `Request failed (${res.status})`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop();
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line);
          if (event.type === "row") {
            setRows((prev) => prev.map((r) => (r.code === event.code ? { ...r, status: event.found ? "valid" : "invalid", item: event.item } : r)));
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
          <p className={styles.sub}>Upload a CSV of Partnership Codes to validate and queue them all at once.</p>
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
              <div key={r.code} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 10px", borderRadius: 8, background: "var(--card2)" }}>
                <span style={{ fontSize: 12.5, fontFamily: "monospace" }}>{r.code}</span>
                {r.status === "pending" && <span className={styles.muted}>Validating…</span>}
                {r.status === "valid" && <span className={styles.badgeGood}>✓ Valid</span>}
                {r.status === "invalid" && <span className={styles.badgeDanger}>✕ Invalid</span>}
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
                    onClick={() => downloadText(`partnership_code\n${invalidRows.map((r) => r.code).join("\n")}\n`, "failed-codes.csv")}
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
