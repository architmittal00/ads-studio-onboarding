import { useEffect, useState } from "react";
import styles from "@/styles/Home.module.css";

// Lightweight screen lock for a page — not real security (the pin lives in
// the client bundle, same as any client-side check), just a deterrent
// against someone glancing at an open tab. `storageKey` is shared across
// every page that should unlock together with one entry (Partnership Ads
// and Copy Ads both use the same one, per the user's own framing of this as
// one shared pin for both tabs) — sessionStorage, not localStorage like the
// rest of this app's remembered preferences, so a lock is meaningfully a
// per-browser-session thing rather than "enter it once on this device,
// ever."
const STORAGE_KEY = "fb-dashboard:locked-tabs-unlocked";
const CORRECT_PIN = "392164";

export default function PinLock({ children }) {
  const [unlocked, setUnlocked] = useState(false);
  const [checked, setChecked] = useState(false);
  const [pin, setPin] = useState("");
  const [error, setError] = useState(false);

  useEffect(() => {
    let stored = null;
    try {
      stored = sessionStorage.getItem(STORAGE_KEY);
    } catch {
      // Private-browsing or storage-disabled — falls through to asking for
      // the pin every load, which is the safe default here.
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time read of a per-session unlock flag, not derivable from props/state
    setUnlocked(stored === "1");
    setChecked(true);
  }, []);

  function handleSubmit(e) {
    e.preventDefault();
    if (pin.trim() === CORRECT_PIN) {
      try {
        sessionStorage.setItem(STORAGE_KEY, "1");
      } catch {
        // Unlock still works for this render even if it can't be
        // remembered for the next reload.
      }
      setUnlocked(true);
      setError(false);
    } else {
      setError(true);
    }
  }

  // Nothing rendered yet while the one-time sessionStorage check resolves —
  // avoids a flash of the pin form for an already-unlocked session.
  if (!checked) return null;

  if (unlocked) return children;

  return (
    <div className={styles.page}>
      <main className={styles.main} style={{ maxWidth: 360, margin: "80px auto 0" }}>
        <div className={styles.card}>
          <h2 className={styles.h2} style={{ marginBottom: 4 }}>
            Locked
          </h2>
          <p className={styles.sub} style={{ marginBottom: 14 }}>
            Enter the PIN to open this tab.
          </p>
          <form onSubmit={handleSubmit}>
            <input
              type="password"
              inputMode="numeric"
              autoFocus
              className={styles.select}
              style={{ width: "100%", marginBottom: 10, textAlign: "center", letterSpacing: 4, fontSize: 18 }}
              value={pin}
              onChange={(e) => {
                setPin(e.target.value);
                setError(false);
              }}
              placeholder="······"
            />
            {error && (
              <div className={styles.error} style={{ marginBottom: 10 }}>
                Incorrect PIN.
              </div>
            )}
            <button type="submit" className={styles.btnPrimary} style={{ width: "100%" }} disabled={!pin.trim()}>
              Unlock
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}
