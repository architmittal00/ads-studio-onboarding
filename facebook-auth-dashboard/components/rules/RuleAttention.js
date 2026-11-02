import Link from "next/link";
import styles from "@/styles/Home.module.css";

const ACTION_TEXT = { INCREASE_BUDGET: "Budget could go up", DECREASE_BUDGET: "Budget could come down", PAUSE_AD: "Consider pausing" };
const TONE = { INCREASE_BUDGET: "var(--green)", DECREASE_BUDGET: "var(--amber)", PAUSE_AD: "var(--red)" };

// A small "!" beside a row the rules flagged; hover says why in a line, click opens the Rules page.
export function AttentionMark({ flag }) {
  if (!flag) return null;
  const tone = TONE[flag.action] || "var(--amber)";
  return (
    <Link
      href="/rules"
      onClick={(e) => e.stopPropagation()}
      title={`${ACTION_TEXT[flag.action] || "Needs a look"} — ${flag.rules.join(", ")}. Open Rules to review.`}
      aria-label={`Needs attention: ${flag.rules.join(", ")}`}
      style={{
        flexShrink: 0,
        width: 16,
        height: 16,
        borderRadius: "50%",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 11,
        fontWeight: 800,
        lineHeight: 1,
        textDecoration: "none",
        color: tone,
        background: `color-mix(in srgb, ${tone} 15%, transparent)`,
        border: `1px solid color-mix(in srgb, ${tone} 45%, transparent)`,
      }}
    >
      !
    </Link>
  );
}

// "Checking rules…" while the background check runs, then how many rows need attention.
export function AttentionStatus({ state }) {
  if (state.total === 0) return null;
  if (state.loading) {
    return (
      <span className={styles.muted} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontWeight: 400 }} title="Checking this account against your rules in the background">
        <span className={`${styles.spinner} ${styles.spinnerSm}`} />
        Checking rules{state.total > 1 ? ` (${state.done}/${state.total})` : ""}…
      </span>
    );
  }
  const n = state.flags.size;
  if (n > 0) {
    return (
      <Link href="/rules" className={styles.muted} style={{ textDecoration: "none", color: "var(--amber)", fontWeight: 700 }} title="Open the Rules page to review and act">
        ! {n} need{n === 1 ? "s" : ""} attention
      </Link>
    );
  }
  if (state.failed === state.total) return <span className={styles.muted} style={{ fontWeight: 400 }}>Rule check unavailable</span>;
  return (
    <span className={styles.muted} style={{ fontWeight: 400 }}>
      ✓ Nothing flagged by rules
    </span>
  );
}
