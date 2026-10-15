import Head from "next/head";
import { getServerSession } from "next-auth/next";
import { useEffect, useMemo, useRef, useState } from "react";
import { authOptions } from "./api/auth/[...nextauth]";
import Layout from "@/components/Layout";
import Loader from "@/components/Loader";
import AccountSelect from "@/components/AccountSelect";
import FilterDropdown from "@/components/FilterDropdown";
import EntityChangesDrawer from "@/components/EntityChangesDrawer";
import { ChevronIcon, CloseIcon, RefreshIcon, SettingsIcon } from "@/components/icons";
import { useAccounts } from "@/components/AccountProvider";
import { getCachedEntry, setCachedEntry } from "@/lib/clientCache";
import { parseJsonResponse } from "@/lib/fetchJson";
import {
  getNewRecentChangesTabs,
  setNewRecentChangesTabs,
  getNewRecentChangesQueryPanelCollapsed,
  setNewRecentChangesQueryPanelCollapsed,
} from "@/lib/clientStorage";
import styles from "@/styles/Home.module.css";

const CACHE_PREFIX = "new-recent-changes:";
const CACHE_MAX_ENTRIES = 50;
const MAX_TABS = 10;

const HOURS_PRESETS = [
  { value: 24, label: "Last 24 Hours" },
  { value: 72, label: "Last 72 Hours" },
  { value: 168, label: "Last 7 Days" },
];

const LEVEL_LABEL = { campaign: "Campaign", adset: "Ad Set" };
const LEVEL_BADGE_CLASS = { campaign: styles.badgeInfo, adset: styles.badgeGood };

function newTabId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `t${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

// One independent tab: its own account, time window, and campaign filter,
// plus its own fetched result/loading/error — switching tabs never touches
// another tab's state. Mirrors pages/recent-changes.js's own
// createBlankView, just scoped to one account instead of several.
function createBlankTab(seedAccountId = "") {
  return {
    id: newTabId(),
    customTitle: null,
    accountId: seedAccountId,
    hours: 72,
    // Campaigns to include — null means "every campaign," same null-means-all
    // convention as FilterDropdown/pages/explore.js's own pivot filters.
    includedCampaignIds: null,
    result: null,
    loading: false,
    error: null,
  };
}

function withCapApplied(tabsList, protectedId) {
  if (tabsList.length < MAX_TABS) return tabsList;
  const evictIdx = tabsList[0].id === protectedId ? 1 : 0;
  return tabsList.filter((_, i) => i !== evictIdx);
}

function tabTitle(tab, adAccounts, fallbackIndex) {
  if (tab.customTitle) return tab.customTitle;
  const name = adAccounts.find((a) => a.id === tab.accountId)?.name;
  return name || `Tab ${fallbackIndex + 1}`;
}

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

// One row on the landing list — just enough to tell there's something worth
// opening ("some change took place at each level," per the original ask),
// not the changes themselves; those live behind EntityChangesDrawer.
function EntityRow({ entity, onOpen }) {
  const levelLabel = LEVEL_LABEL[entity.level] || entity.level;
  return (
    <button
      type="button"
      onClick={() => onOpen(entity)}
      className={styles.card}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        width: "100%",
        textAlign: "left",
        cursor: "pointer",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
        <span className={LEVEL_BADGE_CLASS[entity.level] || styles.badgeInfo}>{levelLabel}</span>
        <p style={{ margin: 0, fontWeight: 600, fontSize: 13.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {entity.entityName || entity.entityId}
        </p>
        {entity.level === "adset" && entity.campaignName && (
          <span className={styles.muted} style={{ fontSize: 11.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            in {entity.campaignName}
          </span>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
        <span className={styles.muted} style={{ fontSize: 12 }}>
          {entity.changeCount} change{entity.changeCount === 1 ? "" : "s"} · last {relativeTime(entity.lastChangeTime)}
        </span>
        <ChevronIcon direction="right" size={13} />
      </div>
    </button>
  );
}

// Shown before a tab has ever been run — mirrors pages/recent-changes.js's
// own RecentChangesEmptyState, reusing the same CSS classes.
function NewRecentChangesEmptyState({ canRun, onRun, loading }) {
  return (
    <section className={styles.card}>
      <div className={styles.exploreEmptyState}>
        <div className={styles.exploreEmptyIcon}>
          <RefreshIcon size={26} />
        </div>
        <div>
          <h2 className={styles.h2} style={{ marginBottom: 6 }}>
            See what changed recently
          </h2>
          <p className={styles.sub}>
            Pick an account and a time window in the panel on the right, then check for changes to see them here.
          </p>
        </div>
        <div className={styles.exploreEmptySteps}>
          {["Pick an account", "Choose a time window", 'Click "Check Changes"'].map((step, i) => (
            <div key={step} className={styles.exploreEmptyStep}>
              <span className={styles.exploreEmptyStepNum}>{i + 1}</span>
              {step}
            </div>
          ))}
        </div>
        <button type="button" className={styles.btnPrimary} disabled={!canRun || loading} onClick={onRun}>
          {loading ? "Checking…" : "Check Changes"}
        </button>
      </div>
    </section>
  );
}

// A narrower, pre-grouped, differently-designed sibling of
// pages/recent-changes.js: one account and one of three time windows per
// tab, and only six tracked actions (Ad launched/paused, Ad Set budget
// change/paused, Campaign budget change/paused) — rolled up one level per
// pages/api/fb/new-recent-changes.js's own bucketing (an ad's own activity
// and its ad set's own budget change both read as "this ad set"; an ad set
// being paused and a campaign's own budget/pause both read as "this
// campaign"). Supports multiple tabs (one query each, switchable) the same
// way Recent Changes does, so a user can keep several account/window
// combinations open side by side.
export default function NewRecentChanges() {
  const { adAccounts, accountsError, selectedAccountId } = useAccounts();

  const [tabs, setTabs] = useState(() => [createBlankTab("")]);
  const [activeTabId, setActiveTabId] = useState(() => tabs[0].id);
  const activeTab = tabs.find((t) => t.id === activeTabId) || tabs[0];

  const [renamingTabId, setRenamingTabId] = useState(null);
  const [renameDraft, setRenameDraft] = useState("");

  const [openEntity, setOpenEntity] = useState(null);

  // Collapsed by default (per-device), same as pages/recent-changes.js's own
  // panel — a tab with results already loaded doesn't keep the Accounts/Time
  // Window panel permanently in the way. `queryPanelExpanded` below is the
  // one exception: a tab with nothing fetched yet forces this open.
  const [queryPanelCollapsed, setQueryPanelCollapsedState] = useState(true);
  useEffect(() => {
    const saved = getNewRecentChangesQueryPanelCollapsed();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time read of a per-device localStorage preference on mount, not derivable from props/state
    if (saved != null) setQueryPanelCollapsedState(saved);
  }, []);
  function toggleQueryPanel() {
    setQueryPanelCollapsedState((prev) => {
      const next = !prev;
      setNewRecentChangesQueryPanelCollapsed(next);
      return next;
    });
  }

  const hasSeededInitialAccountRef = useRef(false);
  const hasRestoredRef = useRef(false);

  // One-time restore of previously-open tabs from localStorage, pre-populated
  // from the shared query cache when still fresh — same convention as
  // pages/recent-changes.js's own restore effect.
  useEffect(() => {
    if (hasRestoredRef.current) return;
    hasRestoredRef.current = true;
    const persisted = getNewRecentChangesTabs();
    if (!persisted?.tabs?.length) return;
    const hydrated = persisted.tabs.map((t) => {
      const cached = t.accountId
        ? getCachedEntry(`${CACHE_PREFIX}${JSON.stringify({ accountId: t.accountId, hours: t.hours })}`)
        : null;
      return {
        ...createBlankTab(),
        ...t,
        includedCampaignIds: t.includedCampaignIds ?? null,
        result: cached?.data ?? null,
        loading: false,
        error: null,
      };
    });
    // One-time hydration from localStorage on mount, not derived state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTabs(hydrated);
    setActiveTabId(persisted.activeTabId && hydrated.some((t) => t.id === persisted.activeTabId) ? persisted.activeTabId : hydrated[0].id);
    if (hydrated.some((t) => t.accountId)) hasSeededInitialAccountRef.current = true;
  }, []);

  // Seeds the first tab's account from the shared account picker exactly
  // once, same as every other multi-tab page in this app — never again
  // afterwards, so switching accounts elsewhere doesn't hijack an
  // already-chosen tab.
  useEffect(() => {
    if (hasSeededInitialAccountRef.current || !selectedAccountId) return;
    hasSeededInitialAccountRef.current = true;
    updateTab(tabs[0].id, { accountId: selectedAccountId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAccountId]);

  // Persists tabs (minus ephemeral result/loading/error) whenever they or
  // the active tab change.
  useEffect(() => {
    setNewRecentChangesTabs({
      tabs: tabs.map(({ result, loading, error, ...rest }) => rest),
      activeTabId,
    });
  }, [tabs, activeTabId]);

  function updateTab(id, patch) {
    setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }

  function addTab() {
    const fresh = createBlankTab(activeTab.accountId || "");
    setTabs((prev) => withCapApplied([...prev, fresh], activeTabId));
    setActiveTabId(fresh.id);
  }

  function closeTab(id, e) {
    e.stopPropagation();
    setTabs((prev) => {
      const next = prev.filter((t) => t.id !== id);
      const finalTabs = next.length === 0 ? [createBlankTab(activeTab.accountId || "")] : next;
      if (id === activeTabId) setActiveTabId(finalTabs[0].id);
      return finalTabs;
    });
  }

  function startRenaming(tab, fallbackIndex) {
    setRenamingTabId(tab.id);
    setRenameDraft(tab.customTitle || tabTitle(tab, adAccounts, fallbackIndex));
  }
  function commitRename() {
    if (renamingTabId) updateTab(renamingTabId, { customTitle: renameDraft.trim() || null });
    setRenamingTabId(null);
  }

  const currency = useMemo(() => adAccounts.find((a) => a.id === activeTab.accountId)?.currency, [adAccounts, activeTab.accountId]);
  const runnable = !!activeTab.accountId;

  function runQuery(force) {
    const tabId = activeTab.id;
    const accountId = activeTab.accountId;
    const hours = activeTab.hours;
    if (!accountId) return;
    const cacheKey = `${CACHE_PREFIX}${JSON.stringify({ accountId, hours })}`;
    if (!force) {
      const cached = getCachedEntry(cacheKey);
      if (cached) {
        updateTab(tabId, { result: cached.data, error: null });
        return;
      }
    }
    updateTab(tabId, { loading: true, error: null });
    fetch(`/api/fb/new-recent-changes?accountId=${encodeURIComponent(accountId)}&hours=${hours}`)
      .then(parseJsonResponse)
      .then((json) => {
        if (json.error) {
          updateTab(tabId, { error: json.error, loading: false });
          return;
        }
        updateTab(tabId, { result: json, loading: false });
        setCachedEntry(cacheKey, json, { prefix: CACHE_PREFIX, maxEntriesForPrefix: CACHE_MAX_ENTRIES });
      })
      .catch((err) => updateTab(tabId, { error: err.message, loading: false }));
  }

  // Re-opens the same entity from the freshly-fetched result (not the stale
  // object the drawer was first opened with) whenever the active tab's query
  // re-runs while the drawer is open.
  useEffect(() => {
    if (!openEntity || !activeTab.result) return;
    const fresh = activeTab.result.entities.find((e) => e.level === openEntity.level && e.entityId === openEntity.entityId);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- re-syncing an already-open drawer to a just-refreshed result, not derivable from render
    setOpenEntity(fresh || null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab.result]);

  // Distinct campaigns seen in the active tab's own result — the "filter out
  // campaigns" picker's option list. A Campaign-level entity's own id/name is
  // its own campaign; an Ad Set entity carries its parent campaignId/
  // campaignName from the API (see pages/api/fb/new-recent-changes.js).
  const campaignOptions = useMemo(() => {
    if (!activeTab.result) return [];
    const byId = new Map();
    for (const entity of activeTab.result.entities) {
      if (entity.campaignId && !byId.has(entity.campaignId)) {
        byId.set(entity.campaignId, entity.campaignName || entity.campaignId);
      }
    }
    return [...byId.entries()].map(([key, label]) => ({ key, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [activeTab.result]);

  function toggleCampaign(campaignId) {
    updateTab(activeTab.id, {
      includedCampaignIds: (() => {
        const current = activeTab.includedCampaignIds ?? campaignOptions.map((o) => o.key);
        return current.includes(campaignId) ? current.filter((id) => id !== campaignId) : [...current, campaignId];
      })(),
    });
  }

  const visibleEntities = useMemo(() => {
    if (!activeTab.result) return [];
    if (!activeTab.includedCampaignIds) return activeTab.result.entities;
    // An entity with no known parent campaign (lookup failed) always stays
    // visible — hiding it silently, with no way to un-hide it via the
    // campaign filter, would be worse than occasionally over-showing one.
    return activeTab.result.entities.filter((e) => !e.campaignId || activeTab.includedCampaignIds.includes(e.campaignId));
  }, [activeTab.result, activeTab.includedCampaignIds]);

  // Forces the Accounts/Time Window panel open until there's a result to
  // fall back to showing instead of a blank page — mirrors
  // pages/recent-changes.js's own queryPanelExpanded exactly.
  const queryPanelExpanded = !activeTab.result || !queryPanelCollapsed;

  const resultArea = activeTab.loading ? (
    <Loader label="Checking recent changes…" />
  ) : activeTab.error ? (
    <div className={styles.error}>{activeTab.error}</div>
  ) : !activeTab.result ? (
    <NewRecentChangesEmptyState canRun={runnable} loading={activeTab.loading} onRun={() => runQuery(false)} />
  ) : (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <p className={styles.sub} style={{ margin: 0 }}>
          {visibleEntities.length} {visibleEntities.length === 1 ? "entity" : "entities"} with tracked changes
          {visibleEntities.length !== activeTab.result.entities.length && ` (of ${activeTab.result.entities.length})`}
        </p>
        <button type="button" className={styles.btnSecondary} onClick={() => runQuery(true)}>
          Hard Refresh
        </button>
      </div>
      {visibleEntities.length === 0 && activeTab.result.entities.length === 0 && (
        <p className={styles.sub}>No tracked changes (Ad launches/pauses, budget changes, Ad Set/Campaign pauses) in this window.</p>
      )}
      {visibleEntities.length === 0 && activeTab.result.entities.length > 0 && (
        <p className={styles.sub}>No entities match the selected campaign filter.</p>
      )}
      {visibleEntities.map((entity) => (
        <EntityRow key={`${entity.level}:${entity.entityId}`} entity={entity} onOpen={setOpenEntity} />
      ))}
    </div>
  );

  return (
    <Layout>
      <Head>
        <title>New Recent Changes · Facebook Auth Dashboard</title>
      </Head>
      <div className={styles.page}>
        <main className={styles.main} style={{ maxWidth: 1000, margin: "0 auto" }}>
          <h1 className={styles.h1}>New Recent Changes</h1>
          <p className={styles.sub} style={{ marginTop: -8, marginBottom: 20 }}>
            Pick an account and a time window to see which Campaigns and Ad Sets had activity — Ads launched or
            paused, and budget or pause changes. Open one to see what changed, grouped by day, with an option to
            investigate any day&apos;s performance impact.
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
            {tabs.map((tab, i) => {
              const isActive = tab.id === activeTabId;
              const isRenaming = renamingTabId === tab.id;
              return (
                <div
                  key={tab.id}
                  onClick={() => setActiveTabId(tab.id)}
                  title={isRenaming ? undefined : `${tabTitle(tab, adAccounts, i)} — double-click to rename`}
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
                    background: isActive ? "var(--bg)" : "transparent",
                    border: "1px solid var(--border)",
                    borderBottom: isActive ? "2px solid var(--purple)" : "1px solid var(--border)",
                    color: isActive ? "var(--t1)" : "var(--t2)",
                  }}
                >
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
                        if (e.key === "Escape") setRenamingTabId(null);
                      }}
                      style={{ width: 140, fontSize: 12.5, padding: "2px 6px" }}
                    />
                  ) : (
                    <span
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        startRenaming(tab, i);
                      }}
                      style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                    >
                      {tabTitle(tab, adAccounts, i)}
                    </span>
                  )}
                  {tabs.length > 1 && !isRenaming && (
                    <button
                      type="button"
                      onClick={(e) => closeTab(tab.id, e)}
                      title="Close this tab"
                      aria-label="Close tab"
                      style={{ display: "flex", background: "none", border: "none", cursor: "pointer", color: "inherit", flexShrink: 0, padding: 0 }}
                    >
                      <CloseIcon size={11} />
                    </button>
                  )}
                </div>
              );
            })}
            <button
              type="button"
              onClick={addTab}
              title="New tab"
              className={styles.btnSecondary}
              style={{ padding: "6px 12px", borderRadius: "10px 10px 0 0" }}
            >
              +
            </button>
          </div>

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
                    {!!activeTab.result && (
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
                    <h2 className={styles.h2}>Account</h2>
                    <AccountSelect
                      accounts={adAccounts}
                      value={activeTab.accountId}
                      onChange={(id) => updateTab(activeTab.id, { accountId: id, result: null, error: null })}
                      placeholder="Select an ad account…"
                      style={{ width: "100%" }}
                    />
                  </div>

                  <div>
                    <h2 className={styles.h2}>Time Window</h2>
                    <div className={styles.tabGroup} style={{ flexWrap: "wrap" }}>
                      {HOURS_PRESETS.map((p) => (
                        <button
                          key={p.value}
                          type="button"
                          className={activeTab.hours === p.value ? `${styles.tab} ${styles.tabActive}` : styles.tab}
                          onClick={() => updateTab(activeTab.id, { hours: p.value })}
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {campaignOptions.length > 0 && (
                    <div>
                      <h2 className={styles.h2}>Campaigns</h2>
                      <FilterDropdown
                        label="Campaigns"
                        options={campaignOptions}
                        selected={activeTab.includedCampaignIds}
                        onToggle={toggleCampaign}
                        style={{ width: "100%" }}
                      />
                    </div>
                  )}

                  <button type="button" className={styles.btnPrimary} onClick={() => runQuery(false)} disabled={!runnable || activeTab.loading}>
                    {activeTab.loading ? "Loading…" : "Check Changes"}
                  </button>
                </div>
              </aside>
            </div>
          ) : (
            <div className={styles.exploreContent}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
                <p className={styles.sub} style={{ margin: 0 }}>
                  {adAccounts.find((a) => a.id === activeTab.accountId)?.name || "No account selected"} ·{" "}
                  {HOURS_PRESETS.find((p) => p.value === activeTab.hours)?.label}
                </p>
                <button
                  type="button"
                  className={styles.btnSecondary}
                  onClick={toggleQueryPanel}
                  style={{ display: "flex", alignItems: "center", gap: 6 }}
                >
                  <SettingsIcon size={13} />
                  Edit Account &amp; Window
                  <ChevronIcon direction="left" size={12} />
                </button>
              </div>
              {resultArea}
            </div>
          )}
        </main>
      </div>

      <EntityChangesDrawer entity={openEntity} onClose={() => setOpenEntity(null)} currency={currency} />
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
