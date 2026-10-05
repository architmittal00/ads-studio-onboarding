import { useEffect } from "react";
import TrendChart from "./TrendChart";
import { CloseIcon } from "./icons";
import styles from "@/styles/Home.module.css";

// Fullscreen drill-down for one overview metric: a daily/weekly trend chart
// over whatever date range is currently selected for the report.
export default function MetricTrendModal({ metric, trend, rangeLabel, onClose }) {
  useEffect(() => {
    if (!metric) return;
    function handleKey(e) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [metric, onClose]);

  if (!metric) return null;

  const points = (trend?.points || []).map((p) => ({
    label: formatPointLabel(p.since, p.until, trend.granularity),
    value: p[metric.key] ?? 0,
  }));

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.65)",
        backdropFilter: "blur(6px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 800,
        padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={styles.card}
        style={{ background: "#0f0e1e", width: "min(720px, 100%)", maxHeight: "85vh", overflow: "auto" }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
          <div>
            <h2 className={styles.h2} style={{ marginBottom: 2 }}>
              {metric.label} Trend
            </h2>
            <p className={styles.sub}>
              {rangeLabel} · {trend?.granularity === "weekly" ? "weekly" : "daily"} breakdown
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className={styles.btnSecondary}
            style={{ padding: 6 }}
          >
            <CloseIcon size={14} />
          </button>
        </div>

        <div style={{ marginTop: 16 }}>
          <TrendChart points={points} formatValue={metric.format} />
        </div>
      </div>
    </div>
  );
}

function formatPointLabel(since, until, granularity) {
  const d = new Date(`${since}T00:00:00Z`);
  const short = d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  if (granularity === "weekly") {
    const end = new Date(`${until}T00:00:00Z`).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
    return `${short}–${end}`;
  }
  return short;
}
