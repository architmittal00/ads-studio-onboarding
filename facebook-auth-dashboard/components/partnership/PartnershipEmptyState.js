import styles from "@/styles/Home.module.css";

// Shared empty-state card for Overview/My Partnership Ads/Creator Hub — all
// three read the same underlying fetch (see pages/partnership-ads.js's
// checkPerformance), so the same "nothing checked yet" / "checked, found
// nothing" treatment applies to all three. Mirrors the icon + heading +
// optional numbered steps + CTA pattern pages/explore.js's ExploreEmptyState
// and pages/recent-changes.js's own equivalent already use, reusing their
// exact CSS (.exploreEmptyState etc.) rather than inventing a new look.
export default function PartnershipEmptyState({ icon: Icon, title, description, steps, ctaLabel, onRun, canRun, loading }) {
  return (
    <section className={styles.card}>
      <div className={styles.exploreEmptyState}>
        <div className={styles.exploreEmptyIcon}>
          <Icon size={26} />
        </div>
        <div>
          <h2 className={styles.h2} style={{ marginBottom: 6 }}>
            {title}
          </h2>
          <p className={styles.sub}>{description}</p>
        </div>
        {steps && steps.length > 0 && (
          <div className={styles.exploreEmptySteps}>
            {steps.map((step, i) => (
              <div key={step} className={styles.exploreEmptyStep}>
                <span className={styles.exploreEmptyStepNum}>{i + 1}</span>
                {step}
              </div>
            ))}
          </div>
        )}
        {onRun && (
          <button type="button" className={styles.btnPrimary} disabled={!canRun || loading} onClick={onRun}>
            {loading ? "Checking…" : ctaLabel}
          </button>
        )}
      </div>
    </section>
  );
}
