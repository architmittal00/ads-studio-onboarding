import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/router";
import Loader from "../Loader";
import PartnerCard from "./PartnerCard";
import ExpandedCardModal from "./ExpandedCardModal";
import SelectionBar from "./SelectionBar";
import BulkPermissionModal from "./BulkPermissionModal";
import RedirectionLinkModal from "./RedirectionLinkModal";
import { permissionState, firstPartnershipInfo } from "@/lib/partnershipContent";
import { fetchWithTimeout, parseJsonResponse } from "@/lib/fetchJson";
import { addPermissionRequestLogEntry, addToPartnershipQueue } from "@/lib/clientStorage";
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
  { value: "own", label: "Not a Partner Post" },
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
// Meta's Content Discovery API. Selection, permission requests (single from
// the expanded card, bulk from the floating selection bar), and queuing
// launch-ready content are all wired up.
//
// `dateRange` ({since, until} or null) is owned by pages/partnership-ads.js
// now, not this component — its own header pill row shows Ad Account +
// Instagram Business Account + Date Range for every tab (previously Explore
// kept its own separate DateRangeMenu inside its filter row while the other
// controls lived in a side panel, an inconsistent layout the user flagged).
// Still a genuinely separate piece of state from the performance tabs'
// shared range (filtering *content posted* in a window is an unrelated
// concept from ad *performance*), just lifted to the same parent instead of
// living locally here.
export default function ExploreTab({ accountId, businessId, igUserId, ready, dateRange, onQueueChanged }) {
  const router = useRouter();
  const [media, setMedia] = useState("all");
  const [usage, setUsage] = useState("all");
  const [eligibility, setEligibility] = useState("all");
  const [sort, setSort] = useState("recent");
  const [search, setSearch] = useState("");

  const [items, setItems] = useState([]);
  const [nextCursor, setNextCursor] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const [expandedItem, setExpandedItem] = useState(null);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkModalOpen, setBulkModalOpen] = useState(false);
  // Snapshot of the ready-to-queue content items taken at the moment "Add to
  // Queue" is clicked, held while RedirectionLinkModal is open collecting
  // each one's landing-page link — kept separate from `readyItems` itself so
  // the modal's list can't shift under the user if selection changes behind
  // it (it can't, since the bar is hidden once the modal is open, but this
  // also survives the selectedIds clear that happens on commit).
  const [pendingQueueSource, setPendingQueueSource] = useState(null);
  const sentinelRef = useRef(null);

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

  function buildQuery(after) {
    // media (video/photo) and eligibility (need/requested/ready) are
    // filtered client-side below, in visibleItems — the API's own filters
    // don't map 1:1 onto either: post_types means feed/stories/reels, not
    // media type, and ad_eligibilities is coarser than the mockup's 3-way
    // permission split (see lib/partnershipContent.js's permissionState).
    // `limit: 50` — the real cap lib/partnershipAds.js's discoverContent
    // already enforces (Math.min(limit, 50)); this request previously never
    // set one at all and silently got the server's own default of 25,
    // reported by the user as "why is this paginated" — doubling the actual
    // batch size per "Load more" click, not changing the underlying
    // cursor-paginated nature of the Content Discovery API itself (walking
    // every page in one request isn't bounded the way this one query is,
    // the same reasoning Overview's own ad-history walk was fixed for).
    const params = new URLSearchParams({ businessId, igUserId, limit: "50" });
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
    fetchWithTimeout(`/api/fb/partnership/content?${buildQuery()}`)
      .then(parseJsonResponse)
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
    fetchWithTimeout(`/api/fb/partnership/content?${buildQuery(nextCursor)}`)
      .then(parseJsonResponse)
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

  // Auto-loads the next page as the user scrolls near the bottom, instead of
  // requiring a "Load more" click — reported by the user as an unnecessary
  // extra step. The sentinel div below the grid is only rendered while
  // `nextCursor` exists, and this effect only (re-)subscribes an observer
  // while there's a cursor to fetch AND no fetch already in flight — the
  // `loadingMore` dependency means the observer is torn down the instant a
  // fetch starts and only resubscribed once it finishes, so a second
  // intersection event while already loading can't ever fire a duplicate
  // request (a plain `if (loadingMore) return` guard inside a long-lived
  // observer callback would still race, since that callback's own closure
  // would keep seeing whatever `loadingMore` was at observer-creation time).
  useEffect(() => {
    if (!nextCursor || loadingMore) return;
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) loadMore();
      },
      { rootMargin: "600px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadMore is recreated every render but reads nextCursor/loadingMore fresh each call; re-subscribing whenever either of those actually changes is what matters, not loadMore's own identity
  }, [nextCursor, loadingMore]);

  // Media type and best-match "which permission bucket is this really in"
  // (the API's ad_eligibilities filter is coarser than the mockup's own
  // 3-way need/requested/ready split — see permissionState) are filtered
  // client-side; everything else is a real server-side filter already
  // applied above.
  const visibleItems = useMemo(() => {
    let list = items;
    if (media !== "all") list = list.filter((i) => i.media_type === media);
    if (eligibility !== "all") list = list.filter((i) => permissionState(i, igUserId) === eligibility);
    const sorted = [...list];
    if (sort === "engagement") sorted.sort((a, b) => engagementScore(b) - engagementScore(a));
    return sorted;
  }, [items, media, eligibility, sort, igUserId]);

  const selectedItems = useMemo(() => items.filter((i) => selectedIds.has(i.content_id)), [items, selectedIds]);
  const needPermissionItems = useMemo(() => selectedItems.filter((i) => permissionState(i, igUserId) === "need"), [selectedItems, igUserId]);
  const readyItems = useMemo(() => selectedItems.filter((i) => permissionState(i, igUserId) === "ready"), [selectedItems, igUserId]);

  function queueItemLabel(item) {
    return `@${item.author?.display_name || "unknown"} — ${item.caption?.slice(0, 40) || item.content_id}`;
  }

  // Opens RedirectionLinkModal instead of queuing immediately — see its own
  // header comment for why.
  function handleAddSelectedToQueue() {
    if (readyItems.length === 0) return;
    setPendingQueueSource(readyItems);
  }

  // `linksById` maps `explore_<content_id>` -> a redirection link (possibly
  // "" for everything, when the user clicked Skip). Commits the queue add
  // and jumps straight to Ready to Launch, same reasoning as the modal's own
  // "post adding the link" flow the user asked for.
  function commitQueueAdd(linksById) {
    const source = pendingQueueSource || [];
    const toQueue = source.map((item) => {
      const info = firstPartnershipInfo(item);
      const id = `explore_${item.content_id}`;
      return {
        id,
        source: "explore",
        contentId: item.content_id,
        adCode: info.ad_code,
        name: queueItemLabel(item),
        mediaType: item.media_type,
        permalink: item.permalink,
        primaryText: item.caption || "",
        headline: "",
        description: "",
        cta: "SHOP_NOW",
        redirectionLink: (linksById?.[id] || "").trim(),
      };
    });
    addToPartnershipQueue(accountId, toQueue);
    onQueueChanged?.();
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const item of source) next.delete(item.content_id);
      return next;
    });
    setPendingQueueSource(null);
    router.push("/partnership-ads/queue");
  }

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
        <span className={styles.muted} style={{ fontSize: 12, marginLeft: "auto" }}>
          {visibleItems.length} ad{visibleItems.length === 1 ? "" : "s"}
        </span>
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
                igUserId={igUserId}
                selected={selectedIds.has(item.content_id)}
                onToggleSelect={toggleSelect}
                onExpand={setExpandedItem}
              />
            ))}
          </div>
          {nextCursor && (
            <div ref={sentinelRef} style={{ textAlign: "center", marginTop: 8, padding: 8, minHeight: 1 }}>
              {loadingMore && <span className={styles.muted} style={{ fontSize: 12 }}>Loading more…</span>}
            </div>
          )}
        </>
      )}

      <ExpandedCardModal
        item={expandedItem}
        accountId={accountId}
        igUserId={igUserId}
        onClose={() => setExpandedItem(null)}
        onPermissionRequested={markRequested}
        onQueued={onQueueChanged}
      />

      <SelectionBar
        count={selectedIds.size}
        needPermissionCount={needPermissionItems.length}
        readyCount={readyItems.length}
        onClear={() => setSelectedIds(new Set())}
        onRequestPermission={() => setBulkModalOpen(true)}
        onAddToQueue={handleAddSelectedToQueue}
      />

      {bulkModalOpen && (
        <BulkPermissionModal
          igUserId={igUserId}
          creators={creatorsNeedingPermission}
          onClose={() => setBulkModalOpen(false)}
          onDone={handleBulkDone}
        />
      )}

      {pendingQueueSource && (
        <RedirectionLinkModal
          items={pendingQueueSource.map((item) => ({ id: `explore_${item.content_id}`, name: queueItemLabel(item) }))}
          onSkip={() => commitQueueAdd({})}
          onSave={(linksById) => commitQueueAdd(linksById)}
        />
      )}
    </div>
  );
}
