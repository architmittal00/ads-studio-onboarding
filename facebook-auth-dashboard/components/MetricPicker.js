import { catalogGroups } from "@/lib/insightsMetrics";
import styles from "@/styles/Home.module.css";

// Shared grouped pill-grid for choosing which metric columns show in a
// table — previously duplicated almost byte-for-byte between pages/explore.js
// and pages/copy-ads.js. Purely presentational: it groups whatever `catalog`
// it's given (a caller builds its own effective catalog first — Explore's
// includes custom ratio metrics/custom conversion events via
// lib/insightsMetrics.js#buildEffectiveCatalog, Copy Ads' is just the static
// METRIC_CATALOG) and renders a pill per entry, so neither caller has to
// carry the other's complexity.
//
// `isUnavailable(metric)`/`unavailableTitle(metric)` are optional — Explore
// uses them to dim a metric (and explain why in a tooltip) that's still
// toggleable but won't actually appear in the result (e.g. Reach-dependent
// metrics under a forced rollup, or Budget outside Campaign/Ad Set level).
// A caller that has no such concept (Copy Ads) simply omits them.
export default function MetricPicker({ catalog, selectedKeys, onToggle, isUnavailable, unavailableTitle }) {
  const groups = catalogGroups(catalog);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {groups.map((group) => (
        <div key={group}>
          <p className={styles.muted} style={{ marginBottom: 6 }}>
            {group}
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {catalog
              .filter((m) => m.group === group)
              .map((m) => {
                const selected = selectedKeys.includes(m.key);
                const unavailable = isUnavailable?.(m) || false;
                return (
                  <button
                    key={m.key}
                    type="button"
                    onClick={() => onToggle(m.key)}
                    title={unavailable ? unavailableTitle?.(m) : undefined}
                    className={selected ? styles.badgeInfo : styles.pill}
                    style={
                      selected
                        ? { cursor: "pointer", opacity: unavailable ? 0.5 : 1 }
                        : {
                            cursor: "pointer",
                            background: "transparent",
                            border: "1px dashed var(--border)",
                            color: "var(--t2)",
                            opacity: unavailable ? 0.5 : 1,
                          }
                    }
                  >
                    {selected ? "✓ " : "+ "}
                    {m.label}
                  </button>
                );
              })}
          </div>
        </div>
      ))}
    </div>
  );
}
