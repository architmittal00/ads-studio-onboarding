import { useEffect, useMemo, useState } from "react";
import Loader from "../Loader";
import DateRangeMenu from "../DateRangeMenu";
import PartnerCard from "./PartnerCard";
import ExpandedCardModal from "./ExpandedCardModal";
import SelectionBar from "./SelectionBar";
import BulkPermissionModal from "./BulkPermissionModal";
import { permissionState } from "@/lib/partnershipContent";
import { computeRange } from "@/lib/dateRanges";
import { addPermissionRequestLogEntry } from "@/lib/clientStorage";
import { SearchIcon } from "../icons";
import styles from "@/styles/Home.module.css";

const MEDIA_OPTIONS = [
  { value: "all", label: "All Media" },
  { value: "VIDEO", label: "Video" },
  { value: "IMAGE", label: "Photo" },
];
const USAGE_OPTIONS = [
  { value: "all", label: "All Usage" },
  { value: "recommended", label: "Recommended" },
  { value: "not_recommended", label: "Not Recommended" },
];
const ELIGIBILITY_OPTIONS = [
  { value: "all", label: "All Eligibility" },
  { value: "ready", label: "Ready to Launch" },
  { value: "need", label: "Permission Required" },
  { value: "requested", label: "Permission Requested" },
];
const SORT_OPTIONS = [
  { value: "recent", label: "Recently Added" },
  { value: "engagement", label: "Most Engagement" },
];

function engagementScore(item) {
  const eng = item.organic_insights || {};
  return (eng.views || 0) + (eng.reach || 0) + (eng.likes || 0) + (eng.comments || 0);
}

// Explore Ads: browse a Business's partner-eligible Instagram content via
// Meta's Content Discovery API. Selection + permission requests (single from
// the expanded card, bulk from the floating selection bar) are wired up;
// "Add to Queue" stays a disabled placeholder until the launch queue ships.
export default function ExploreTab({ accountId, businessId, igUserId, ready }) {
  const [media, setMedia] = useState("all");
  const [usage, setUsage] = useState("all");
  const [eligibility, setEligibility] = useState("all");
  const [sort, setSort] = useState("recent");
  const [search, setSearch] = useState("");
  const [range, setRange] = useState({ rangePreset: "last_30d", customSince: null, customUntil: null });

  const [items, setItems] = useState([]);
  const [nextCursor, setNextCursor] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const [expandedItem, setExpandedItem] = useState(null);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkModalOpen, setBulkModalOpen] = useState(false);

  function toggleSelect(contentId) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(contentId)) next.delete(contentId);
      else next.add(contentId);
      return next;
    });
  }

  // Marks one piece of content as having just had permission requested —
  // applied optimistically (Graph's own list, pages/api/fb/partnership/permissions.js,
  // won't reflect a brand-new request instantly) so its card/badge update
  // without waiting on a refetch.
  function markRequested(contentId) {
    setItems((prev) =>
      prev.map((item) => {
        if (item.content_id !== contentId) return item;
        const info = item.partnership_info?.[0];
        return { ...item, partnership_info: [{ ...(info || {}), permission_status: "PENDING" }] };
      })
    );
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.delete(contentId);
      return next;
    });
  }

  const dateRange = useMemo(() => computeRange(range.rangePreset, range.customSince, range.customUntil), [range]);

  function buildQuery(after) {
    // media (video/photo) and eligibility (need/requested/ready) are
    // filtered client-side below, in visibleItems — the API's own filters
    // don't map 1:1 onto either: post_types means feed/stories/reels, not
    // media type, and ad_eligibilities is coarser than the mockup's 3-way
    // permission split (see lib/partnershipContent.js's permissionState).
    const params = new URLSearchParams({ businessId, igUserId });
    if (after) params.set("after", after);
    if (usage !== "all") params.set("adUsages", usage);
    if (eligibility !== "all") {
      const map = { ready: "ad_ready", need: "needs_attention", requested: "ad_ready" };
      params.set("adEligibilities", map[eligibility] || "");
    }
    if (search.trim()) params.set("searchKey", search.trim());
    if (dateRange) {
      params.set("startDate", dateRange.since);
      params.set("endDate", dateRange.until);
    }
    return params.toString();
  }

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- kicks off an async fetch that itself sets loading/error/result state, not a derived-state anti-pattern
    setLoading(true);
    setError(null);
    fetch(`/api/fb/partnership/content?${buildQuery()}`)
      .then((res) => res.json())
      .then((json) => {
        if (cancelled) return;
        if (json.error) {
          setError(json.error);
          setItems([]);
          return;
        }
        setItems(json.items || []);
        setNextCursor(json.nextCursor || null);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- buildQuery closes over the same filter state already listed below
  }, [ready, businessId, igUserId, usage, eligibility, search, dateRange?.since, dateRange?.until]);

  function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    fetch(`/api/fb/partnership/content?${buildQuery(nextCursor)}`)
      .then((res) => res.json())
      .then((json) => {
        if (json.error) {
          setError(json.error);
          return;
        }
        setItems((prev) => [...prev, ...(json.items || [])]);
        setNextCursor(json.nextCursor || null);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoadingMore(false));
  }

  // Media type and best-match "which permission bucket is this really in"
  // (the API's ad_eligibilities filter is coarser than the mockup's own
  // 3-way need/requested/ready split — see permissionState) are filtered
  // client-side; everything else is a real server-side filter already
  // applied above.
  const visibleItems = useMemo(() => {
    let list = items;
    if (media !== "all") list = list.filter((i) => i.media_type === media);
    if (eligibility !== "all") list = list.filter((i) => permissionState(i) === eligibility);
    const sorted = [...list];
    if (sort === "engagement") sorted.sort((a, b) => engagementScore(b) - engagementScore(a));
    return sorted;
  }, [items, media, eligibility, sort]);

  const selectedItems = useMemo(() => items.filter((i) => selectedIds.has(i.content_id)), [items, selectedIds]);
  const needPermissionItems = useMemo(() => selectedItems.filter((i) => permissionState(i) === "need"), [selectedItems]);
  const readyCount = selectedItems.filter((i) => permissionState(i) === "ready").length;

  // One entry per unique creator among the selected items that still need
  // permission — several selected posts can belong to the same creator, and
  // Graph's own permission grant is account-level per creator anyway (see
  // lib/partnershipAds.js's listPermissions), so a bulk request should only
  // ever ask once per creator, not once per post.
  const creatorsNeedingPermission = useMemo(() => {
    const byCreator = new Map();
    for (const item of needPermissionItems) {
      const key = item.author?.ig_user_id || item.author?.display_name;
      if (!key) continue;
      if (!byCreator.has(key)) {
        byCreator.set(key, {
          creatorIgId: item.author?.ig_user_id,
          creatorUsername: item.author?.display_name,
          label: `@${item.author?.display_name || "unknown"}`,
          contentIds: [],
        });
      }
      byCreator.get(key).contentIds.push(item.content_id);
    }
    return [...byCreator.values()].map((c) => ({ ...c, contentCount: c.contentIds.length }));
  }, [needPermissionItems]);

  function handleBulkDone(result) {
    if (!result) return;
    const successfulKeys = new Set(result.results.filter((r) => r.success).map((r) => r.creatorIgId || r.creatorUsername));
    const affectedContentIds = creatorsNeedingPermission
      .filter((c) => successfulKeys.has(c.creatorIgId || c.creatorUsername))
      .flatMap((c) => c.contentIds);
    for (const contentId of affectedContentIds) markRequested(contentId);
    for (const c of creatorsNeedingPermission) {
      if (!successfulKeys.has(c.creatorIgId || c.creatorUsername)) continue;
      for (const contentId of c.contentIds) {
        addPermissionRequestLogEntry(igUserId, {
          creatorIgId: c.creatorIgId,
          creatorUsername: c.creatorUsername,
          contentId,
          brandName: c.creatorUsername,
          requestedAt: new Date().toISOString(),
        });
      }
    }
  }

  if (!ready) {
    return <p className={styles.sub}>Pick an ad account and Instagram Business Account above to browse content.</p>;
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
        <select className={styles.select} value={media} onChange={(e) => setMedia(e.target.value)}>
          {MEDIA_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <select className={styles.select} value={usage} onChange={(e) => setUsage(e.target.value)}>
          {USAGE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <select className={styles.select} value={eligibility} onChange={(e) => setEligibility(e.target.value)}>
          {ELIGIBILITY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <select className={styles.select} value={sort} onChange={(e) => setSort(e.target.value)}>
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <div style={{ position: "relative", width: 220 }}>
          <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--t3)", pointerEvents: "none" }}>
            <SearchIcon size={13} />
          </span>
          <input
            type="text"
            className={styles.select}
            placeholder="Search caption, handle…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: "100%", paddingLeft: 30 }}
          />
        </div>
        <span className={styles.muted} style={{ fontSize: 12 }}>
          {visibleItems.length} ad{visibleItems.length === 1 ? "" : "s"}
        </span>
        <div style={{ marginLeft: "auto" }}>
          <DateRangeMenu
            rangePreset={range.rangePreset}
            customSince={range.customSince}
            customUntil={range.customUntil}
            maxRangeDays={365}
            compareDisabled
            onApply={(patch) =>
              setRange((prev) => ({
                rangePreset: patch.rangePreset ?? prev.rangePreset,
                customSince: patch.customSince ?? prev.customSince,
                customUntil: patch.customUntil ?? prev.customUntil,
              }))
            }
          />
        </div>
      </div>

      {loading && <Loader label="Loading eligible content…" />}
      {!loading && error && <div className={styles.error}>{error}</div>}
      {!loading && !error && visibleItems.length === 0 && (
        <p className={styles.sub}>No eligible content found for this filter combination.</p>
      )}

      {!loading && !error && visibleItems.length > 0 && (
        <>
          <div className={styles.partnerGrid}>
            {visibleItems.map((item) => (
              <PartnerCard
                key={item.content_id}
                item={item}
                selected={selectedIds.has(item.content_id)}
                onToggleSelect={toggleSelect}
                onExpand={setExpandedItem}
              />
            ))}
          </div>
          {nextCursor && (
            <div style={{ textAlign: "center", marginTop: 8 }}>
              <button type="button" className={styles.btnSecondary} onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? "Loading…" : "Load more"}
              </button>
            </div>
          )}
        </>
      )}

      <ExpandedCardModal
        item={expandedItem}
        igUserId={igUserId}
        onClose={() => setExpandedItem(null)}
        onPermissionRequested={markRequested}
      />

      <SelectionBar
        count={selectedIds.size}
        needPermissionCount={needPermissionItems.length}
        readyCount={readyCount}
        onClear={() => setSelectedIds(new Set())}
        onRequestPermission={() => setBulkModalOpen(true)}
      />

      {bulkModalOpen && (
        <BulkPermissionModal
          igUserId={igUserId}
          creators={creatorsNeedingPermission}
          onClose={() => setBulkModalOpen(false)}
          onDone={handleBulkDone}
        />
      )}
    </div>
  );
}
