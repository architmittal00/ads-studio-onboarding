import { useState } from "react";
import { useRouter } from "next/router";
import { LockIcon } from "@/components/icons";
import styles from "@/styles/Home.module.css";

// Catalog Ads isn't finalized yet (see PROJECT_STATUS.md) — this is friction,
// not real security, so a plain PIN form is enough: no lockout/rate-limiting,
// no "forgot PIN" flow. On success, re-running getServerSideProps (via
// router.replace of the current path) is what actually reveals the page —
// this component never renders the real content itself.
export default function PinGate() {
  const router = useRouter();
  const [pin, setPin] = useState("");
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/catalog-ads/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Incorrect PIN");
      }
      router.replace(router.asPath);
    } catch (err) {
      setError(err.message);
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.page} style={{ alignItems: "center" }}>
      <form onSubmit={handleSubmit} className={styles.card} style={{ width: "min(320px, 100%)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <LockIcon size={18} />
          <h2 className={styles.h2}>Catalog Ads</h2>
        </div>
        <p className={styles.sub} style={{ marginBottom: 16 }}>
          This section is still being finalized. Enter the PIN to preview it.
        </p>
        <input
          type="password"
          inputMode="numeric"
          autoFocus
          className={styles.select}
          style={{ width: "100%", marginBottom: 12 }}
          placeholder="PIN"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
        />
        {error && (
          <div className={styles.error} style={{ marginBottom: 12 }}>
            {error}
          </div>
        )}
        <button type="submit" className={styles.btnPrimary} style={{ width: "100%" }} disabled={submitting || !pin}>
          {submitting ? "Checking…" : "Unlock"}
        </button>
      </form>
    </div>
  );
}
