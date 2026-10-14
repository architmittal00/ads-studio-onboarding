import Head from "next/head";
import { getServerSession } from "next-auth/next";
import { useEffect, useMemo, useRef, useState } from "react";
import { authOptions } from "./api/auth/[...nextauth]";
import Layout from "@/components/Layout";
import Loader from "@/components/Loader";
import CacheStatus from "@/components/CacheStatus";
import AccountSelect from "@/components/AccountSelect";
import FilterDropdown from "@/components/FilterDropdown";
import InvestigateDrawer from "@/components/InvestigateDrawer";
import { CloseIcon, HistoryIcon, SettingsIcon, ChevronIcon } from "@/components/icons";
import { useAccounts } from "@/components/AccountProvider";
import { getCachedEntry, setCachedEntry } from "@/lib/clientCache";
import {
  getRecentChangesViews,
  setRecentChangesViews,
  getRecentChangesQueryPanelCollapsed,
  setRecentChangesQueryPanelCollapsed,
} from "@/lib/clientStorage";
import { describeChangeDetail } from "@/lib/activityChangeDetail";
import { MAX_IMPACT_CHANGES, IMPACT_BATCH_SIZE } from "@/lib/recentChangesImpact";
import { groupColor, newGroupId, pickNextGroupColor, moveViewNextToGroup, GROUP_COLORS } from "@/lib/tabGroups";
import styles from "@/styles/Home.module.css";

const CACHE_PREFIX = "recent-changes:";
const RECENT_CHANGES_CACHE_MAX_ENTRIES = 50;
const HOURS_PRESETS = [
  { value: 24, label: "Last 24 Hours" },
  { value: 72, label: "Last 72 Hours" },
  { value: 168, label: "Last 7 Days" },
  { value: 720, label: "Last 30 Days" },
];
const MAX_VIEWS = 15;

function newViewId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `v${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

// Compact up/down signal for one metric — a single scannable chip (e.g.
// "Spend ▲73%"), reusing the existing badgeGood/badgeDanger pill treatment.
// The full before/after numbers live in the Investigate drawer instead of
// cluttering every row.
function QuickSignal({ label, before, after }) {
  if (typeof before !== "number" || typeof after !== "number") return null;
  if (before === 0 && after === 0) return null;
  const pct = before !== 0 ? ((after - before) / Math.abs(before)) * 100 : 100;
  const badgeClass = pct > 0 ? styles.badgeGood : pct < 0 ? styles.badgeDanger : styles.badgeInfo;
  const arrow = pct > 0 ? "▲" : pct < 0 ? "▼" : "";
  return (
    <span className={badgeClass}>
      {label} {arrow} {Math.abs(pct).toFixed(0)}%
    </span>
  );
}

const CATEGORY_BADGE = {
  budget: "badgeWarn",
  status: "badgeInfo",
  created: "badgeGood",
  name: "badgeInfo",
  other: "badgeInfo",
};

function relativeTime(iso) {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.round(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

// One independent tab: its own accounts, time window and filters, plus its
// own fetched result/loading/error — switching tabs never touches another
// tab's state. Mirrors pages/explore.js's createBlankView exactly.
function createBlankView(seedAccountId = "") {
  return {
    id: newViewId(),
    // A user-chosen tab name, overriding the auto-derived account title below
    // — null until they rename it (double-click the tab).
    customTitle: null,
    accountIds: seedAccountId ? [seedAccountId] : [],
    hours: 72,
    // Post-fetch pivot filters, applied instantly client-side to whatever's
    // already in `result` — `null` means "no filter" (everything shown),
    // same convention as pages/explore.js's own resultFilters.statusValues.
    filters: { categories: null, actors: null },
    result: null,
    resultFetchedAt: null,
    loading: false,
    error: null,
    // Which tab group (if any) this tab belongs to — see `groups` state
    // below and lib/tabGroups.js. Null means ungrouped. Mirrors
    // pages/explore.js's own `groupId` field exactly.
    groupId: null,
  };
}

// Keeps at most MAX_VIEWS tabs, evicting the oldest one that isn't the
// currently active tab — copied from pages/explore.js's withCapApplied.
function withCapApplied(viewsList, protectedId) {
  if (viewsList.length < MAX_VIEWS) return viewsList;
  const evictIdx = viewsList[0].id === protectedId ? 1 : 0;
  return viewsList.filter((_, i) => i !== evictIdx);
}

function viewTitle(view, adAccounts, fallbackIndex) {
  if (view.customTitle) return view.customTitle;
  const names = view.accountIds.map((id) => adAccounts.find((a) => a.id === id)?.name).filter(Boolean);
  if (names.length === 0) return `View ${fallbackIndex + 1}`;
  if (names.length === 1) return names[0];
  return `${names[0]} +${names.length - 1} more`;
}

// One-line recap shown in place of the accounts/time-window panel while it's
// collapsed — mirrors pages/explore.js's own summarizeQuery.
function summarizeView(view, adAccounts) {
  const accountNames = view.accountIds.map((id) => adAccounts.find((a) => a.id === id)?.name).filter(Boolean);
  const accountLabel =
    accountNames.length === 0 ? "No account selected" : accountNames.length === 1 ? accountNames[0] : `${accountNames.length} accounts`;
  const hoursLabel = HOURS_PRESETS.find((p) => p.value === view.hours)?.label || `${view.hours}h`;
  return `${accountLabel} · ${hoursLabel}`;
}

// Shown before a tab has ever been run — mirrors pages/explore.js's own
// ExploreEmptyState, reusing the same CSS classes (generic empty-state
// layout, not Explore-specific).
function RecentChangesEmptyState({ canRun, onRun, loading }) {
  return (
    <section className={styles.card}>
      <div className={styles.exploreEmptyState}>
        <div className={styles.exploreEmptyIcon}>
          <HistoryIcon size={26} />
        </div>
        <div>
          <h2 className={styles.h2} style={{ marginBottom: 6 }}>
            See what changed recently
          </h2>
          <p className={styles.sub}>
            Pick accounts and a time window in the panel on the right, then check for changes to see them here.
          </p>
        </div>
        <div className={styles.exploreEmptySteps}>
          {["Pick one or more accounts", "Choose a time window", 'Click "Check Recent Changes"'].map((step, i) => (
            <div key={step} className={styles.exploreEmptyStep}>
              <span className={styles.exploreEmptyStepNum}>{i + 1}</span>
              {step}
            </div>
          ))}
        </div>
        <button type="button" className={styles.btnPrimary} disabled={!canRun || loading} onClick={onRun}>
          {loading ? "Checking…" : "Check Recent Changes"}
        </button>
      </div>
    </section>
  );
}

export default function RecentChanges() {
  const { adAccounts, accountsError, selectedAccountId } = useAccounts();

  const [views, setViews] = useState(() => [createBlankView("")]);
  const [activeViewId, setActiveViewId] = useState(() => views[0].id);
  const activeView = views.find((v) => v.id === activeViewId) || views[0];

  // Tab groups — mirrors pages/explore.js's own exactly (see lib/tabGroups.js
  // for the shared color palette / id / reordering helpers): a named,
  // colored cluster of adjacent tabs. Membership lives on each view's own
  // `groupId`, not here.
  const [groups, setGroups] = useState([]);

  // Which tab (if any) is currently showing its rename text input in place of
  // its label — at most one at a time, cleared on commit/cancel/blur.
  const [renamingViewId, setRenamingViewId] = useState(null);
  const [renameDraft, setRenameDraft] = useState("");

  // The tab being right-clicked (for "Add to group" / "Remove from group")
  // or the group chip being clicked (for rename/color/collapse/ungroup/
  // close) — at most one open menu at a time, closed on an outside click or
  // Escape. Same convention as pages/explore.js.
  const [tabMenu, setTabMenu] = useState(null); // { type: "tab" | "group", id, x, y }
  const [groupRenameDraft, setGroupRenameDraft] = useState("");

  useEffect(() => {
    if (!tabMenu) return;
    function closeMenu() {
      setTabMenu(null);
    }
    function closeOnEscape(e) {
      if (e.key === "Escape") closeMenu();
    }
    window.addEventListener("click", closeMenu);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [tabMenu]);

  const [investigatingChange, setInvestigatingChange] = useState(null);

  // Collapsed by default (per-device, like Explore's own panel) so a tab
  // with results already loaded doesn't keep the accounts/time-window panel
  // permanently in the way — see `queryPanelExpanded` below for the one
  // exception (a tab with nothing fetched yet forces this open).
  const [queryPanelCollapsed, setQueryPanelCollapsedState] = useState(true);
  useEffect(() => {
    const saved = getRecentChangesQueryPanelCollapsed();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time read of a per-device localStorage preference on mount, not derivable from props/state
    if (saved != null) setQueryPanelCollapsedState(saved);
  }, []);
  function toggleQueryPanel() {
    setQueryPanelCollapsedState((prev) => {
      const next = !prev;
      setRecentChangesQueryPanelCollapsed(next);
      return next;
    });
  }

  function startRenaming(view, fallbackIndex) {
    setRenamingViewId(view.id);
    setRenameDraft(view.customTitle || viewTitle(view, adAccounts, fallbackIndex));
  }
  function commitRename() {
    if (renamingViewId) updateView(renamingViewId, { customTitle: renameDraft.trim() || null });
    setRenamingViewId(null);
  }
  function cancelRename() {
    setRenamingViewId(null);
  }

  const hasSeededInitialAccountRef = useRef(false);
  const hasRestoredRef = useRef(false);

  // One-time restore of previously-open tabs from localStorage — replaces
  // the single deterministic blank tab wholesale. Pre-populates each
  // restored tab's result from the shared query cache when still fresh, so
  // reopening the page shows the same data instead of blank tabs.
  useEffect(() => {
    if (hasRestoredRef.current) return;
    hasRestoredRef.current = true;
    const persisted = getRecentChangesViews();
    if (!persisted?.views?.length) return;

    const hydrated = persisted.views.map((v) => {
      const accountIds = v.accountIds || [];
      const filters = v.filters || { categories: null, actors: null };
      const cached =
        accountIds.length > 0
          ? getCachedEntry(CACHE_PREFIX + JSON.stringify({ accountIds: [...accountIds].sort(), hours: v.hours }))
          : null;
      return {
        ...v,
        accountIds,
        filters,
        groupId: v.groupId ?? null,
        result: cached?.data ?? null,
        resultFetchedAt: cached?.fetchedAt ?? null,
        loading: false,
        error: null,
      };
    });
    // Only a group some restored view still actually points at survives —
    // otherwise every tab ever grouped, then closed, across every session
    // would pile up here forever. Mirrors pages/explore.js's own restore.
    const liveGroupIds = new Set(hydrated.map((v) => v.groupId).filter(Boolean));
    const restoredGroups = (persisted.groups || []).filter((g) => liveGroupIds.has(g.id));
    // One-time hydration from localStorage on mount, not derived state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setViews(hydrated);
    setActiveViewId(hydrated.some((v) => v.id === persisted.activeViewId) ? persisted.activeViewId : hydrated[0].id);
    setGroups(restoredGroups);
  }, []);

  // Seeds only the very first tab's account from the shared selector, once it
  // resolves — a no-op if the restore effect above already filled in a real
  // accountId. Every other tab gets its account at creation time.
  useEffect(() => {
    if (hasSeededInitialAccountRef.current || !selectedAccountId) return;
    hasSeededInitialAccountRef.current = true;
    // One-time seed of the first tab's account once the shared selector
    // resolves, not derived state.
    setViews((prev) => prev.map((v, i) => (i === 0 && v.accountIds.length === 0 ? { ...v, accountIds: [selectedAccountId] } : v)));
  }, [selectedAccountId]);

  // A group with no member tab left (its last tab closed, ungrouped, or
  // evicted by withCapApplied) is dropped here — derived on every render
  // instead of pruned reactively in an effect (see pages/explore.js's own
  // identical comment for why: a useEffect calling setGroups off `views`
  // trips the react-hooks/set-state-in-effect lint rule), so nothing ever
  // displays or persists an invisible, empty group entry.
  const liveGroups = useMemo(() => groups.filter((g) => views.some((v) => v.groupId === g.id)), [groups, views]);

  // Persists the open tabs' query specs (never their fetched results, which
  // are ephemeral and re-derived from the cache on restore) and the tab
  // groups whenever either changes — a plain sync-to-external-system effect,
  // not a state update.
  useEffect(() => {
    setRecentChangesViews({
      activeViewId,
      views: views.map(({ result, resultFetchedAt, loading, error, ...spec }) => spec),
      groups: liveGroups,
    });
  }, [views, activeViewId, liveGroups]);

  function updateView(id, patch) {
    setViews((prev) => prev.map((v) => (v.id === id ? { ...v, ...(typeof patch === "function" ? patch(v) : patch) } : v)));
  }

  function updateActive(patch) {
    updateView(activeViewId, patch);
  }

  // `activeView` above falls back to `views[0]` whenever `activeViewId`
  // doesn't match any current tab, which keeps the page from crashing but
  // only papers over the real problem: `updateActive` (every filter toggle,
  // account change, time-window change) still writes to the now-missing id
  // and silently no-ops, while the screen keeps showing `views[0]` — the tab
  // bar and the actually-active tab drift apart, so a tab can look selected
  // yet refuse to respond to anything. Re-pointing `activeViewId` at a real
  // tab the moment that happens keeps both in sync instead of leaving a
  // dangling reference around for an unrelated click to land on.
  useEffect(() => {
    if (views.length > 0 && !views.some((v) => v.id === activeViewId)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- correcting a derived id that fell out of sync with the tabs it's supposed to reference, not state owned by this render
      setActiveViewId(views[0].id);
    }
  }, [views, activeViewId]);

  // Changing which accounts or time window a tab queries must also drop
  // whatever it last fetched — otherwise the account/time-window panel (and
  // any tab label derived from it) shows the new selection while the list
  // below keeps displaying changes from the *previous* one, with nothing on
  // screen indicating they no longer match. Reverting to the empty state
  // forces a fresh "Check Recent Changes" before anything is shown again.
  function updateQuerySpec(patch) {
    updateActive({ ...patch, result: null, resultFetchedAt: null, error: null });
  }

  // Fetches performance-impact (Spend/Purchases/ROAS before vs. after) for
  // the changes pages/api/fb/recent-changes.js flagged as eligible, in small
  // concurrent batches via pages/api/fb/recent-changes/impact.js, instead of
  // one request covering every eligible change — the list has already
  // rendered by the time this runs, so each batch that comes back just fills
  // in that many rows' quick-signal badges in place, rather than the whole
  // page waiting on every change's impact before showing anything.
  // `initialResult` is the exact object this view's `result` was just set
  // to, so the final cache write (once every batch has settled) can build
  // off it directly instead of re-reading possibly-stale React state.
  function fetchImpactProgressively(viewId, cacheKey, initialResult) {
    const pending = initialResult.changes.filter((c) => c.eventTime && !c.tooRecent && !c.impactCapped);
    if (pending.length === 0) {
      setCachedEntry(cacheKey, initialResult, { prefix: CACHE_PREFIX, maxEntriesForPrefix: RECENT_CHANGES_CACHE_MAX_ENTRIES });
      return;
    }

    const chunks = [];
    for (let i = 0; i < pending.length; i += IMPACT_BATCH_SIZE) chunks.push(pending.slice(i, i + IMPACT_BATCH_SIZE));

    const impactById = {};
    let remaining = chunks.length;

    function applyBatch(batchImpact) {
      Object.assign(impactById, batchImpact);
      updateView(viewId, (v) => {
        if (!v.result) return {};
        return {
          result: { ...v.result, changes: v.result.changes.map((c) => (c.id in batchImpact ? { ...c, impact: batchImpact[c.id] } : c)) },
        };
      });
      remaining -= 1;
      if (remaining === 0) {
        const finalChanges = initialResult.changes.map((c) => (c.id in impactById ? { ...c, impact: impactById[c.id] } : c));
        setCachedEntry(
          cacheKey,
          { ...initialResult, changes: finalChanges },
          { prefix: CACHE_PREFIX, maxEntriesForPrefix: RECENT_CHANGES_CACHE_MAX_ENTRIES }
        );
      }
    }

    chunks.forEach((chunk) => {
      // A batch that fails outright (network error, a non-OK response, a
      // timed-out serverless function returning something res.json() can't
      // parse) used to call applyBatch({}) — an empty map that leaves every
      // change in the chunk without a `c.impact` entry at all. Since the row
      // only shows "Loading impact…" while `c.impact` is still `undefined`,
      // that left the spinner spinning forever with no way to tell it had
      // actually failed. Falling back to an explicit `null` per change marks
      // it as "tried, couldn't measure" instead, which the row below renders
      // as "Impact unavailable" — still resolved, just not successfully.
      const explicitFailure = Object.fromEntries(chunk.map((c) => [c.id, null]));
      fetch("/api/fb/recent-changes/impact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ changes: chunk.map((c) => ({ id: c.id, objectId: c.objectId, eventTime: c.eventTime })) }),
      })
        .then((res) => res.json())
        .then((json) => applyBatch(json.impact || explicitFailure))
        .catch(() => applyBatch(explicitFailure));
    });
  }

  function runQueryForView(view, force) {
    if (view.accountIds.length === 0) return;
    const sortedIds = [...view.accountIds].sort();
    const cacheKey = CACHE_PREFIX + JSON.stringify({ accountIds: sortedIds, hours: view.hours });

    if (!force) {
      const cached = getCachedEntry(cacheKey);
      if (cached) {
        updateView(view.id, { result: cached.data, resultFetchedAt: cached.fetchedAt, error: null });
        return;
      }
    }

    updateView(view.id, { loading: true, error: null });
    fetch(`/api/fb/recent-changes?accountIds=${sortedIds.join(",")}&hours=${view.hours}`)
      .then((res) => res.json())
      .then((json) => {
        if (json.error) {
          updateView(view.id, { error: json.error });
          return;
        }
        // Shows the list immediately — impact badges are fetched and merged
        // in afterward, progressively, by fetchImpactProgressively below.
        updateView(view.id, { result: json, resultFetchedAt: Date.now(), error: null });
        fetchImpactProgressively(view.id, cacheKey, json);
      })
      .catch((err) => updateView(view.id, { error: err.message }))
      .finally(() => updateView(view.id, { loading: false }));
  }

  function addBlankView() {
    const blank = createBlankView(selectedAccountId);
    setViews((prev) => [...withCapApplied(prev, activeViewId), blank]);
    setActiveViewId(blank.id);
  }

  function closeView(id) {
    // Reads `prev` from the setState updater rather than the `views` closure
    // above — closing two tabs in quick succession (e.g. a fast double
    // click) can otherwise run both closures against the same pre-close
    // `views` snapshot, each computing `next`/`idx` as if the other close
    // hadn't happened yet.
    setViews((prev) => {
      if (prev.length <= 1) return prev;
      const idx = prev.findIndex((v) => v.id === id);
      if (idx === -1) return prev;
      const next = prev.filter((v) => v.id !== id);
      if (id === activeViewId) setActiveViewId(next[Math.max(0, idx - 1)].id);
      return next;
    });
  }

  // Tab groups mirror Chrome's own model, exactly as pages/explore.js's own
  // — see lib/tabGroups.js for the shared color palette / id / reordering
  // helpers. Grouping a tab always moves it next to its new group's other
  // members so a group's tabs stay contiguous on screen (the rendering walk
  // below assumes exactly one contiguous run per group id).
  function createGroupFromView(viewId) {
    const id = newGroupId();
    const color = pickNextGroupColor(liveGroups);
    setGroups((prev) => [...prev, { id, name: "New group", color, collapsed: false }]);
    setViews((prev) => moveViewNextToGroup(prev, viewId, id).map((v) => (v.id === viewId ? { ...v, groupId: id } : v)));
    setTabMenu(null);
  }

  function addViewToGroup(viewId, groupId) {
    setViews((prev) => moveViewNextToGroup(prev, viewId, groupId).map((v) => (v.id === viewId ? { ...v, groupId } : v)));
    setTabMenu(null);
  }

  function removeViewFromGroup(viewId) {
    setViews((prev) => prev.map((v) => (v.id === viewId ? { ...v, groupId: null } : v)));
    setTabMenu(null);
  }

  function commitGroupRename(groupId, name) {
    setGroups((prev) => prev.map((g) => (g.id === groupId ? { ...g, name: name.trim() || g.name } : g)));
  }

  function recolorGroup(groupId, color) {
    setGroups((prev) => prev.map((g) => (g.id === groupId ? { ...g, color } : g)));
  }

  function toggleGroupCollapsed(groupId) {
    setGroups((prev) => prev.map((g) => (g.id === groupId ? { ...g, collapsed: !g.collapsed } : g)));
  }

  function ungroup(groupId) {
    setViews((prev) => prev.map((v) => (v.groupId === groupId ? { ...v, groupId: null } : v)));
    setTabMenu(null);
  }

  // Closes every tab in a group at once (Chrome's own "Close group") —
  // refuses if that would close every open tab, same guard as closeView
  // (and the same setState-updater safety reasoning).
  function closeGroup(groupId) {
    setViews((prev) => {
      const memberIds = new Set(prev.filter((v) => v.groupId === groupId).map((v) => v.id));
      const next = prev.filter((v) => !memberIds.has(v.id));
      if (next.length === 0) return prev;
      if (memberIds.has(activeViewId)) setActiveViewId(next[0].id);
      return next;
    });
    setTabMenu(null);
  }

  const accountName = (id) => adAccounts.find((a) => a.id === id)?.name || id;
  const currencyByAccountId = useMemo(() => new Map(adAccounts.map((a) => [a.id, a.currency])), [adAccounts]);

  const runnable = activeView.accountIds.length > 0;
  const result = activeView.result;

  const availableCategories = useMemo(() => {
    if (!result) return [];
    const map = new Map();
    for (const c of result.changes) {
      if (!map.has(c.category)) map.set(c.category, c.categoryLabel);
    }
    return [...map.entries()].map(([key, label]) => ({ key, label }));
  }, [result]);

  const availableActors = useMemo(() => {
    if (!result) return [];
    return [...new Set(result.changes.map((c) => c.actorName))].sort();
  }, [result]);

  function toggleCategoryFilter(key) {
    updateActive((v) => {
      const current = v.filters.categories ?? availableCategories.map((c) => c.key);
      const next = current.includes(key) ? current.filter((k) => k !== key) : [...current, key];
      const allChecked = availableCategories.length > 0 && availableCategories.every((c) => next.includes(c.key));
      return { filters: { ...v.filters, categories: allChecked ? null : next } };
    });
  }

  function toggleActorFilter(name) {
    updateActive((v) => {
      const current = v.filters.actors ?? availableActors;
      const next = current.includes(name) ? current.filter((a) => a !== name) : [...current, name];
      const allChecked = availableActors.length > 0 && availableActors.every((a) => next.includes(a));
      return { filters: { ...v.filters, actors: allChecked ? null : next } };
    });
  }

  const filteredChanges = useMemo(() => {
    if (!result) return [];
    return result.changes.filter((c) => {
      if (activeView.filters.categories && !activeView.filters.categories.includes(c.category)) return false;
      if (activeView.filters.actors && !activeView.filters.actors.includes(c.actorName)) return false;
      return true;
    });
  }, [result, activeView.filters]);

  // The collapsed preference only ever applies once there's a result to show
  // instead — a brand-new (or still-loading-for-the-first-time) tab has
  // nothing else on screen, so the accounts/time-window panel it needs stays
  // open regardless of the stored preference.
  const queryPanelExpanded = !result || !queryPanelCollapsed;

  const resultArea = (
    <>
      {activeView.error && (
        <div className={styles.error} style={{ marginBottom: 16 }}>
          {activeView.error}
        </div>
      )}

      {activeView.resultFetchedAt && (
        <div style={{ marginBottom: 16 }}>
          <CacheStatus
            label="Changes"
            fetchedAt={activeView.resultFetchedAt}
            loading={activeView.loading}
            onRefresh={() => runQueryForView(activeView, true)}
          />
        </div>
      )}

      {activeView.loading && !result && <Loader label="Checking Activity Log…" />}

      {!activeView.error && !activeView.loading && !result && (
        <RecentChangesEmptyState canRun={runnable} loading={activeView.loading} onRun={() => runQueryForView(activeView, false)} />
      )}

      {result && result.changes.length === 0 && (
        <p className={styles.sub}>
          No campaign or ad set changes in the selected account{activeView.accountIds.length > 1 ? "s" : ""} over the{" "}
          {HOURS_PRESETS.find((p) => p.value === activeView.hours)?.label.toLowerCase()}.
        </p>
      )}

      {result && result.meta.accountErrors.length > 0 && (
        <p className={styles.sub} style={{ color: "var(--red)", marginBottom: 12 }}>
          Couldn&apos;t check:{" "}
          {result.meta.accountErrors.map((e) => `${accountName(e.accountId)} (${e.message})`).join(", ")}
        </p>
      )}

      {result && result.meta.truncated && (
        <p className={styles.sub} style={{ marginBottom: 12 }}>
          Showing performance impact for the {MAX_IMPACT_CHANGES} most recent changes only.
        </p>
      )}

      {result && result.changes.length > 0 && (
        <>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
            <FilterDropdown
              label="Action Type"
              options={availableCategories.map((c) => ({ key: c.key, label: c.label }))}
              selected={activeView.filters.categories}
              onToggle={toggleCategoryFilter}
              style={{ minWidth: 200 }}
            />
            <FilterDropdown
              label="Changed By"
              options={availableActors.map((name) => ({ key: name, label: name }))}
              selected={activeView.filters.actors}
              onToggle={toggleActorFilter}
              style={{ minWidth: 200 }}
            />
          </div>

          {filteredChanges.length !== result.changes.length && (
            <p className={styles.sub} style={{ marginBottom: 12 }}>
              {filteredChanges.length} of {result.changes.length} changes shown (filtered)
            </p>
          )}

          <div className={styles.card} style={{ padding: 0, overflow: "hidden" }}>
            {filteredChanges.map((c) => {
              const detail = describeChangeDetail(c.rawExtraData);
              return (
                <div key={c.id} style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
                    <span className={styles[CATEGORY_BADGE[c.category]] || styles.badgeInfo}>{c.categoryLabel}</span>
                    <span className={styles.badgeInfo}>{c.level}</span>
                    <strong style={{ fontSize: 13 }}>{c.objectName || c.objectId}</strong>
                    <span className={styles.muted}>· {accountName(c.accountId)}</span>
                    <span
                      className={styles.muted}
                      style={{ marginLeft: "auto" }}
                      title={c.eventTime ? new Date(c.eventTime).toLocaleString() : undefined}
                    >
                      {relativeTime(c.eventTime)}
                    </span>
                  </div>
                  <p className={styles.sub} style={{ marginBottom: 6 }}>
                    {c.description}
                  </p>
                  {detail && (
                    <p className={styles.sub} style={{ marginBottom: 6 }}>
                      Changed: <strong>{detail.from}</strong> → <strong>{detail.to}</strong>
                    </p>
                  )}

                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span className={styles.muted}>By {c.actorName}</span>
                    {c.tooRecent && <span className={styles.muted}>· Too recent to measure</span>}
                    {c.impactCapped && (
                      <span
                        className={styles.muted}
                        title={`Only the ${MAX_IMPACT_CHANGES} most recent changes get a quick performance signal here — use Investigate to see this one's performance.`}
                      >
                        · Not computed for this change
                      </span>
                    )}
                    {!c.tooRecent && !c.impactCapped && c.impact === undefined && <Loader inline label="Loading impact…" />}
                    {!c.tooRecent && !c.impactCapped && c.impact === null && (
                      <span className={styles.muted} title="Couldn't load a performance signal for this change — use Investigate instead.">
                        · Impact unavailable
                      </span>
                    )}
                    {!c.tooRecent && c.impact && (
                      <>
                        <QuickSignal label="Spend" before={c.impact.before?.spend} after={c.impact.after?.spend} />
                        <QuickSignal label="Purchases" before={c.impact.before?.purchases} after={c.impact.after?.purchases} />
                        <QuickSignal label="ROAS" before={c.impact.before?.roas} after={c.impact.after?.roas} />
                      </>
                    )}
                    <button
                      type="button"
                      className={styles.btnPrimary}
                      style={{ padding: "5px 12px", fontSize: 11, marginLeft: "auto", boxShadow: "none" }}
                      onClick={() => setInvestigatingChange(c)}
                    >
                      Investigate
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </>
  );

  // Renders one tab button — shared between ungrouped tabs and a group's own
  // member tabs below, so both look and behave identically. `idx` is this
  // tab's position in the full `views` array (what viewTitle's "View N"
  // fallback numbers off), `groupColorKey` (if any) tints it to match its
  // group. Mirrors pages/explore.js's own renderTabButton exactly.
  function renderTabButton(v, idx, groupColorKey) {
    const isActive = v.id === activeViewId;
    const isRenaming = renamingViewId === v.id;
    const tint = groupColorKey ? groupColor(groupColorKey) : null;
    return (
      <div
        key={v.id}
        onClick={() => setActiveViewId(v.id)}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setTabMenu({ type: "tab", id: v.id, x: e.clientX, y: e.clientY });
        }}
        title={
          isRenaming
            ? undefined
            : `${viewTitle(v, adAccounts, idx)} — double-click to rename, right-click for group options`
        }
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "8px 10px",
          borderRadius: "10px 10px 0 0",
          cursor: "pointer",
          fontSize: 12.5,
          fontWeight: 600,
          maxWidth: isRenaming ? 220 : 190,
          background: isActive ? "var(--bg)" : tint ? tint.bg : "transparent",
          border: "1px solid var(--border)",
          borderBottom: isActive ? "2px solid var(--purple)" : "1px solid var(--border)",
          color: isActive ? "var(--t1)" : "var(--t2)",
        }}
      >
        {v.loading && <span className={`${styles.spinner} ${styles.spinnerSm}`} />}
        {isRenaming ? (
          <input
            type="text"
            autoFocus
            className={styles.select}
            value={renameDraft}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => setRenameDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") cancelRename();
            }}
            style={{ width: 140, fontSize: 12.5, padding: "2px 6px" }}
          />
        ) : (
          <span
            onDoubleClick={(e) => {
              e.stopPropagation();
              startRenaming(v, idx);
            }}
            style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
          >
            {viewTitle(v, adAccounts, idx)}
          </span>
        )}
        {views.length > 1 && !isRenaming && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              closeView(v.id);
            }}
            title="Close this view"
            style={{
              background: "none",
              border: "none",
              padding: 0,
              cursor: "pointer",
              color: "inherit",
              display: "flex",
              flexShrink: 0,
            }}
          >
            <CloseIcon size={11} />
          </button>
        )}
      </div>
    );
  }

  // A group's colored label chip, like Chrome's own tab-group label — click
  // opens the rename/color/collapse/ungroup/close popover (see `tabMenu`).
  // Mirrors pages/explore.js's own renderGroupChip exactly.
  function renderGroupChip(group, memberCount) {
    const tint = groupColor(group.color);
    return (
      <button
        type="button"
        key={`chip-${group.id}`}
        onClick={(e) => {
          e.stopPropagation();
          setGroupRenameDraft(group.name);
          setTabMenu((prev) =>
            prev?.type === "group" && prev.id === group.id ? null : { type: "group", id: group.id, x: e.clientX, y: e.clientY }
          );
        }}
        title={`${group.name} — click to rename, recolor, collapse, or ungroup`}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "8px 10px 8px 12px",
          cursor: "pointer",
          fontSize: 12.5,
          fontWeight: 700,
          color: "var(--t1)",
          background: tint.bg,
          border: `1px solid ${tint.border}`,
          borderBottom: "none",
          borderRadius: "10px 0 0 0",
          whiteSpace: "nowrap",
        }}
      >
        <span style={{ width: 9, height: 9, borderRadius: "50%", background: tint.border, flexShrink: 0 }} />
        {group.name}
        {group.collapsed && <span style={{ color: "var(--t3)", fontWeight: 600 }}>({memberCount})</span>}
      </button>
    );
  }

  // Walks `views` in order, clustering each group's tabs (always contiguous
  // — see lib/tabGroups.js's moveViewNextToGroup) behind its chip, so
  // grouped and ungrouped tabs can freely interleave along the strip exactly
  // like Chrome's own tab bar. A collapsed group hides every one of its
  // member tabs — including the active one — same as Chrome itself: the
  // result area above still shows whichever view is active regardless of
  // whether its tab button is visible. Mirrors pages/explore.js's own
  // renderTabStrip exactly.
  function renderTabStrip() {
    const elements = [];
    let i = 0;
    while (i < views.length) {
      const v = views[i];
      if (!v.groupId) {
        elements.push(renderTabButton(v, i, null));
        i++;
        continue;
      }
      const group = groups.find((g) => g.id === v.groupId);
      let j = i;
      while (j < views.length && views[j].groupId === v.groupId) j++;
      const members = views.slice(i, j);
      const startIdx = i;
      elements.push(
        <div key={`group-${v.groupId}`} style={{ display: "flex", alignItems: "flex-end" }}>
          {group ? renderGroupChip(group, members.length) : null}
          {!group?.collapsed && members.map((m) => renderTabButton(m, startIdx + members.indexOf(m), group?.color))}
        </div>
      );
      i = j;
    }
    return elements;
  }

  // The right-click "add to / remove from group" menu on a tab, or the
  // click-to-manage popover on a group's own chip — whichever `tabMenu`
  // currently points at. Rendered fixed at the triggering click's own
  // coordinates; closed by the window click/Escape listener set up above.
  // Mirrors pages/explore.js's own renderTabMenu exactly.
  function renderTabMenu() {
    if (!tabMenu) return null;
    const menuStyle = {
      position: "fixed",
      top: tabMenu.y + 4,
      left: tabMenu.x,
      zIndex: 50,
      background: "var(--bg)",
      border: "1px solid var(--border)",
      borderRadius: 10,
      boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
      padding: 8,
      minWidth: 200,
      fontSize: 12.5,
    };
    const menuItemStyle = {
      display: "flex",
      alignItems: "center",
      gap: 8,
      width: "100%",
      textAlign: "left",
      background: "none",
      border: "none",
      padding: "6px 8px",
      borderRadius: 6,
      cursor: "pointer",
      color: "var(--t1)",
    };

    if (tabMenu.type === "tab") {
      const view = views.find((v) => v.id === tabMenu.id);
      if (!view) return null;
      return (
        <div style={menuStyle} onClick={(e) => e.stopPropagation()}>
          {view.groupId && (
            <button type="button" style={menuItemStyle} onClick={() => removeViewFromGroup(view.id)}>
              Remove from group
            </button>
          )}
          <button type="button" style={menuItemStyle} onClick={() => createGroupFromView(view.id)}>
            Add tab to new group
          </button>
          {liveGroups
            .filter((g) => g.id !== view.groupId)
            .map((g) => (
              <button key={g.id} type="button" style={menuItemStyle} onClick={() => addViewToGroup(view.id, g.id)}>
                <span
                  style={{ width: 9, height: 9, borderRadius: "50%", background: groupColor(g.color).border, flexShrink: 0 }}
                />
                Add to &quot;{g.name}&quot;
              </button>
            ))}
        </div>
      );
    }

    const group = groups.find((g) => g.id === tabMenu.id);
    if (!group) return null;
    const memberCount = views.filter((v) => v.groupId === group.id).length;
    return (
      <div style={menuStyle} onClick={(e) => e.stopPropagation()}>
        <input
          type="text"
          autoFocus
          className={styles.select}
          value={groupRenameDraft}
          onChange={(e) => setGroupRenameDraft(e.target.value)}
          onBlur={() => commitGroupRename(group.id, groupRenameDraft)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitGroupRename(group.id, groupRenameDraft);
            if (e.key === "Escape") setTabMenu(null);
          }}
          style={{ width: "100%", marginBottom: 8 }}
        />
        <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
          {GROUP_COLORS.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => recolorGroup(group.id, c.key)}
              title={c.key}
              style={{
                width: 20,
                height: 20,
                borderRadius: "50%",
                background: c.dot,
                border: group.color === c.key ? "2px solid var(--t1)" : "2px solid transparent",
                cursor: "pointer",
                padding: 0,
              }}
            />
          ))}
        </div>
        <button type="button" style={menuItemStyle} onClick={() => toggleGroupCollapsed(group.id)}>
          {group.collapsed ? "Expand group" : "Collapse group"}
        </button>
        <button type="button" style={menuItemStyle} onClick={() => ungroup(group.id)}>
          Ungroup
        </button>
        <button type="button" style={{ ...menuItemStyle, color: "var(--red)" }} onClick={() => closeGroup(group.id)}>
          Close group ({memberCount} tab{memberCount === 1 ? "" : "s"})
        </button>
      </div>
    );
  }

  return (
    <Layout>
      <Head>
        <title>Recent Changes · Facebook Auth Dashboard</title>
      </Head>
      <div className={styles.page}>
        <main className={styles.main} style={{ maxWidth: 1400, margin: "0 auto" }}>
          <h1 className={styles.h1}>Recent Changes</h1>
          <p className={styles.sub} style={{ marginTop: -8, marginBottom: 20 }}>
            Campaign and ad set changes — budget updates, launches, status changes — pulled from Facebook&apos;s own
            Activity Log, so it reflects what changed no matter which tool made the change. Keep several views open
            at once, like browser tabs — each with its own accounts and time window.
          </p>

          {accountsError && <div className={styles.error}>Error loading ad accounts: {accountsError}</div>}

          <div
            style={{
              display: "flex",
              alignItems: "flex-end",
              gap: 6,
              flexWrap: "wrap",
              position: "sticky",
              top: 0,
              zIndex: 5,
              background: "var(--bg)",
              paddingTop: 8,
              paddingBottom: 2,
            }}
          >
            {renderTabStrip()}
            <button
              type="button"
              onClick={addBlankView}
              title="New view"
              className={styles.btnSecondary}
              style={{ padding: "6px 12px", borderRadius: "10px 10px 0 0" }}
            >
              +
            </button>
          </div>
          {renderTabMenu()}

          {queryPanelExpanded ? (
            <div className={styles.exploreLayout}>
              <div className={styles.exploreContent}>{resultArea}</div>

              <aside className={styles.exploreQueryPanel}>
                <div className={styles.card} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, fontSize: 13 }}>
                      <SettingsIcon size={15} />
                      Accounts &amp; Time Window
                    </span>
                    {/* No collapse control until there's a result to fall back to showing instead —
                        collapsing here would leave the page with nothing on it at all. */}
                    {!!result && (
                      <button
                        type="button"
                        className={styles.appSidebarIconBtn}
                        onClick={toggleQueryPanel}
                        title="Collapse — focus on the results"
                      >
                        <ChevronIcon direction="right" size={15} />
                      </button>
                    )}
                  </div>

                  <div>
                    <h2 className={styles.h2}>Accounts</h2>
                    <AccountSelect
                      accounts={adAccounts}
                      multiple
                      values={activeView.accountIds}
                      onChange={(ids) => updateQuerySpec({ accountIds: ids })}
                      maxSelected={10}
                      placeholder="Select one or more accounts…"
                    />
                  </div>

                  <div>
                    <h2 className={styles.h2}>Time Window</h2>
                    <div className={styles.tabGroup} style={{ flexWrap: "wrap" }}>
                      {HOURS_PRESETS.map((p) => (
                        <button
                          key={p.value}
                          type="button"
                          className={activeView.hours === p.value ? `${styles.tab} ${styles.tabActive}` : styles.tab}
                          onClick={() => updateQuerySpec({ hours: p.value })}
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <button
                    type="button"
                    className={styles.btnPrimary}
                    onClick={() => runQueryForView(activeView, false)}
                    disabled={!runnable || activeView.loading}
                  >
                    {activeView.loading ? "Loading…" : "Check Recent Changes"}
                  </button>
                </div>
              </aside>
            </div>
          ) : (
            <div className={styles.exploreContent}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
                <p className={styles.sub} style={{ margin: 0 }}>
                  {summarizeView(activeView, adAccounts)}
                </p>
                <button
                  type="button"
                  className={styles.btnSecondary}
                  onClick={toggleQueryPanel}
                  style={{ display: "flex", alignItems: "center", gap: 6 }}
                >
                  <SettingsIcon size={13} />
                  Edit Accounts
                  <ChevronIcon direction="left" size={12} />
                </button>
              </div>
              {resultArea}
            </div>
          )}
        </main>
      </div>

      <InvestigateDrawer
        change={investigatingChange}
        onClose={() => setInvestigatingChange(null)}
        currency={investigatingChange ? currencyByAccountId.get(investigatingChange.accountId) : undefined}
      />
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
