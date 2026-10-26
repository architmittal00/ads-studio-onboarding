import { useState } from "react";
import { fetchWithTimeout, parseJsonResponse } from "@/lib/fetchJson";
import { useJsonFetch } from "@/lib/catalogAds/useJsonFetch";
import styles from "@/styles/Home.module.css";

const LANGS = [
  { key: "EN", label: "English" },
  { key: "HINGLISH", label: "Hinglish" },
  { key: "HI", label: "हिन्दी" },
];

// "Write the text with AI" for an image ad — ported from sr-ads-launch's
// AiCopy.tsx, trimmed to the image path (video is a later phase). Hidden
// entirely when OPENROUTER_API_KEY isn't configured on this server.
export default function AiCopyBox({ accountId, imageHash, pageName, link, cta, ad, onUse }) {
  const status = useJsonFetch("/api/fb/catalog-ads/ai-status");
  const [language, setLanguage] = useState("EN");
  const [offer, setOffer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [undo, setUndo] = useState(null);

  if (!status.data?.enabled) return null;

  async function write() {
    setBusy(true);
    setError("");
    setUndo(null);
    try {
      const res = await fetchWithTimeout("/api/fb/catalog-ads/ai-copy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId,
          imageHash,
          pageName,
          link,
          cta,
          language,
          offer,
          draft: { message: ad.message, headline: ad.headline, description: ad.description },
        }),
      });
      const json = await parseJsonResponse(res);
      if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
      setResult(json);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const copy = result?.copy;

  return (
    <div className={styles.card} style={{ marginBottom: 16 }}>
      <p style={{ fontWeight: 700, marginBottom: 2 }}>Write the text with AI</p>
      <p className={styles.sub} style={{ marginBottom: 10 }}>
        Looks at your image and writes the primary text, headline and description.
      </p>
      <div className={styles.tabGroup} style={{ marginBottom: 10 }}>
        {LANGS.map((l) => (
          <button key={l.key} type="button" className={language === l.key ? `${styles.tab} ${styles.tabActive}` : styles.tab} onClick={() => setLanguage(l.key)}>
            {l.label}
          </button>
        ))}
      </div>
      <input
        type="text"
        className={styles.select}
        style={{ width: "100%", marginBottom: 10 }}
        maxLength={300}
        placeholder="Offer or details to mention (optional), e.g. Flat 20% off till Sunday"
        value={offer}
        onChange={(e) => setOffer(e.target.value)}
      />
      <button type="button" className={styles.btnSecondary} disabled={!imageHash || busy} onClick={write}>
        {busy ? "Looking at the image and writing…" : copy ? "Write again" : "Write ad text"}
      </button>
      {!imageHash && (
        <p className={styles.sub} style={{ marginTop: 6 }}>
          Add an image first.
        </p>
      )}
      {error && <div className={styles.error}>{error}</div>}

      {copy && (
        <div style={{ marginTop: 12 }}>
          <p style={{ margin: 0 }}>{copy.primary_text}</p>
          <p className={styles.sub} style={{ margin: "4px 0" }}>
            <strong>Headline</strong> · {copy.headline}
          </p>
          {copy.description && (
            <p className={styles.sub} style={{ margin: "4px 0" }}>
              <strong>Description</strong> · {copy.description}
            </p>
          )}
          {copy.warnings.map((w, i) => (
            <div key={i} className={styles.badgeWarn} style={{ display: "block", marginTop: 4 }}>
              {w}
            </div>
          ))}
          <button
            type="button"
            className={styles.btnSecondary}
            style={{ marginTop: 8 }}
            onClick={() => {
              setUndo({ message: ad.message, headline: ad.headline, description: ad.description });
              onUse({ message: copy.primary_text, headline: copy.headline, description: copy.description });
            }}
          >
            Use this text
          </button>
          {undo && (
            <p className={styles.sub} style={{ marginTop: 6 }}>
              Text filled in below.{" "}
              <button
                type="button"
                className={styles.btnSecondary}
                onClick={() => {
                  onUse(undo);
                  setUndo(null);
                }}
              >
                Undo
              </button>
            </p>
          )}
          <p className={styles.sub} style={{ marginTop: 8, fontSize: 11.5 }}>
            The image and these details are sent to an AI service ({result.model}) to write the text. AI can get facts wrong: check every claim before you launch.
          </p>
        </div>
      )}
    </div>
  );
}
