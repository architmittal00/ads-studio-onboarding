import Head from "next/head";
import { getServerSession } from "next-auth/next";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { authOptions } from "./api/auth/[...nextauth]";
import Layout from "@/components/Layout";
import Loader from "@/components/Loader";
import AccountSelect from "@/components/AccountSelect";
import SortableTable from "@/components/SortableTable";
import Thumb from "@/components/Thumb";
import CreativeLightbox from "@/components/CreativeLightbox";
import DateRangeMenu from "@/components/DateRangeMenu";
import SelectionBar from "@/components/copyads/SelectionBar";
import CopyAdsModal from "@/components/copyads/CopyAdsModal";
import MetricPicker from "@/components/MetricPicker";
import SelectAllCheckbox from "@/components/SelectAllCheckbox";
import { CloseIcon, SettingsIcon, ChevronIcon, CopyIcon } from "@/components/icons";
import { useAccounts } from "@/components/AccountProvider";
import { RANGE_PRESETS, computeRange } from "@/lib/dateRanges";
import { DEFAULT_COPY_METRIC_KEYS } from "@/lib/adCopy";
import { METRIC_CATALOG, formatMetricValue } from "@/lib/insightsMetrics";
import { METRIC_FILTER_OPERATORS, applyResultFilters } from "@/lib/copyAdsFilters";
import { fetchWithTimeout, parseJsonResponse } from "@/lib/fetchJson";
import { getCopyAdsQueryPanelCollapsed, setCopyAdsQueryPanelCollapsed } from "@/lib/clientStorage";
import styles from "@/styles/Home.module.css";

// Reads /api/fb/copy-ads/source-ads' newline-delimited JSON response (same
// streaming convention as pages/explore.js's fetchExploreInsights) —
// `onBatch` fires once per `ads_batch` event, as each 50-id batch on the
// server resolves, so the table fills in incrementally instead of staying
// blank until the entire account-wide fetch finishes. `fetchWithTimeout`
// still guards the initial connection (a true network hang); once the
// stream is open, it stays open for as long as the server keeps writing.
async function fetchSourceAdsStream(url, onBatch) {
  const res = await fetchWithTimeout(url);
  if (!res.ok || !res.body) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json.error || `Request failed (${res.status})`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let doneEvent = null;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line);
      if (event.type === "ads_batch") onBatch(event.ads || []);
      else if (event.type === "done") doneEvent = event;
    }
  }
  if (!doneEvent) throw new Error("Request ended unexpectedly");
  if (doneEvent.error) throw new Error(doneEvent.error);
  return doneEvent;
}

// One-line recap shown in place of the source/metrics form while the panel
// is collapsed — same convention as Explore's own summarizeQuery(). The
// date range itself isn't repeated here since the collapsed view has no
// DateRangeMenu control of its own left visible to pair it with.
function summarizeCopyAdsQuery(accountName, rangePreset, metricCount) {
  const accountLabel = accountName || "No account selected";
  const rangeLabel = RANGE_PRESETS.find((p) => p.key === rangePreset)?.label || "Custom range";
  return `${accountLabel} · ${rangeLabel} · ${metricCount} metric${metricCount === 1 ? "" : "s"}`;
}

// Shown before ads have ever been loaded for the current account — same
// "explain the screen, don't just leave it blank" pattern as pages/explore.js's
// ExploreEmptyState and pages/recent-changes.js's RecentChangesEmptyState
// (same .exploreEmptyState/.exploreEmptyIcon/.exploreEmptySteps CSS, shared
// across all three). Replaces what used to be three separate one-line
// messages ("Pick a source ad account…", "Pick both custom dates…", "Click
// Load Ads…") picked by whichever precondition wasn't yet met — those read
// as an afterthought and left most of the page blank; this explains what the
// page is for regardless of which step the user is currently missing.
// Level-specific copy, same icon+numbered-steps shell for all three —
// "Ad" keeps its original wording verbatim (defaults below); "Ad Set" and
// "Campaign" (pages/copy-ads.js's level selector) pass their own title/
// description/steps/runLabel instead of this component needing its own
// level-awareness.
function CopyAdsEmptyState({
  canRun,
  onRun,
  loading,
  title = "Clone ads into another ad account",
  description = "Load ads from a source account, pick the ones you want, then copy their creative — Page and all — into an ad set that already exists in a different ad account.",
  steps = ["Pick a source ad account", "Choose a date range with spend", 'Click "Load Ads"', "Select ads and copy them to a destination"],
  runLabel = "Load Ads",
  loadingLabel = "Loading…",
}) {
  return (
    <section className={styles.card}>
      <div className={styles.exploreEmptyState}>
        <div className={styles.exploreEmptyIcon}>
          <CopyIcon size={26} />
        </div>
        <div>
          <h2 className={styles.h2} style={{ marginBottom: 6 }}>
            {title}
          </h2>
          <p className={styles.sub}>{description}</p>
        </div>
        <div className={styles.exploreEmptySteps}>
          {steps.map((step, i) => (
            <div key={step} className={styles.exploreEmptyStep}>
              <span className={styles.exploreEmptyStepNum}>{i + 1}</span>
              {step}
            </div>
          ))}
        </div>
        <button type="button" className={styles.btnPrimary} disabled={!canRun || loading} onClick={onRun}>
          {loading ? loadingLabel : runLabel}
        </button>
      </div>
    </section>
  );
}

function newFilterId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `f${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

// Post-query metric-threshold filter bar — originally built for the Ad
// level's own picker alone, now shared by all three levels (one set of
// conditions, kept live across level switches, same as `metricKeys`'s own
// already-shared behavior — picking "Spend ≥ 500" means the same thing
// whichever level you're filtering). Extracted into its own component so
// this one JSX block (draft condition rows, Apply Filters button, result
// count badge) doesn't need a third near-identical copy for ad sets and a
// fourth for campaigns — every prop here is already level-agnostic.
function MetricFilterBar({
  totalCount,
  filteredCount,
  itemLabel,
  loading,
  metricKeys,
  draftConditions,
  hasPendingFilterChanges,
  onAddCondition,
  onUpdateCondition,
  onRemoveCondition,
  onApply,
}) {
  return (
    <div className={styles.card} style={{ padding: 12, marginBottom: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span className={styles.muted} style={{ fontWeight: 600 }}>
          Filter results
        </span>
        <span className={styles.badgeInfo}>
          {filteredCount === totalCount
            ? `${totalCount} ${itemLabel}${totalCount === 1 ? "" : "s"}`
            : `${filteredCount} of ${totalCount} ${itemLabel}${totalCount === 1 ? "" : "s"}`}
          {loading && " · loading…"}
        </span>
        <button type="button" className={styles.btnSecondary} onClick={onAddCondition}>
          + Metric filter
        </button>
        {(draftConditions.length > 0 || hasPendingFilterChanges) && (
          <button type="button" className={styles.btnPrimary} disabled={!hasPendingFilterChanges} onClick={onApply}>
            Apply Filters
          </button>
        )}
      </div>

      {draftConditions.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
          {draftConditions.map((c) => (
            <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <select className={styles.select} value={c.metricKey} onChange={(e) => onUpdateCondition(c.id, { metricKey: e.target.value })}>
                {metricKeys
                  .filter((k) => PICKER_METRIC_CATALOG.find((m) => m.key === k)?.format !== "text")
                  .map((k) => (
                    <option key={k} value={k}>
                      {PICKER_METRIC_CATALOG.find((m) => m.key === k)?.label || k}
                    </option>
                  ))}
              </select>
              <select className={styles.select} value={c.operator} onChange={(e) => onUpdateCondition(c.id, { operator: e.target.value })}>
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
                onChange={(e) => onUpdateCondition(c.id, { value: e.target.value === "" ? "" : Number(e.target.value) })}
                onKeyDown={(e) => e.key === "Enter" && onApply()}
              />
              <button type="button" className={styles.btnSecondary} onClick={() => onRemoveCondition(c.id)} aria-label="Remove filter">
                <CloseIcon size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Capped tighter than Explore's 365-day ceiling: this picker's per-ad fields
// are heavier (full object_story_spec/asset_feed_spec, carousel
// child_attachments), and this feature has already hit real Graph errors
// twice on wide windows (PR #206's "reduce the amount of data," PR #210's
// FUNCTION_INVOCATION_TIMEOUT) — 90 days matches the original pre-narrowing
// default and leaves real headroom given the /insights-first discovery
// already bounds the heavy fetch to ads with real delivery.
const MAX_RANGE_DAYS = 90;

// "Budget" isn't a real Insights-API field (see its own comment in
// lib/insightsMetrics.js — it's only meaningful at Campaign/Ad Set level,
// fetched via a separate entity lookup Explore does but this page doesn't),
// so it would always render "—" here. Left out of this page's metric picker
// entirely rather than offered as a column that can never show a value.
const PICKER_METRIC_CATALOG = METRIC_CATALOG.filter((m) => m.key !== "budget");
const METRIC_COLUMN_WIDTH = { currency: 115, percent: 90, decimal: 90, number: 100, text: 150 };

// Cross-account ad cloning: pick ads already running in one ad account and
// copy them — creative and all — into an ad set that already exists in a
// different ad account. Built for the common D2C-agency setup where the
// same Page runs ads out of several ad accounts. The destination ad set's
// own targeting/budget/campaign are untouched; this is a creative+ad clone,
// not a campaign migrator — see the feature's own plan for why that scope
// is enough. There's no other "browse every ad in an account" picker
// anywhere else in this app (every duplicate/launch flow starts from one
// already-on-screen ad), so this page's source-ads table is new.
export default function CopyAdsPage() {
  const { adAccounts, accountsLoading, accountsError, selectedAccountId, setSelectedAccountId } = useAccounts();

  // Which kind of object this page's picker table shows and copies — "ad"
  // is the original, real-account-tested behavior (below); "adset" and
  // "campaign" are new (see PROJECT_STATUS.md/the feature's own plan),
  // creating a brand-new ad set/campaign with matching properties in the
  // destination account rather than copying into one that already exists.
  // Each level owns its own picker state entirely (adsetItems*/campaignItems*
  // below) rather than reusing `ads`' shape, since an ad set/campaign row
  // and an ad row have little in common and forcing one shape onto all
  // three would make every column/render function level-conditional instead
  // of just the handful of places that actually need to branch.
  const [level, setLevel] = useState("ad"); // "ad" | "adset" | "campaign"

  const [ads, setAds] = useState([]);
  const [adsLoading, setAdsLoading] = useState(false);
  const [adsError, setAdsError] = useState(null);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [modalOpen, setModalOpen] = useState(false);
  const [lightboxItem, setLightboxItem] = useState(null);

  // Declared up here (ahead of the rest of each level's own state/loader
  // further down) only because `queryPanelExpanded` below needs all three
  // "has this level's picker ever loaded" flags together — everything else
  // about the Ad Set/Campaign levels is declared together, closer to where
  // it's actually used.
  const [adsetHasLoaded, setAdsetHasLoaded] = useState(false);
  const [campaignHasLoaded, setCampaignHasLoaded] = useState(false);
  const hasLoadedForLevel = level === "ad" ? hasLoaded : level === "adset" ? adsetHasLoaded : campaignHasLoaded;
  // Also declared up here (not with the rest of each level's own state
  // further down) since the table-height recompute effect below needs their
  // `.length` alongside hasLoadedForLevel's own flags.
  const [adsetItems, setAdsetItems] = useState([]);
  const [campaignItems, setCampaignItems] = useState([]);

  // Defaults to a short, cheap window rather than "every ad ever" — an
  // unfiltered (or too-wide) account-wide pull with this picker's heavy
  // per-ad creative fields is exactly what triggers Meta's "Please reduce
  // the amount of data you're asking for" error on any account with real
  // history. `range` resolves to `null` only while "Custom" is picked and
  // one of the two date inputs is still empty, in which case Load Ads below
  // stays disabled rather than firing with a half-filled range.
  const [rangePreset, setRangePreset] = useState("last_7d");
  const [customSince, setCustomSince] = useState("");
  const [customUntil, setCustomUntil] = useState("");
  const sourceTimeZone = adAccounts.find((a) => a.id === selectedAccountId)?.timezone_name;
  const range = computeRange(rangePreset, customSince, customUntil, sourceTimeZone);

  // Collapsed by default (per-device, like Explore's own query panel) so
  // the result table — not the source/metrics form that produced it — is
  // the first thing the user sees on return visits; expanding shows the
  // form side-by-side with the result rather than covering it. See
  // `queryPanelExpanded` below for the one exception (nothing loaded yet
  // forces this open, same as Explore forcing it open with no result).
  const queryPanelRef = useRef(null);
  const [queryPanelCollapsed, setQueryPanelCollapsedState] = useState(true);
  useEffect(() => {
    const saved = getCopyAdsQueryPanelCollapsed();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time read of a per-device localStorage preference on mount, not derivable from props/state
    if (saved != null) setQueryPanelCollapsedState(saved);
  }, []);
  function toggleQueryPanel() {
    setQueryPanelCollapsedState((prev) => {
      const next = !prev;
      setCopyAdsQueryPanelCollapsed(next);
      return next;
    });
  }
  const queryPanelExpanded = !hasLoadedForLevel || !queryPanelCollapsed;

  // Same sticky-height recompute as Explore's own query panel — `.exploreQueryPanel`'s
  // CSS caps it at `calc(100vh - 40px)` assuming its top edge sits at the
  // `top: 20px` it's pinned to once sticky engages, which is only true after
  // scrolling past the title above it. Recomputing from the panel's actual
  // current top keeps its bottom edge pinned just above the viewport bottom
  // at every scroll position instead.
  const [queryPanelMaxHeight, setQueryPanelMaxHeight] = useState(null);
  useLayoutEffect(() => {
    if (!queryPanelExpanded) return;
    const PANEL_BOTTOM_MARGIN = 20;
    const PANEL_MIN_HEIGHT = 240;
    let frame = null;
    function recompute() {
      frame = null;
      const el = queryPanelRef.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top;
      setQueryPanelMaxHeight(Math.max(PANEL_MIN_HEIGHT, window.innerHeight - top - PANEL_BOTTOM_MARGIN));
    }
    function onScrollOrResize() {
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(recompute);
    }
    recompute();
    // capture: true — this app's global CSS makes <body>, not the document,
    // the actual scrolling element, and a native "scroll" event doesn't
    // bubble, so a plain window listener would never fire.
    window.addEventListener("scroll", onScrollOrResize, { passive: true, capture: true });
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      window.removeEventListener("scroll", onScrollOrResize, { capture: true });
      window.removeEventListener("resize", onScrollOrResize);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [queryPanelExpanded]);

  // The picker table's own maxHeight defaulted to SortableTable's generic
  // 360px constant, which left most of a tall viewport sitting empty below
  // the table instead of being used to show more rows at once. Recomputes
  // from the table's actual on-screen top the same way queryPanelMaxHeight
  // does above, so it grows to fill whatever vertical room the viewport
  // actually has.
  const tableRef = useRef(null);
  const [tableMaxHeight, setTableMaxHeight] = useState(480);
  useLayoutEffect(() => {
    const TABLE_BOTTOM_MARGIN = 24;
    const TABLE_MIN_HEIGHT = 360;
    let frame = null;
    function recompute() {
      frame = null;
      const el = tableRef.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top;
      setTableMaxHeight(Math.max(TABLE_MIN_HEIGHT, window.innerHeight - top - TABLE_BOTTOM_MARGIN));
    }
    function onScrollOrResize() {
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(recompute);
    }
    recompute();
    window.addEventListener("scroll", onScrollOrResize, { passive: true, capture: true });
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      window.removeEventListener("scroll", onScrollOrResize, { capture: true });
      window.removeEventListener("resize", onScrollOrResize);
      if (frame) cancelAnimationFrame(frame);
    };
    // Shared by all three levels' tables (same tableRef/tableMaxHeight) —
    // recompute whenever any of their loaded-state/row-count changes, not
    // just the ad-level ones, since switching levels swaps which table is
    // actually mounted at that ref.
  }, [level, hasLoaded, ads.length, adsetHasLoaded, adsetItems.length, campaignHasLoaded, campaignItems.length]);

  // Which lib/insightsMetrics.js catalog columns show in the picker table —
  // session-only (no persistence), same as every other piece of state on
  // this page. Changing this does NOT re-fetch on its own (same "explicit
  // Load Ads" philosophy as the date range below) since it changes which
  // Graph fields the next fetch requests.
  const [metricKeys, setMetricKeys] = useState(DEFAULT_COPY_METRIC_KEYS);
  function toggleMetric(key) {
    setMetricKeys((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }
  const sourceCurrency = adAccounts.find((a) => a.id === selectedAccountId)?.currency;

  // Post-query metric-threshold filtering (lib/copyAdsFilters.js — ported
  // from Explore's own "Filter results," see that file's header comment for
  // why it's a client-side pivot over already-fetched rows, not a re-fetch).
  // Draft/commit split so typing a threshold doesn't re-filter the table on
  // every keystroke — only "Apply Filters" (or removing a condition
  // entirely, which has no typing-jank to smooth over) actually changes what
  // the table shows.
  const [draftConditions, setDraftConditions] = useState([]);
  const [appliedConditions, setAppliedConditions] = useState([]);
  const hasPendingFilterChanges = JSON.stringify(draftConditions) !== JSON.stringify(appliedConditions);
  function addDraftCondition() {
    const numericKeys = metricKeys.filter((k) => PICKER_METRIC_CATALOG.find((m) => m.key === k)?.format !== "text");
    if (numericKeys.length === 0) return;
    setDraftConditions((prev) => [...prev, { id: newFilterId(), metricKey: numericKeys[0], operator: "gte", value: 0 }]);
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

  // Ad Set level: every ad set in the source account, reusing
  // pages/api/fb/adsets-list.js's existing ?accountId= list mode — now
  // widened to accept the same since/until/metrics params the Ad level's
  // own picker already sends (see that route's own comment), for the same
  // configurable date-range/metric-picker parity requested for all three
  // levels. No new endpoint needed for the picker itself, only for the
  // actual copy.
  // adsetItems/setAdsetItems and adsetHasLoaded/setAdsetHasLoaded declared
  // earlier, alongside hasLoadedForLevel.
  const [adsetItemsLoading, setAdsetItemsLoading] = useState(false);
  const [adsetItemsError, setAdsetItemsError] = useState(null);
  // Multi-select: several source ad sets can be copied in one batch, but
  // per the user's own resolution of this feature's one deferred question,
  // they can only ever land together in a single EXISTING destination
  // campaign — never spread across several new ones (see CopyAdsModal.js's
  // isMultiAdset handling and copy-adset.js's own validation of this).
  const [selectedAdsetIds, setSelectedAdsetIds] = useState(new Set());

  function loadAdsetsToCopy() {
    if (!selectedAccountId || !range) return;
    setAdsetItemsLoading(true);
    setAdsetItemsError(null);
    setSelectedAdsetIds(new Set());
    const params = new URLSearchParams({
      accountId: selectedAccountId,
      since: range.since,
      until: range.until,
      metrics: metricKeys.join(","),
      // Only ad sets that actually delivered in this window are worth
      // offering to copy — mirrors the Ad level's own picker, which can
      // never show a zero-spend ad in the first place.
      onlyWithSpend: "1",
    });
    fetchWithTimeout(`/api/fb/adsets-list?${params.toString()}`)
      .then(parseJsonResponse)
      .then((json) => {
        if (json.error) setAdsetItemsError(json.error);
        else setAdsetItems(json.adsets || []);
      })
      .catch((err) => setAdsetItemsError(err.message))
      .finally(() => {
        setAdsetItemsLoading(false);
        setAdsetHasLoaded(true);
      });
  }

  // Campaign level: every campaign in the source account, same reuse of an
  // existing list endpoint (campaigns-list.js's ?accountId= mode).
  // campaignItems/setCampaignItems and campaignHasLoaded/setCampaignHasLoaded
  // declared earlier, alongside hasLoadedForLevel.
  const [campaignItemsLoading, setCampaignItemsLoading] = useState(false);
  const [campaignItemsError, setCampaignItemsError] = useState(null);
  const [selectedCampaignIds, setSelectedCampaignIds] = useState(new Set());

  function loadCampaignsToCopy() {
    if (!selectedAccountId || !range) return;
    setCampaignItemsLoading(true);
    setCampaignItemsError(null);
    setSelectedCampaignIds(new Set());
    const params = new URLSearchParams({
      accountId: selectedAccountId,
      since: range.since,
      until: range.until,
      metrics: metricKeys.join(","),
      onlyWithSpend: "1",
    });
    fetchWithTimeout(`/api/fb/campaigns-list?${params.toString()}`)
      .then(parseJsonResponse)
      .then((json) => {
        if (json.error) setCampaignItemsError(json.error);
        else setCampaignItems(json.campaigns || []);
      })
      .catch((err) => setCampaignItemsError(err.message))
      .finally(() => {
        setCampaignItemsLoading(false);
        setCampaignHasLoaded(true);
      });
  }

  // Clears out any ads/selection left over from a previously loaded
  // account — doesn't itself fetch anything (that still needs an explicit
  // Load Ads click below), just prevents the table from silently going on
  // showing a different account's ads/selection once `selectedAccountId`
  // has already moved on, which would otherwise let a copy fire against a
  // mismatched source account. Declared here (after every level's own state)
  // rather than right after the ad-level state it originally only reset, so
  // every setter it calls is already in scope.
  useEffect(() => {
    // Reacting to the source account changing, not a derived-state
    // anti-pattern — clears state tied to whichever account was previously
    // selected.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAds([]);
    setSelectedIds(new Set());
    setHasLoaded(false);
    setAdsError(null);
    setAdsetItems([]);
    setSelectedAdsetIds(new Set());
    setAdsetHasLoaded(false);
    setAdsetItemsError(null);
    setCampaignItems([]);
    setSelectedCampaignIds(new Set());
    setCampaignHasLoaded(false);
    setCampaignItemsError(null);
  }, [selectedAccountId]);

  // Deliberately NOT an effect that auto-fires on every account/range
  // change — changing either here is "I'm adjusting my search," not "run
  // the (potentially slow, potentially error-prone) query right now."
  // Explicit "Load Ads" button below instead, so widening the range to
  // retry after an error is a single, controlled action.
  function loadAds() {
    if (!selectedAccountId || !range) return;
    setAdsLoading(true);
    setAdsError(null);
    setSelectedIds(new Set());
    setAds([]);
    const params = new URLSearchParams({
      accountId: selectedAccountId,
      since: range.since,
      until: range.until,
      metrics: metricKeys.join(","),
    });
    fetchSourceAdsStream(`/api/fb/copy-ads/source-ads?${params.toString()}`, (batchAds) => {
      setAds((prev) => [...prev, ...batchAds]);
    })
      .catch((err) => setAdsError(err.message))
      .finally(() => {
        setAdsLoading(false);
        setHasLoaded(true);
      });
  }

  function toggle(adId, copyable) {
    if (!copyable) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(adId)) next.delete(adId);
      else next.add(adId);
      return next;
    });
  }

  // Filtering is a view convenience over the already-loaded `ads`, not a
  // selection concept — an ad that's selected and then filtered out of view
  // stays selected (and still part of the eventual copy batch), so
  // `selectedAds` deliberately reads off the full unfiltered `ads`, not
  // `filteredAds` below.
  const selectedAds = ads.filter((a) => selectedIds.has(a.id));
  const filteredAds = applyResultFilters(ads, appliedConditions, metricKeys);

  // "Select all" only ever acts on what's currently visible (filtered) and
  // actually selectable (copyable) — same scope `toggle` already enforces
  // one row at a time. Selecting unions into `selectedIds` rather than
  // replacing it, and deselecting only removes these ids, so a previously
  // selected ad that's since been filtered out of view (see the comment on
  // `selectedAds` above) is never silently dropped by a select-all toggle.
  const selectableIds = filteredAds.filter((a) => a.copyable).map((a) => a.id);
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selectedIds.has(id));
  const someSelected = !allSelected && selectableIds.some((id) => selectedIds.has(id));
  function toggleSelectAll() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        for (const id of selectableIds) next.delete(id);
      } else {
        for (const id of selectableIds) next.add(id);
      }
      return next;
    });
  }

  const columns = [
    {
      key: "select",
      label: <SelectAllCheckbox checked={allSelected} indeterminate={someSelected} onChange={toggleSelectAll} />,
      freezeExempt: true,
      maxWidth: 32,
      render: (row) => (
        <input
          type="checkbox"
          checked={selectedIds.has(row.id)}
          disabled={!row.copyable}
          onChange={() => toggle(row.id, row.copyable)}
          title={row.copyable ? undefined : row.reason}
        />
      ),
    },
    {
      key: "name",
      label: "Ad",
      maxWidth: 260,
      render: (row) => (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }} title={row.copyable ? undefined : row.reason}>
          <Thumb
            src={row.thumbnailUrl}
            isVideo={row.isVideo}
            size={28}
            onClick={() => setLightboxItem({ id: row.id, name: row.name, thumbnailUrl: row.thumbnailUrl, isVideo: row.isVideo })}
          />
          <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
            <span style={{ fontWeight: 600, color: row.copyable ? undefined : "var(--t2)" }}>{row.name}</span>
            {!row.copyable && (
              <span className={styles.badgeWarn} style={{ width: "fit-content" }}>
                {row.reason}
              </span>
            )}
            {/* Copyable, but via a different mechanism than an ordinary ad
                (same product set, or the exact same existing post) — flagged
                up front rather than only discovered once copying starts. */}
            {row.copyable && row.kind === "catalog" && (
              <span className={styles.badgeInfo} style={{ width: "fit-content" }} title="Copies by reusing the same product set and template — the destination ad account's Business needs catalog access too.">
                Catalog ad
              </span>
            )}
            {row.copyable && row.kind === "existing_post" && (
              <span className={styles.badgeInfo} style={{ width: "fit-content" }} title="Copies by referencing the exact same existing post, not a new creative.">
                {row.isBrandedContent ? "Partnership ad — from existing post" : "From an existing post"}
              </span>
            )}
          </div>
        </div>
      ),
    },
    { key: "campaignName", label: "Campaign", maxWidth: 160, render: (row) => row.campaignName || "—" },
    { key: "adsetName", label: "Ad set", maxWidth: 140, render: (row) => row.adsetName || "—" },
    ...metricKeys
      .map((key) => PICKER_METRIC_CATALOG.find((m) => m.key === key))
      .filter(Boolean)
      .map((metric) => ({
        key: metric.key,
        label: metric.label,
        align: "right",
        maxWidth: METRIC_COLUMN_WIDTH[metric.format] || METRIC_COLUMN_WIDTH.number,
        sortValue: (row) => (typeof row[metric.key] === "number" ? row[metric.key] : -Infinity),
        render: (row) => formatMetricValue(row[metric.key], metric.format, sourceCurrency),
      })),
    {
      key: "status",
      label: "Status",
      maxWidth: 90,
      render: (row) => <span className={row.effectiveStatus === "ACTIVE" ? styles.badgeGood : styles.badgeInfo}>{row.effectiveStatus || row.status}</span>,
    },
  ];

  // Same metric-threshold filtering the Ad level's own picker already has
  // (MetricFilterBar/applyResultFilters above), reading each row's numbers
  // out of its nested `performance` object instead of the Ad level's flat
  // shape — see lib/copyAdsFilters.js's applyResultFilters for why that's a
  // `getValue` param rather than a second copy of the filtering logic.
  const filteredAdsetItems = applyResultFilters(adsetItems, appliedConditions, metricKeys, (row, key) => row.performance?.[key]);
  const filteredCampaignItems = applyResultFilters(campaignItems, appliedConditions, metricKeys, (row, key) => row.performance?.[key]);

  // Ad Set / Campaign level pickers — multi-select checkboxes, same
  // select-all pattern as the Ad level's own `columns` above. Every row
  // shown already has real spend/delivery in the chosen window (see
  // onlyWithSpend above), so — unlike the Ad level — there's no per-row
  // "copyable" eligibility to gate on here; every visible (filtered) row is
  // selectable. Select-all only acts on the currently filtered rows, same
  // "filtering is a view, not a selection change" reasoning as the Ad
  // level's own `selectedAds`/`selectableIds` above — a selected ad set that
  // a filter then hides stays selected.
  function toggleAdsetSelection(id) {
    setSelectedAdsetIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  const adsetSelectableIds = filteredAdsetItems.map((a) => a.id);
  const allAdsetsSelected = adsetSelectableIds.length > 0 && adsetSelectableIds.every((id) => selectedAdsetIds.has(id));
  const someAdsetsSelected = !allAdsetsSelected && adsetSelectableIds.some((id) => selectedAdsetIds.has(id));
  function toggleSelectAllAdsets() {
    setSelectedAdsetIds((prev) => {
      const next = new Set(prev);
      if (allAdsetsSelected) {
        for (const id of adsetSelectableIds) next.delete(id);
      } else {
        for (const id of adsetSelectableIds) next.add(id);
      }
      return next;
    });
  }
  function toggleCampaignSelection(id) {
    setSelectedCampaignIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  const campaignSelectableIds = filteredCampaignItems.map((c) => c.id);
  const allCampaignsSelected = campaignSelectableIds.length > 0 && campaignSelectableIds.every((id) => selectedCampaignIds.has(id));
  const someCampaignsSelected = !allCampaignsSelected && campaignSelectableIds.some((id) => selectedCampaignIds.has(id));
  function toggleSelectAllCampaigns() {
    setSelectedCampaignIds((prev) => {
      const next = new Set(prev);
      if (allCampaignsSelected) {
        for (const id of campaignSelectableIds) next.delete(id);
      } else {
        for (const id of campaignSelectableIds) next.add(id);
      }
      return next;
    });
  }

  const adsetColumns = [
    {
      key: "select",
      label: <SelectAllCheckbox checked={allAdsetsSelected} indeterminate={someAdsetsSelected} onChange={toggleSelectAllAdsets} />,
      freezeExempt: true,
      maxWidth: 32,
      render: (row) => <input type="checkbox" checked={selectedAdsetIds.has(row.id)} onChange={() => toggleAdsetSelection(row.id)} />,
    },
    { key: "name", label: "Ad Set", maxWidth: 240 },
    { key: "campaignName", label: "Campaign", maxWidth: 160, render: (row) => row.campaign?.name || "—", sortValue: (row) => row.campaign?.name || "" },
    {
      key: "status",
      label: "Status",
      maxWidth: 90,
      render: (row) => <span className={row.status === "ACTIVE" ? styles.badgeGood : styles.badgeInfo}>{row.status}</span>,
    },
    { key: "optimization_goal", label: "Optimization Goal", maxWidth: 170 },
    {
      key: "budget",
      label: "Budget",
      align: "right",
      maxWidth: 110,
      sortValue: (row) => row.daily_budget || row.lifetime_budget || 0,
      render: (row) =>
        row.daily_budget
          ? `${formatMetricValue(row.daily_budget / 100, "currency", sourceCurrency)}/day`
          : row.lifetime_budget
          ? `${formatMetricValue(row.lifetime_budget / 100, "currency", sourceCurrency)} lifetime`
          : "—",
    },
    ...metricKeys
      .map((key) => PICKER_METRIC_CATALOG.find((m) => m.key === key))
      .filter(Boolean)
      .map((metric) => ({
        key: metric.key,
        label: metric.label,
        align: "right",
        maxWidth: METRIC_COLUMN_WIDTH[metric.format] || METRIC_COLUMN_WIDTH.number,
        sortValue: (row) => (typeof row.performance?.[metric.key] === "number" ? row.performance[metric.key] : -Infinity),
        render: (row) => formatMetricValue(row.performance?.[metric.key], metric.format, sourceCurrency),
      })),
  ];

  const campaignColumns = [
    {
      key: "select",
      label: <SelectAllCheckbox checked={allCampaignsSelected} indeterminate={someCampaignsSelected} onChange={toggleSelectAllCampaigns} />,
      freezeExempt: true,
      maxWidth: 32,
      render: (row) => <input type="checkbox" checked={selectedCampaignIds.has(row.id)} onChange={() => toggleCampaignSelection(row.id)} />,
    },
    { key: "name", label: "Campaign", maxWidth: 260 },
    { key: "objective", label: "Objective", maxWidth: 150 },
    {
      key: "status",
      label: "Status",
      maxWidth: 90,
      render: (row) => <span className={row.effective_status === "ACTIVE" ? styles.badgeGood : styles.badgeInfo}>{row.effective_status}</span>,
    },
    {
      key: "budget",
      label: "Budget",
      align: "right",
      maxWidth: 110,
      sortValue: (row) => row.daily_budget || row.lifetime_budget || 0,
      render: (row) =>
        row.daily_budget
          ? `${formatMetricValue(row.daily_budget / 100, "currency", sourceCurrency)}/day`
          : row.lifetime_budget
          ? `${formatMetricValue(row.lifetime_budget / 100, "currency", sourceCurrency)} lifetime`
          : "No campaign-level budget (ABO)",
    },
    ...metricKeys
      .map((key) => PICKER_METRIC_CATALOG.find((m) => m.key === key))
      .filter(Boolean)
      .map((metric) => ({
        key: metric.key,
        label: metric.label,
        align: "right",
        maxWidth: METRIC_COLUMN_WIDTH[metric.format] || METRIC_COLUMN_WIDTH.number,
        sortValue: (row) => (typeof row.performance?.[metric.key] === "number" ? row.performance[metric.key] : -Infinity),
        render: (row) => formatMetricValue(row.performance?.[metric.key], metric.format, sourceCurrency),
      })),
  ];

  const adsetResultArea = (
    <>
      {adsetItemsLoading && <Loader label="Loading ad sets…" />}
      {!adsetHasLoaded && !adsetItemsLoading && (
        <CopyAdsEmptyState
          canRun={!!selectedAccountId}
          loading={adsetItemsLoading}
          onRun={loadAdsetsToCopy}
          title="Clone a whole ad set into another ad account"
          description="Load this account's ad sets, pick one, then create a matching ad set — same targeting, budget, and optimization settings — in a different ad account, with every one of its ads copied into it."
          steps={["Pick a source ad account", 'Click "Load Ad Sets"', "Select an ad set and copy it to a destination"]}
          runLabel="Load Ad Sets"
          loadingLabel="Loading…"
        />
      )}
      {adsetItemsError && <div className={styles.error}>{adsetItemsError}</div>}
      {!adsetItemsError && adsetHasLoaded && (
        <>
          <MetricFilterBar
            totalCount={adsetItems.length}
            filteredCount={filteredAdsetItems.length}
            itemLabel="ad set"
            loading={adsetItemsLoading}
            metricKeys={metricKeys}
            draftConditions={draftConditions}
            hasPendingFilterChanges={hasPendingFilterChanges}
            onAddCondition={addDraftCondition}
            onUpdateCondition={updateDraftCondition}
            onRemoveCondition={removeDraftCondition}
            onApply={applyMetricFilters}
          />
          <div ref={tableRef}>
            <SortableTable
              columns={adsetColumns}
              rows={filteredAdsetItems}
              defaultSortKey="name"
              defaultSortDir="asc"
              searchable
              searchKeys={["name"]}
              emptyMessage={appliedConditions.length > 0 ? "No ad sets match the current filters." : "No ad sets found in this account."}
              fixedColumnWidths
              maxHeight={tableMaxHeight}
            />
          </div>
        </>
      )}
    </>
  );

  const campaignResultArea = (
    <>
      {campaignItemsLoading && <Loader label="Loading campaigns…" />}
      {!campaignHasLoaded && !campaignItemsLoading && (
        <CopyAdsEmptyState
          canRun={!!selectedAccountId}
          loading={campaignItemsLoading}
          onRun={loadCampaignsToCopy}
          title="Clone a whole campaign into another ad account"
          description="Load this account's campaigns, pick one, then create a matching campaign — plus every one of its ad sets, with matching settings — in a different ad account, with every ad copied into its new ad set."
          steps={["Pick a source ad account", 'Click "Load Campaigns"', "Select a campaign and copy it to a destination"]}
          runLabel="Load Campaigns"
          loadingLabel="Loading…"
        />
      )}
      {campaignItemsError && <div className={styles.error}>{campaignItemsError}</div>}
      {!campaignItemsError && campaignHasLoaded && (
        <>
          <MetricFilterBar
            totalCount={campaignItems.length}
            filteredCount={filteredCampaignItems.length}
            itemLabel="campaign"
            loading={campaignItemsLoading}
            metricKeys={metricKeys}
            draftConditions={draftConditions}
            hasPendingFilterChanges={hasPendingFilterChanges}
            onAddCondition={addDraftCondition}
            onUpdateCondition={updateDraftCondition}
            onRemoveCondition={removeDraftCondition}
            onApply={applyMetricFilters}
          />
          <div ref={tableRef}>
            <SortableTable
              columns={campaignColumns}
              rows={filteredCampaignItems}
              defaultSortKey="name"
              defaultSortDir="asc"
              searchable
              searchKeys={["name"]}
              emptyMessage={appliedConditions.length > 0 ? "No campaigns match the current filters." : "No campaigns found in this account."}
              fixedColumnWidths
              maxHeight={tableMaxHeight}
            />
          </div>
        </>
      )}
    </>
  );

  // Everything downstream of "how to fetch" — shown in the content area on
  // both sides of the collapsible panel below (side-by-side with it when
  // expanded, full-width under the collapsed-panel summary row otherwise) —
  // kept as one value, same convention as Explore's own resultArea, so
  // there's exactly one copy of this block to keep in sync.
  const resultArea = (
    <>
      {adsLoading && ads.length === 0 && <Loader label="Loading ads…" />}
      {!hasLoaded && !adsLoading && (
        <CopyAdsEmptyState canRun={!!selectedAccountId && !!range} loading={adsLoading} onRun={loadAds} />
      )}
      {adsLoading && ads.length > 0 && <p className={styles.sub}>Loading more ads… ({ads.length} so far)</p>}
      {adsError && (
        <div className={styles.error}>
          {adsError}
          {adsError.toLowerCase().includes("reduce the amount of data") && " — try a narrower date range above, then Reload Ads."}
        </div>
      )}

      {!adsError && (hasLoaded || ads.length > 0) && (
        <>
          <MetricFilterBar
            totalCount={ads.length}
            filteredCount={filteredAds.length}
            itemLabel="ad"
            loading={adsLoading}
            metricKeys={metricKeys}
            draftConditions={draftConditions}
            hasPendingFilterChanges={hasPendingFilterChanges}
            onAddCondition={addDraftCondition}
            onUpdateCondition={updateDraftCondition}
            onRemoveCondition={removeDraftCondition}
            onApply={applyMetricFilters}
          />

          <div ref={tableRef}>
            <SortableTable
              columns={columns}
              rows={filteredAds}
              defaultSortKey="name"
              defaultSortDir="asc"
              searchable
              searchKeys={["name", "campaignName", "adsetName"]}
              emptyMessage={appliedConditions.length > 0 ? "No ads match the current filters." : "No ads found in this account."}
              fixedColumnWidths
              maxHeight={tableMaxHeight}
            />
          </div>
        </>
      )}
    </>
  );

  const sourceAccountName = adAccounts.find((a) => a.id === selectedAccountId)?.name;

  // Level-generalized versions of the handful of things that differ between
  // the three pickers — everything else (the collapsible panel shell,
  // sticky-height recompute, source account picker, Load/Reload button
  // itself) is shared verbatim across all three.
  const activeResultArea = level === "ad" ? resultArea : level === "adset" ? adsetResultArea : campaignResultArea;
  const loadingForLevel = level === "ad" ? adsLoading : level === "adset" ? adsetItemsLoading : campaignItemsLoading;
  const canRunLoadForLevel = !!selectedAccountId && !!range;
  const runLoadForLevel = level === "ad" ? loadAds : level === "adset" ? loadAdsetsToCopy : loadCampaignsToCopy;
  const loadButtonLabel = level === "ad" ? "Ads" : level === "adset" ? "Ad Sets" : "Campaigns";
  const selectedAdsets = adsetItems.filter((a) => selectedAdsetIds.has(a.id));
  const selectedCampaigns = campaignItems.filter((c) => selectedCampaignIds.has(c.id));
  const selectionCount = level === "ad" ? selectedAds.length : level === "adset" ? selectedAdsetIds.size : selectedCampaignIds.size;
  const selectionLabel = level === "ad" ? "ad" : level === "adset" ? "ad set" : "campaign";

  return (
    <Layout>
      <Head>
        <title>Copy Ads · Facebook Auth Dashboard</title>
      </Head>
      <div className={styles.page}>
        <main className={styles.main} style={{ maxWidth: queryPanelExpanded ? 1800 : 1600, margin: "0 auto" }}>
          <h1 className={styles.h1}>Copy Ads Across Accounts</h1>
          <p className={styles.sub} style={{ marginTop: -8, marginBottom: 14 }}>
            {level === "ad" &&
              "Select ads running in one ad account and copy their creative into an ad set that already exists in a different ad account — the same Page, no retargeting needed."}
            {level === "adset" &&
              "Pick one ad set and create a matching one — same targeting, budget, and settings — in a different ad account, with every one of its ads copied into it."}
            {level === "campaign" &&
              "Pick one campaign and create a matching one, plus every one of its ad sets, in a different ad account, with every ad copied into its new ad set."}
          </p>

          <div className={styles.tabGroup} style={{ marginBottom: 20, width: "fit-content" }}>
            {[
              { key: "ad", label: "Ad" },
              { key: "adset", label: "Ad Set" },
              { key: "campaign", label: "Campaign" },
            ].map((l) => (
              <button
                key={l.key}
                type="button"
                className={level === l.key ? `${styles.tab} ${styles.tabActive}` : styles.tab}
                onClick={() => setLevel(l.key)}
              >
                {l.label}
              </button>
            ))}
          </div>

          {accountsError && <div className={styles.error}>Error loading ad accounts: {accountsError}</div>}

          {queryPanelExpanded ? (
            <div className={styles.exploreLayout}>
              <div className={styles.exploreContent}>{activeResultArea}</div>

              <aside
                ref={queryPanelRef}
                className={styles.exploreQueryPanel}
                style={queryPanelMaxHeight ? { maxHeight: queryPanelMaxHeight } : undefined}
              >
                <div className={`${styles.card} ${styles.exploreQueryCard}`}>
                  <div className={styles.exploreQueryHeader}>
                    <span style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, fontSize: 13 }}>
                      <SettingsIcon size={15} />
                      Source &amp; Metrics
                    </span>
                    {/* No collapse control until something's loaded at least once —
                        collapsing here would leave the page with nothing on it at all. */}
                    {hasLoadedForLevel && (
                      <button
                        type="button"
                        className={styles.appSidebarIconBtn}
                        onClick={toggleQueryPanel}
                        title="Collapse — focus on the result"
                      >
                        <ChevronIcon direction="right" size={15} />
                      </button>
                    )}
                  </div>

                  <div className={styles.exploreQueryBody}>
                    <div>
                      <p className={styles.sub} style={{ marginBottom: 6 }}>
                        Source ad account
                      </p>
                      <AccountSelect accounts={adAccounts} value={selectedAccountId} onChange={setSelectedAccountId} placeholder="Select an ad account…" style={{ width: "100%" }} loading={accountsLoading} />
                    </div>

                    <div>
                      <p
                        className={styles.sub}
                        style={{ marginBottom: 6 }}
                        title={
                          level === "ad"
                            ? "Only ads with real delivery (spend/impressions) in this window show up — there's no way to list ads by recency any other way on this API. A just-launched ad with no spend yet won't appear until it has some."
                            : `Every ${level === "adset" ? "ad set" : "campaign"} in this account shows up regardless of delivery — this only scopes the performance numbers shown alongside each one.`
                        }
                      >
                        {level === "ad" ? "Only show ads with spend in" : `Show performance from`}
                      </p>
                      <DateRangeMenu
                        timeZone={sourceTimeZone}
                        rangePreset={rangePreset}
                        customSince={customSince}
                        customUntil={customUntil}
                        maxRangeDays={MAX_RANGE_DAYS}
                        compareToPrevious={false}
                        compareCustomSince=""
                        compareDisplay="change"
                        compareDisabled
                        compareDisabledReason="Not available for Copy Ads — there's no comparison view here, just the ads active in this window."
                        onApply={(patch) => {
                          setRangePreset(patch.rangePreset);
                          setCustomSince(patch.customSince);
                          setCustomUntil(patch.customUntil);
                        }}
                      />
                    </div>

                    <div>
                      <p className={styles.sub} style={{ marginBottom: 10 }}>
                        Metrics to show — changes take effect next time you Load {loadButtonLabel}.
                      </p>
                      <MetricPicker catalog={PICKER_METRIC_CATALOG} selectedKeys={metricKeys} onToggle={toggleMetric} />
                    </div>
                  </div>

                  <div className={styles.exploreQueryFooter}>
                    <button
                      type="button"
                      className={styles.btnPrimary}
                      onClick={runLoadForLevel}
                      disabled={!canRunLoadForLevel || loadingForLevel}
                      style={{ width: "100%" }}
                    >
                      {loadingForLevel ? "Loading…" : hasLoadedForLevel ? `Reload ${loadButtonLabel}` : `Load ${loadButtonLabel}`}
                    </button>
                  </div>
                </div>
              </aside>
            </div>
          ) : (
            <div className={styles.exploreContent}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 10,
                  flexWrap: "wrap",
                  marginBottom: 14,
                }}
              >
                <p className={styles.sub} style={{ margin: 0 }}>
                  {level === "ad"
                    ? summarizeCopyAdsQuery(sourceAccountName, rangePreset, metricKeys.length)
                    : `${sourceAccountName || "No account selected"} · ${level === "adset" ? adsetItems.length : campaignItems.length} ${level === "adset" ? "ad set" : "campaign"}${(level === "adset" ? adsetItems.length : campaignItems.length) === 1 ? "" : "s"}`}
                </p>
                <button type="button" className={styles.btnSecondary} onClick={toggleQueryPanel} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <SettingsIcon size={13} />
                  Edit Query
                  <ChevronIcon direction="left" size={12} />
                </button>
              </div>
              {activeResultArea}
            </div>
          )}
        </main>
      </div>

      <SelectionBar
        count={selectionCount}
        label={selectionLabel}
        onClear={() => {
          if (level === "ad") setSelectedIds(new Set());
          else if (level === "adset") setSelectedAdsetIds(new Set());
          else setSelectedCampaignIds(new Set());
        }}
        onCopy={() => setModalOpen(true)}
      />

      {modalOpen && level === "ad" && (
        <CopyAdsModal
          level="ad"
          sourceAccountId={selectedAccountId}
          ads={selectedAds}
          adAccounts={adAccounts}
          onClose={() => setModalOpen(false)}
          onDone={(result) => {
            if (result?.createdAdIds?.length) {
              setSelectedIds((prev) => {
                const next = new Set(prev);
                for (const id of selectedAds.map((a) => a.id)) next.delete(id);
                return next;
              });
            }
          }}
        />
      )}

      {/* No `selectedAdsetIds.size > 0`/selectedCampaignIds.size > 0 gate here
          (unlike this condition's own single-select predecessor) — onDone
          below clears that same selection on success, in the same render as
          CopyAdsModal's own setStep("done"), so gating on it here would
          unmount the modal the instant it succeeds, before its "done" screen
          ever has a chance to render (caught live in this round's own
          mocked-preview verification). CopyAdsModal already captures
          sourceAdsets/sourceCampaigns once via its own useState on mount
          (see that file's own comment), so it keeps showing the right ad
          sets/campaigns even once the parent's own selection — and the
          `selectedAdsets`/`selectedCampaigns` arrays derived from it below —
          goes back to empty. */}
      {modalOpen && level === "adset" && (
        <CopyAdsModal
          level="adset"
          sourceAccountId={selectedAccountId}
          sourceAdsets={selectedAdsets.map((a) => ({ id: a.id, name: a.name }))}
          adAccounts={adAccounts}
          onClose={() => setModalOpen(false)}
          onDone={(result) => {
            if (result?.createdAdsetIds?.length) setSelectedAdsetIds(new Set());
          }}
        />
      )}

      {modalOpen && level === "campaign" && (
        <CopyAdsModal
          level="campaign"
          sourceAccountId={selectedAccountId}
          sourceCampaigns={selectedCampaigns.map((c) => ({ id: c.id, name: c.name }))}
          adAccounts={adAccounts}
          onClose={() => setModalOpen(false)}
          onDone={(result) => {
            if (result?.success) setSelectedCampaignIds(new Set());
          }}
        />
      )}

      <CreativeLightbox item={lightboxItem} onClose={() => setLightboxItem(null)} />
    </Layout>
  );
}

export async function getServerSideProps(context) {
  const session = await getServerSession(context.req, context.res, authOptions);

  if (!session) {
    return { redirect: { destination: "/", permanent: false } };
  }

  return { props: {} };
}
