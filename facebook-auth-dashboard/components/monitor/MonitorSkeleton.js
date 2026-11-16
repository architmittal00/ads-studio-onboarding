import styles from "@/styles/Home.module.css";

// What the Monitor tables will look like, while their numbers are still being read: the real column headings and one
// shimmering row per monitored item, so the page keeps its shape and nothing jumps when the data arrives.
export default function MonitorSkeleton({ rows, metricLabels }) {
  const columns = `minmax(200px, 2.4fr) 84px 96px repeat(${metricLabels.length}, minmax(84px, 1fr))`;
  const minWidth = 420 + metricLabels.length * 100;
  return (
    <div className={styles.skelCard} aria-hidden="true">
      <div className={`${styles.skelRow} ${styles.skelRowHead}`} style={{ gridTemplateColumns: columns, minWidth }}>
        <span className={styles.skelHeadCell}>Name</span>
        <span className={styles.skelHeadCell}>Status</span>
        <span className={styles.skelHeadCell}>Monitoring since</span>
        {metricLabels.map((label) => (
          <span key={label} className={styles.skelHeadCell} style={{ textAlign: "right" }}>
            {label}
          </span>
        ))}
      </div>
      {Array.from({ length: Math.min(Math.max(rows, 1), 4) }, (_, i) => (
        <div key={i} className={styles.skelRow} style={{ gridTemplateColumns: columns, minWidth }}>
          <span style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <span className={`${styles.skelBar} ${styles.skelBarTall}`} style={{ width: `${72 - (i % 3) * 12}%` }} />
            <span className={styles.skelBar} style={{ width: `${38 + (i % 2) * 14}%` }} />
          </span>
          <span className={`${styles.skelBar} ${styles.skelPill}`} style={{ width: 56 }} />
          <span className={styles.skelBar} style={{ width: 44 }} />
          {metricLabels.map((label, j) => (
            <span key={label} className={`${styles.skelBar} ${styles.skelRight}`} style={{ width: `${58 + ((i + j) % 3) * 12}%` }} />
          ))}
        </div>
      ))}
    </div>
  );
}
