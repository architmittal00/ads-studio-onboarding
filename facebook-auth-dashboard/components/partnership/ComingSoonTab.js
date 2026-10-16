import styles from "@/styles/Home.module.css";

// Placeholder for a Partnership Ads tab that hasn't shipped yet — this
// feature is being built out across several rounds (see PROJECT_STATUS.md),
// Overview and Explore Ads first.
export default function ComingSoonTab({ label }) {
  return (
    <section className={styles.card} style={{ textAlign: "center", padding: "48px 24px" }}>
      <p style={{ fontWeight: 700, marginBottom: 6 }}>{label}</p>
      <p className={styles.sub}>This tab is coming in a follow-up update.</p>
    </section>
  );
}
