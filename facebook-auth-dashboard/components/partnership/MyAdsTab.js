import { useState } from "react";
import Loader from "../Loader";
import SortableTable from "../SortableTable";
import Thumb from "@/components/Thumb";
import CreativeLightbox from "@/components/CreativeLightbox";
import { formatMetricValue, humanizeStatus } from "@/lib/insightsMetrics";
import styles from "@/styles/Home.module.css";

function columns(currency, onPreview) {
  return [
    {
      key: "name",
      label: "Ad",
      maxWidth: 260,
      render: (row) => (
        // No `isVideo` — these ads are almost always "existing_post"-based
        // (no inline object_story_spec, see lib/adCopy.js's classifyAd for
        // the same distinction Copy Ads draws), so there's no object_story_spec.video_data
        // to check the way every other ad-thumbnail in this app does. The
        // lightbox still resolves a correct full preview either way, via the
        // Ad Previews API — only the small play-icon overlay on the
        // thumbnail itself is skipped.
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Thumb src={row.thumbnailUrl} size={28} onClick={() => onPreview(row)} />
          <div style={{ minWidth: 0 }}>
            <p style={{ margin: 0, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.name}</p>
            <p className={styles.muted} style={{ margin: 0, fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {row.campaignName} · {row.adsetName}
            </p>
          </div>
        </div>
      ),
    },
    {
      key: "creatorUsername",
      label: "Creator",
      render: (row) =>
        row.creatorUsername ? (
          `@${row.creatorUsername}`
        ) : (
          // Hover for *why* — previously a flat, unexplained "—" for every
          // unresolved ad, reported as "most ads show an unknown creator"
          // with no way to tell whether that's because the ad itself has no
          // permalink, no Instagram Business Account was selected, the
          // lookup call itself failed, or the lookup genuinely found no
          // record. See pages/api/fb/partnership/mine.js's own comment.
          <span title={row.creatorUnresolvedReason || undefined} style={{ cursor: row.creatorUnresolvedReason ? "help" : undefined }}>
            —
          </span>
        ),
    },
    {
      key: "status",
      label: "Status",
      render: (row) => <span className={row.status === "ACTIVE" ? styles.badgeGood : styles.badgeInfo}>{humanizeStatus(row.status)}</span>,
    },
    { key: "spend", label: "Spend", align: "right", render: (row) => formatMetricValue(row.spend, "currency", currency) },
    { key: "roas", label: "ROAS", align: "right", render: (row) => formatMetricValue(row.roas, "decimal") },
    { key: "cpr", label: "CPR", align: "right", render: (row) => formatMetricValue(row.cpr, "currency", currency) },
    { key: "cpm", label: "CPM", align: "right", render: (row) => formatMetricValue(row.cpm, "currency", currency) },
    { key: "ctr", label: "CTR", align: "right", render: (row) => formatMetricValue(row.ctr, "percent") },
    { key: "purchases", label: "Purchases", align: "right", render: (row) => formatMetricValue(row.purchases, "number") },
    { key: "purchaseValue", label: "Purchase Value", align: "right", render: (row) => formatMetricValue(row.purchaseValue, "currency", currency) },
  ];
}

// My Partnership Ads: every ad on this account detected as branded content
// (see lib/partnershipDetection.js) with its own performance over the shared
// date range (pages/partnership-ads.js, same range Overview and Creator Hub
// use) — including ads created manually in Ads Manager, not just ones
// launched through this app, since detection is a live Graph check, not a
// local log. No row-selection/queue actions in this round (unlike Explore
// Ads) — these ads are already live, "add to queue" doesn't apply the same
// way.
//
// Pure display component — no fetch, no local loading/error/data state of
// its own. See pages/partnership-ads.js's own comment on `checkPerformance`
// for why this (and Creator Hub) now share one fetch+cache with Overview
// instead of each independently calling /api/fb/partnership/mine.
// One-line, plain-English breakdown of `creatorResolutionSummary` (from
// pages/api/fb/partnership/mine.js) — shown once, above the table, instead
// of making every unresolved row's own hover tooltip the only way to find
// out *why* most ads show no creator. Only the non-zero buckets are listed.
function describeCreatorSummary(summary) {
  if (!summary) return null;
  const parts = [];
  if (summary.noMediaId) parts.push(`${summary.noMediaId} with no linked Instagram media id on the ad`);
  if (summary.lookupFailed) parts.push(`${summary.lookupFailed} where the Instagram media lookup itself failed`);
  if (summary.noMatch) parts.push(`${summary.noMatch} whose Instagram media no longer resolves`);
  if (parts.length === 0) return null;
  const unresolvedCount = summary.noMediaId + summary.lookupFailed + summary.noMatch;
  return `${unresolvedCount} of ${unresolvedCount + summary.resolved} ads have no resolved creator — ${parts.join(", ")}.`;
}

export default function MyAdsTab({ ready, currency, ads, loading, error, hasLoaded, range, creatorSummary }) {
  const [lightboxItem, setLightboxItem] = useState(null);
  const creatorSummaryText = describeCreatorSummary(creatorSummary);

  if (!ready) {
    return <p className={styles.sub}>Pick an ad account above to see this.</p>;
  }

  return (
    <div>
      {!hasLoaded && !loading && (
        <p className={styles.sub} style={{ margin: 0 }}>
          Pick a date range on the right and click Check Performance to see every branded-content ad with delivery in
          that window.
        </p>
      )}
      {loading && <Loader label="Looking for partnership ads…" />}
      {error && <div className={styles.error}>{error}</div>}
      {hasLoaded && !error && (!ads || ads.length === 0) && (
        <section className={styles.card} style={{ textAlign: "center", padding: "48px 24px" }}>
          <p style={{ fontWeight: 700, marginBottom: 6 }}>No partnership ads found</p>
          <p className={styles.sub}>Ads with a branded-content creative (launched here or in Ads Manager) will show up here.</p>
        </section>
      )}
      {ads && ads.length > 0 && (
        <>
          <p className={styles.sub} style={{ marginTop: 0, marginBottom: creatorSummaryText ? 4 : undefined }}>
            {ads.length} partnership ad{ads.length === 1 ? "" : "s"} · {range.since} to {range.until}
          </p>
          {creatorSummaryText && (
            <p className={styles.muted} style={{ fontSize: 11, marginTop: 0, marginBottom: 10 }}>
              {creatorSummaryText}
            </p>
          )}
          <SortableTable
            columns={columns(currency, setLightboxItem)}
            rows={ads}
            defaultSortKey="spend"
            defaultSortDir="desc"
            searchable
            searchKeys={["name", "campaignName", "adsetName"]}
            maxHeight={520}
          />
        </>
      )}
      <CreativeLightbox
        item={lightboxItem ? { id: lightboxItem.adId, name: lightboxItem.name, thumbnailUrl: lightboxItem.thumbnailUrl } : null}
        onClose={() => setLightboxItem(null)}
      />
    </div>
  );
}
