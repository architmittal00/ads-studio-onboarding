import { useEffect, useState } from "react";
import styles from "@/styles/Home.module.css";

// The pieces of one account check, in the order they are shown. `id`s match the "step" events
// /api/fb/rules/check streams back; most of them run at the same time, so they tick off in any order.
const STEPS = [
  { id: "account", label: "Reading the ad account" },
  { id: "structure", label: "Listing active campaigns, ad sets and ads" },
  { id: "insights3", label: "Pulling the last 3 days of performance" },
  { id: "insights7", label: "Pulling the last 7 days of performance" },
  { id: "insights14", label: "Pulling the last 14 days of performance" },
  { id: "insights30", label: "Pulling the last 30 days of performance" },
  { id: "changes", label: "Checking budget changes in the last 48 hours" },
  { id: "rules", label: "Running the rules on every campaign, ad set and ad" },
];

// Live checklist shown while an account is being checked: what is done (with the numbers found),
// what is still running, and how long it has been.
export default function RuleCheckProgress({ accountName, steps }) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, []);
  const doneCount = STEPS.filter((s) => steps[s.id]?.done).length;
  const slow = seconds >= 25;

  return (
    <div className={styles.card} style={{ maxWidth: 560 }}>
      <h2 className={styles.h2} style={{ marginBottom: 2 }}>
        Checking {accountName || "the account"}
      </h2>
      <p className={styles.sub} style={{ marginBottom: 14 }}>
        {doneCount} of {STEPS.length} steps done · {seconds}s
      </p>
      <div style={{ height: 4, borderRadius: 4, background: "var(--card2)", overflow: "hidden", marginBottom: 14 }}>
        <div style={{ height: "100%", width: `${(doneCount / STEPS.length) * 100}%`, background: "var(--purple)", transition: "width .3s" }} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
        {STEPS.map((s) => {
          const st = steps[s.id];
          const done = !!st?.done;
          return (
            <div key={s.id} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
              <span style={{ width: 18, flexShrink: 0, textAlign: "center", lineHeight: "18px" }}>
                {done ? <span style={{ color: "var(--green)", fontWeight: 700 }}>✓</span> : <span className={`${styles.spinner} ${styles.spinnerSm}`} style={{ display: "inline-block", verticalAlign: "middle" }} />}
              </span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: done ? "var(--t1)" : "var(--t2)" }}>{s.label}</div>
                {done && st.detail && (
                  <div className={styles.muted} style={{ fontWeight: 400 }}>
                    {st.detail}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <p className={styles.muted} style={{ marginTop: 14, fontWeight: 400 }}>
        {slow ? "Still working — the 30-day report is the slowest part, and big accounts can take up to a minute." : "These run at the same time, so they can finish in any order."}
      </p>
    </div>
  );
}
