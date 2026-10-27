import { useMemo, useState } from "react";
import Loader from "../Loader";
import SortableTable from "../SortableTable";
import Thumb from "@/components/Thumb";
import CreativeLightbox from "@/components/CreativeLightbox";
import PartnershipEmptyState from "./PartnershipEmptyState";
import CreatorAvatar from "./CreatorAvatar";
import { HandshakeIcon, CloseIcon } from "@/components/icons";
import { formatMetricValue, humanizeStatus } from "@/lib/insightsMetrics";
import { METRIC_FILTER_OPERATORS, applyResultFilters } from "@/lib/copyAdsFilters";
import ExploreMobileList from "@/components/ExploreMobileList";
import BottomSheet from "@/components/BottomSheet";
import { useIsMobile } from "@/lib/useIsMobile";
import styles from "@/styles/Home.module.css";

// Phone list config: the same metrics as the desktop table, as cards.
const MOBILE_METRICS = [
  { key: "spend", label: "Spend", format: "currency" },
  { key: "roas", label: "ROAS", format: "decimal" },
  { key: "cpr", label: "CPR", format: "currency" },
  { key: "cpm", label: "CPM", format: "currency" },
  { key: "ctr", label: "CTR", format: "percent" },
  { key: "purchases", label: "Purchases", format: "number" },
  { key: "purchaseValue", label: "Purchase Value", format: "currency" },
];
const MOBILE_SORT_COLUMNS = [...MOBILE_METRICS, { key: "name", label: "Ad name", isName: true, sortValue: (r) => r.name || "" }];
const EMPTY_SET = new Set();
const noop = () => {};
const MOBILE_NO_DRILL = {
  enabled: false,
  pivotEnabled: false,
  expansions: {},
  plural: () => "",
  childLevel: () => null,
  orderChildren: (rows) => rows,
};
function mobileSubtitle(row) {
  return [row.creatorUsername && `@${row.creatorUsername}`, row.campaignName].filter(Boolean).join(" · ");
}

// The numeric columns a "Filter results" condition can threshold on — same
// metric set the table itself renders (see columns() below), ported from
// Copy Ads' identical "Filter results" feature (lib/copyAdsFilters.js's own
// header comment traces this back to pages/explore.js's original version).
const FILTER_METRICS = [
  { key: "spend", label: "Spend" },
  { key: "roas", label: "ROAS" },
  { key: "cpr", label: "CPR" },
  { key: "cpm", label: "CPM" },
  { key: "ctr", label: "CTR" },
  { key: "purchases", label: "Purchases" },
  { key: "purchaseValue", label: "Purchase Value" },
];
const FILTER_METRIC_KEYS = FILTER_METRICS.map((m) => m.key);

function newFilterId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `f${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

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
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <CreatorAvatar src={row.creatorProfilePictureUrl} username={row.creatorUsername} size={22} />
            <span>@{row.creatorUsername}</span>
          </div>
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

export default function MyAdsTab({ ready, currency, ads, loading, error, hasLoaded, range, creatorSummary, onCheck, canCheck }) {
  const isMobile = useIsMobile();
  const [lightboxItem, setLightboxItem] = useState(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [mSortKey, setMSortKey] = useState("spend");
  const [mSortDir, setMSortDir] = useState("desc");
  const [mSearch, setMSearch] = useState("");
  const creatorSummaryText = describeCreatorSummary(creatorSummary);

  // "Filter results" — same post-query, client-side pivot pattern as Copy
  // Ads and Explore (see lib/copyAdsFilters.js's header comment): metric
  // conditions are a local draft until "Apply Filters," since typing a
  // threshold shouldn't re-filter the table on every keystroke; Status
  // checkboxes apply instantly since there's no typing-jank to smooth over.
  const [draftConditions, setDraftConditions] = useState([]);
  const [appliedConditions, setAppliedConditions] = useState([]);
  const hasPendingFilterChanges = JSON.stringify(draftConditions) !== JSON.stringify(appliedConditions);
  // `null` means "no filter" (every status counts); an array means "only
  // these" — including an empty array, which means every box was explicitly
  // unchecked and nothing should match.
  const [statusValues, setStatusValues] = useState(null);
  const availableStatuses = useMemo(() => [...new Set((ads || []).map((a) => a.status).filter(Boolean))].sort(), [ads]);

  function addDraftCondition() {
    setDraftConditions((prev) => [...prev, { id: newFilterId(), metricKey: FILTER_METRIC_KEYS[0], operator: "gte", value: 0 }]);
  }
  function updateDraftCondition(id, patch) {
    setDraftConditions((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }
  function removeDraftCondition(id) {
    const next = draftConditions.filter((c) => c.id !== id);
    setDraftConditions(next);
    setAppliedConditions(next);
  }
  function applyMetricFilters() {
    setAppliedConditions(draftConditions);
  }
  function toggleStatus(status) {
    const current = statusValues ?? availableStatuses;
    const next = current.includes(status) ? current.filter((s) => s !== status) : [...current, status];
    const allChecked = availableStatuses.length > 0 && availableStatuses.every((s) => next.includes(s));
    setStatusValues(allChecked ? null : next);
  }

  const metricFiltered = useMemo(() => applyResultFilters(ads, appliedConditions, FILTER_METRIC_KEYS), [ads, appliedConditions]);
  const filteredAds = useMemo(
    () => (statusValues ? metricFiltered.filter((row) => statusValues.includes(row.status)) : metricFiltered),
    [metricFiltered, statusValues]
  );

  const filterCount = appliedConditions.length + (statusValues ? 1 : 0);
  const mobileRows = useMemo(() => (filteredAds || []).map((r) => ({ ...r, entityId: r.adId })), [filteredAds]);
  const mobileTotals = useMemo(() => {
    const t = (filteredAds || []).reduce((a, r) => ({ spend: a.spend + (r.spend || 0), purchases: a.purchases + (r.purchases || 0), purchaseValue: a.purchaseValue + (r.purchaseValue || 0) }), { spend: 0, purchases: 0, purchaseValue: 0 });
    return { ...t, roas: t.spend ? t.purchaseValue / t.spend : null, cpr: t.purchases ? t.spend / t.purchases : null };
  }, [filteredAds]);

  const filterCard = (
    <div className={isMobile ? undefined : styles.card} style={isMobile ? undefined : { padding: 12, marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span className={styles.muted} style={{ fontWeight: 600 }}>
          Filter results
        </span>
        <button type="button" className={styles.btnSecondary} onClick={addDraftCondition}>
          + Metric filter
        </button>
        {(draftConditions.length > 0 || hasPendingFilterChanges) && (
          <button type="button" className={styles.btnPrimary} disabled={!hasPendingFilterChanges} onClick={applyMetricFilters}>
            Apply Filters
          </button>
        )}
      </div>

      {draftConditions.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
          {draftConditions.map((c) => (
            <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <select className={styles.select} value={c.metricKey} onChange={(e) => updateDraftCondition(c.id, { metricKey: e.target.value })}>
                {FILTER_METRICS.map((m) => (
                  <option key={m.key} value={m.key}>
                    {m.label}
                  </option>
                ))}
              </select>
              <select className={styles.select} value={c.operator} onChange={(e) => updateDraftCondition(c.id, { operator: e.target.value })}>
                {METRIC_FILTER_OPERATORS.map((op) => (
                  <option key={op.value} value={op.value}>
                    {op.label}
                  </option>
                ))}
              </select>
              <input
                type="number"
                className={styles.select}
                style={{ width: 110 }}
                value={c.value}
                onChange={(e) => updateDraftCondition(c.id, { value: e.target.value === "" ? "" : Number(e.target.value) })}
                onKeyDown={(e) => e.key === "Enter" && applyMetricFilters()}
              />
              <button type="button" className={styles.btnSecondary} onClick={() => removeDraftCondition(c.id)} aria-label="Remove filter">
                <CloseIcon size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      {availableStatuses.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", marginTop: 12 }}>
          <span className={styles.muted}>Status</span>
          {availableStatuses.map((s) => (
            <label key={s} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 13 }}>
              <input type="checkbox" checked={!statusValues || statusValues.includes(s)} onChange={() => toggleStatus(s)} />
              {humanizeStatus(s)}
            </label>
          ))}
        </div>
      )}
    </div>
  );

  if (!ready) {
    return (
      <PartnershipEmptyState
        icon={HandshakeIcon}
        title="Pick an ad account"
        description="Select an ad account in the header above to see your branded-content ads."
      />
    );
  }

  return (
    <div>
      {!hasLoaded && !loading && (
        <PartnershipEmptyState
          icon={HandshakeIcon}
          title="See your partnership ads"
          description="Every ad with a branded-content creative, with its own performance over a chosen window."
          steps={["Pick an ad account", "Choose a date range", 'Click "Check Performance"']}
          ctaLabel="Check Performance"
          onRun={onCheck}
          canRun={canCheck}
          loading={loading}
        />
      )}
      {loading && <Loader label="Looking for partnership ads…" />}
      {error && <div className={styles.error}>{error}</div>}
      {hasLoaded && !error && (!ads || ads.length === 0) && (
        <PartnershipEmptyState
          icon={HandshakeIcon}
          title="No partnership ads found"
          description="Ads with a branded-content creative (launched here or in Ads Manager) will show up here."
        />
      )}
      {ads && ads.length > 0 && (
        <>
          <p className={styles.sub} style={{ marginTop: 0, marginBottom: creatorSummaryText ? 4 : undefined }}>
            {filteredAds.length === ads.length
              ? `${ads.length} partnership ad${ads.length === 1 ? "" : "s"}`
              : `${filteredAds.length} of ${ads.length} partnership ads`}{" "}
            {!isMobile && `· ${range.since} to ${range.until}`}
          </p>
          {creatorSummaryText && (
            <p className={styles.muted} style={{ fontSize: 11, marginTop: 0, marginBottom: 10 }}>
              {creatorSummaryText}
            </p>
          )}
          {!isMobile && filterCard}
          {isMobile ? (
            <ExploreMobileList
              rows={mobileRows}
              level="ad"
              metricColumns={MOBILE_METRICS}
              sortColumns={MOBILE_SORT_COLUMNS}
              statusAvailable
              totalsRow={mobileTotals}
              kpiKeys={["spend", "roas", "cpr", "purchases", "purchaseValue"]}
              renderMetric={(row, key) => formatMetricValue(row[key], MOBILE_METRICS.find((m) => m.key === key)?.format, currency, { compact: true })}
              getTitle={(r) => r.name}
              getSubtitle={mobileSubtitle}
              sortKey={mSortKey}
              sortDir={mSortDir}
              onSortChange={(k, d) => {
                setMSortKey(k);
                setMSortDir(d);
              }}
              search={mSearch}
              onSearchChange={setMSearch}
              selectedIds={EMPTY_SET}
              onToggleSelected={noop}
              onSelectAll={noop}
              allSelected={false}
              selectable={false}
              drill={MOBILE_NO_DRILL}
              renderActions={() => null}
              onViewDetails={(d) => setLightboxItem(mobileRows.find((r) => r.entityId === d.id) || null)}
              onOpenThumb={(row) => setLightboxItem(row)}
              toolbarExtra={
                <button type="button" className={filterCount ? `${styles.mobileToolBtn} ${styles.mobileToolBtnOn}` : styles.mobileToolBtn} onClick={() => setFiltersOpen(true)}>
                  Filters{filterCount ? ` · ${filterCount}` : ""}
                </button>
              }
            />
          ) : (
            <SortableTable
              columns={columns(currency, setLightboxItem)}
              rows={filteredAds}
              defaultSortKey="spend"
              defaultSortDir="desc"
              searchable
              searchKeys={["name", "campaignName", "adsetName"]}
              emptyMessage={appliedConditions.length > 0 || statusValues ? "No ads match the current filters." : "No ads found."}
              maxHeight={520}
            />
          )}
        </>
      )}
      {isMobile && (
        <BottomSheet open={filtersOpen} title="Filter ads" onClose={() => setFiltersOpen(false)}>
          {filterCard}
        </BottomSheet>
      )}
      <CreativeLightbox
        item={lightboxItem ? { id: lightboxItem.adId, name: lightboxItem.name, thumbnailUrl: lightboxItem.thumbnailUrl } : null}
        onClose={() => setLightboxItem(null)}
      />
    </div>
  );
}
