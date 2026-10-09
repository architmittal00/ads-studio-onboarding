import Head from "next/head";
import { getServerSession } from "next-auth/next";
import { useEffect, useMemo, useRef, useState } from "react";
import { authOptions } from "./api/auth/[...nextauth]";
import Layout from "@/components/Layout";
import SectionNav from "@/components/SectionNav";
import SortableTable from "@/components/SortableTable";
import Thumb from "@/components/Thumb";
import CreativeLightbox from "@/components/CreativeLightbox";
import MetricTrendModal from "@/components/MetricTrendModal";
import Loader from "@/components/Loader";
import DefaultRangeModal from "@/components/DefaultRangeModal";
import AccountSelect from "@/components/AccountSelect";
import { RefreshIcon, SearchIcon, CalendarIcon, ChartIcon, SettingsIcon } from "@/components/icons";
import { getDefaultRangePreset, setDefaultRangePreset } from "@/lib/clientStorage";
import { getCachedEntry, setCachedEntry, DEFAULT_CACHE_TTL_MS } from "@/lib/clientCache";
import { useAccounts } from "@/components/AccountProvider";
import styles from "@/styles/Home.module.css";

// How long a report payload for a given (account, range, section) stays
// usable without re-hitting the API at all — separate from, and in addition
// to, each endpoint's own 30-min server-side cache (lib/reportCache.js).
// Backed by localStorage (lib/clientCache.js), not just an in-tab Map, so
// this survives a reload and is shared across tabs in the same browser, not
// just the one that happened to fetch it. This is what makes flipping Last 7
// Days -> Last 30 Days -> back to Last 7 Days an instant, no-network
// operation instead of a fresh request every time.
const CLIENT_CACHE_TTL_MS = DEFAULT_CACHE_TTL_MS;

// The report used to be one endpoint returning one big object, rendered only
// once every last piece of it was ready — so a single slow Graph call (an
// account-wide breakdown, say) held the entire page behind one spinner even
// though most sections don't depend on each other. It's now backed by
// several independent endpoints under /api/fb/report/*, one per group below
// — each section of the page renders the moment *its own* group's data
// arrives, with the rest still showing their own loaders. `core` is the one
// exception that's still a single (heavier) endpoint: Top Campaigns, Pareto,
// Creative Type, Product, High-Frequency, Structure, and Budget Utilization
// all branch off the same underlying per-ad data pipeline, so splitting
// those seven apart too would mean re-fetching/re-deriving that whole
// pipeline seven times over instead of once — see
// pages/api/fb/report/core.js's header comment for the full reasoning.
const REPORT_GROUPS = [
  { key: "headline", endpoint: "headline", label: "Overview & Trends" },
  { key: "ageGender", endpoint: "age-gender", label: "Age & Gender" },
  { key: "region", endpoint: "region", label: "By State" },
  { key: "placement", endpoint: "placement", label: "By Platform & Placement" },
  { key: "pixelHealth", endpoint: "pixel-health", label: "Pixel Health" },
  { key: "core", endpoint: "core", label: "Campaigns, Structure & Budget" },
];

function initialGroupState() {
  return { data: null, error: null, loading: false, fetchedAt: null };
}

function clientCacheKey(groupKey, accountId, rangePreset, since, until) {
  return `report:${groupKey}:${accountId}:${rangePreset}:${since || ""}:${until || ""}`;
}

async function fetchReportSection(endpoint, accountId, { force, rangePreset, since, until } = {}) {
  const params = new URLSearchParams({ accountId, rangePreset: rangePreset || "last_30d" });
  if (force) params.set("force", "true");
  if (rangePreset === "custom" && since && until) {
    params.set("since", since);
    params.set("until", until);
  }
  const res = await fetch(`/api/fb/report/${endpoint}?${params.toString()}`);
  return res.json();
}

// Mirrors pages/api/fb/report/headline.js's (and originally pages/api/fb/
// report.js's) own resolveRange()/lastNDaysRange() exactly — explicit UTC
// methods throughout, so this always agrees with what the server actually
// computes regardless of the viewer's own browser timezone (same reasoning
// as pages/explore.js's own client-side date math). Computed purely from
// state already available on the client, so the date-range heading can
// render immediately — it doesn't need to wait on any one section's fetch
// to resolve, unlike every other render-prop field below.
function toDateStr(d) {
  return d.toISOString().slice(0, 10);
}

function lastNDaysRangeUTC(n, today) {
  const until = new Date(today);
  until.setUTCDate(until.getUTCDate() - 1);
  const since = new Date(until);
  since.setUTCDate(since.getUTCDate() - (n - 1));
  return { since: toDateStr(since), until: toDateStr(until) };
}

function resolveClientRange(rangePreset, customSince, customUntil) {
  const today = new Date();
  if (rangePreset === "today") {
    const d = toDateStr(today);
    return { since: d, until: d, label: "Today" };
  }
  if (rangePreset === "last_7d") {
    return { ...lastNDaysRangeUTC(7, today), label: "Last 7 Days" };
  }
  if (rangePreset === "custom" && customSince && customUntil) {
    return { since: customSince, until: customUntil, label: `${customSince} → ${customUntil}` };
  }
  return { ...lastNDaysRangeUTC(30, today), label: "Last 30 Days" };
}

const NAME_COL_WIDTH = 240;

const STRUCTURE_SORT_OPTIONS = [
  { key: "name", label: "Name" },
  { key: "spend", label: "Spend" },
  { key: "purchases", label: "Purchases" },
  { key: "roas", label: "ROAS" },
];

// campaigns/ad sets use *InRange-suffixed field names, ads use bare ones —
// this maps a chosen metric to the right field at each tree level.
const STRUCTURE_SORT_FIELD = {
  name: { campaign: "name", adset: "name", ad: "name" },
  spend: { campaign: "spendInRange", adset: "spendInRange", ad: "spend" },
  purchases: { campaign: "purchasesInRange", adset: "purchasesInRange", ad: "purchases" },
  roas: { campaign: "roasInRange", adset: "roasInRange", ad: "roas" },
};

// Thumbnail + name, wrapping the name up to 3 lines and only then
// ellipsizing, instead of stretching the column. The name span needs
// minWidth:0 + flex:1 — a flex child's default min-width is its own content
// size, which silently defeats the clamp/ellipsis unless overridden.
// `onOpen`, when given, makes the thumbnail clickable to open the fullscreen
// creative lightbox (and shows a play icon when it's a video).
function CreativeCell({ ad, maxWidth = NAME_COL_WIDTH, onOpen }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 8, maxWidth, overflow: "hidden" }}>
      <Thumb src={ad.thumbnailUrl} isVideo={ad.isVideo} onClick={onOpen ? () => onOpen(ad) : undefined} />
      <span title={ad.name} className={styles.clamp3} style={{ minWidth: 0, flex: "1 1 auto" }}>
        {ad.name}
      </span>
    </div>
  );
}

// Renders a "where does 80% of purchase revenue come from, by <dimension>"
// table — shared by the age/gender, region, and creative-type breakdowns.
// `showSummary=false` is for creative type, where there's no meaningful
// 80%-of-N-groups framing since there are only ever 3 possible groups.
// Module-level (not defined inside Report()) so it isn't recreated — and
// remounted, losing its SortableTable's sort/search state — every render.
function BreakdownSection({
  id,
  title,
  data,
  labelHeader,
  showSummary = true,
  searchPlaceholder,
  emptyMessage,
  noRevenueMessage,
  money,
}) {
  return (
    <section id={id} className={styles.card}>
      <h2 className={styles.h2}>{title}</h2>
      {data.totalGroupCount === 0 ? (
        <p className={styles.sub}>{emptyMessage}</p>
      ) : data.contributorCount === 0 ? (
        <p className={styles.sub}>
          {noRevenueMessage ||
            `Facebook has spend data across ${data.totalGroupCount} ${labelHeader.toLowerCase()} groups here, but none of them show attributed purchase revenue in this window.`}
        </p>
      ) : (
        <>
          {showSummary && (
            <p className={styles.sub} style={{ marginBottom: 12 }}>
              <strong style={{ color: "var(--t1)" }}>
                {data.contributorCount} of {data.totalGroupCount} {labelHeader.toLowerCase()} groups
              </strong>{" "}
              ({data.revenueSharePct.toFixed(0)}% of purchase revenue) account for{" "}
              <strong style={{ color: "var(--t1)" }}>{data.spendSharePct.toFixed(0)}% of spend</strong>.
            </p>
          )}
          <SortableTable
            defaultSortKey="revenue"
            maxHeight={360}
            searchable={data.contributors.length > 6}
            searchKeys={["label"]}
            searchPlaceholder={searchPlaceholder}
            rows={data.contributors}
            columns={[
              { key: "label", label: labelHeader, maxWidth: 220 },
              { key: "spend", label: "Spend", align: "right", render: (r) => money(r.spend) },
              { key: "revenue", label: "Revenue", align: "right", render: (r) => money(r.revenue) },
              {
                key: "revenueSharePct",
                label: "% Revenue",
                align: "right",
                render: (r) => `${r.revenueSharePct.toFixed(1)}%`,
              },
              { key: "roas", label: "ROAS", align: "right", render: (r) => `${r.roas.toFixed(2)}x` },
              { key: "purchases", label: "Purchases", align: "right", render: (r) => r.purchases.toFixed(0) },
            ]}
          />
        </>
      )}
    </section>
  );
}

// Gates one report section on its own fetch group's state: renders the real
// content (via the render-prop `children`) once `group.data` has arrived,
// an inline error if that group's fetch failed, or a loader in the section's
// own place otherwise — so a slow/heavy group (e.g. `core`) never blocks a
// fast one (e.g. `headline`) from showing up first. Module-level for the
// same reason as BreakdownSection above.
function SectionGate({ group, loadingLabel, children }) {
  if (group.data) return children(group.data);
  if (group.error) {
    return (
      <div className={styles.card} style={{ borderColor: "rgba(239,68,68,.3)" }}>
        <div className={styles.error}>Error: {group.error}</div>
      </div>
    );
  }
  return (
    <div className={styles.card}>
      <Loader label={loadingLabel} />
    </div>
  );
}

// Filters the campaign -> ad set -> ad tree by a search term. If an
// ancestor's own name matches, all of its descendants are kept as-is
// (searching "Diwali" and matching a campaign name shows everything under
// it); otherwise only descendants that themselves match (by name) survive.
// Returns the filtered tree plus whether matches were found by searching
// *into* a branch rather than at its own level — that's used to force those
// branches open so the match is actually visible without a manual click.
function filterStructureTree(campaigns, term) {
  if (!term.trim()) return { campaigns, forceExpandIds: null };

  const lower = term.trim().toLowerCase();
  const matches = (name) => name.toLowerCase().includes(lower);
  const forceExpandIds = new Set();

  const filtered = [];
  for (const c of campaigns) {
    const campaignMatches = matches(c.name);
    let adsetsToShow = c.adsets;
    if (!campaignMatches) {
      adsetsToShow = [];
      for (const a of c.adsets) {
        const adsetMatches = matches(a.name);
        const adsToShow = adsetMatches ? a.ads : a.ads.filter((ad) => matches(ad.name));
        if (adsetMatches || adsToShow.length > 0) {
          adsetsToShow.push({ ...a, ads: adsToShow });
          if (!adsetMatches) forceExpandIds.add(a.id);
        }
      }
      if (adsetsToShow.length > 0) forceExpandIds.add(c.id);
    }
    if (campaignMatches || adsetsToShow.length > 0) {
      filtered.push({ ...c, adsets: adsetsToShow });
    }
  }
  return { campaigns: filtered, forceExpandIds };
}

function sortByField(list, field, dir) {
  const copy = [...list];
  copy.sort((a, b) => {
    const av = a[field];
    const bv = b[field];
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === "string") return dir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
    return dir === "asc" ? av - bv : bv - av;
  });
  return copy;
}

const RANGE_PRESETS = [
  { key: "today", label: "Today" },
  { key: "last_7d", label: "Last 7 Days" },
  { key: "last_30d", label: "Last 30 Days" },
  { key: "custom", label: "Custom" },
];

function formatAge(ms) {
  const mins = Math.round(ms / 60000);
  if (mins < 1) return "just now";
  if (mins === 1) return "1 minute ago";
  if (mins < 60) return `${mins} minutes ago`;
  const hours = Math.round(mins / 60);
  return `${hours} hour${hours > 1 ? "s" : ""} ago`;
}

const SECTIONS = [
  { id: "overview", label: "Overview" },
  { id: "trends", label: "Best Week / Month" },
  { id: "top-campaigns", label: "Top Campaigns" },
  { id: "pareto", label: "Revenue Concentration" },
  { id: "age-gender", label: "Age & Gender" },
  { id: "region", label: "By State" },
  { id: "creative-type", label: "By Creative Type" },
  { id: "placement", label: "By Platform & Placement" },
  { id: "product", label: "By Product" },
  { id: "pixel-health", label: "Pixel Health" },
  { id: "structure", label: "Account Structure" },
  { id: "high-frequency", label: "High-Frequency Ads" },
  { id: "budget-utilization", label: "Budget & Creatives" },
];

export default function Report() {
  const { adAccounts: accounts, accountsError, selectedAccountId, setSelectedAccountId } = useAccounts();

  const [groups, setGroups] = useState(() => Object.fromEntries(REPORT_GROUPS.map((g) => [g.key, initialGroupState()])));
  // Bumped on every account/range change (and every Hard Refresh) — each
  // in-flight fetch's resolution checks this before applying its result, so
  // a slow response from a since-abandoned account/range never clobbers
  // state for whatever's actually selected now. One counter shared by all 6
  // groups' fetches, since they're all kicked off together.
  const fetchGenerationRef = useRef(0);

  const [expandedCampaigns, setExpandedCampaigns] = useState({});
  const [expandedAdsets, setExpandedAdsets] = useState({});
  const [structureSortKey, setStructureSortKey] = useState("spend");
  const [structureSortDir, setStructureSortDir] = useState("desc");
  const [budgetTab, setBudgetTab] = useState("CBO");
  const [structureSearch, setStructureSearch] = useState("");
  const [lightboxItem, setLightboxItem] = useState(null);
  const [trendMetric, setTrendMetric] = useState(null);

  // Starts null (rather than reading localStorage in the initializer) so the
  // server-rendered and first client render match exactly — avoiding a
  // hydration mismatch — then resolves to the user's saved default (or
  // last_30d) in an effect right after mount, same pattern as the last-used
  // account below. The report-fetching effect waits for this to be non-null.
  const [rangePreset, setRangePreset] = useState(null);
  const [defaultRangePreset, setDefaultRangePresetState] = useState("last_30d");
  const [showDefaultRangeModal, setShowDefaultRangeModal] = useState(false);
  const [customSince, setCustomSince] = useState("");
  const [customUntil, setCustomUntil] = useState("");
  const [appliedCustomRange, setAppliedCustomRange] = useState(null);

  useEffect(() => {
    // One-time client-only read of a value (localStorage) that doesn't exist
    // during SSR — rangePreset starts null specifically so this can't cause
    // a hydration mismatch, and this is the only place it gets its real
    // initial value. Not an external-system subscription, just a lazy init
    // that has to happen post-mount; a justified exception to the rule.
    const saved = getDefaultRangePreset() || "last_30d";
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRangePreset(saved);
    setDefaultRangePresetState(saved);
  }, []);

  function handleSelectDefaultRange(preset) {
    setDefaultRangePreset(preset);
    setDefaultRangePresetState(preset);
    setShowDefaultRangeModal(false);
  }

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(interval);
  }, []);

  const currency = accounts.find((a) => a.id === selectedAccountId)?.currency;

  function updateGroup(key, patch) {
    setGroups((prev) => ({
      ...prev,
      [key]: { ...prev[key], ...(typeof patch === "function" ? patch(prev[key]) : patch) },
    }));
  }

  // Fires one independent fetch per group — each updates only its own slice
  // of `groups` as soon as *it* resolves, completely independently of how
  // long any of the others take. A group with a warm client cache entry
  // renders instantly (no request at all); the rest show their own loader
  // until their fetch comes back. `force` (Hard Refresh) keeps each group's
  // last-good data visible while it's re-fetched, rather than blanking it.
  function runAllGroups(generation, accountId, { force, rangePreset: preset, since, until }) {
    for (const group of REPORT_GROUPS) {
      const cacheKey = clientCacheKey(group.key, accountId, preset, since, until);

      if (!force) {
        const cached = getCachedEntry(cacheKey, CLIENT_CACHE_TTL_MS);
        if (cached) {
          updateGroup(group.key, { data: cached.data, error: null, loading: false, fetchedAt: cached.data.cachedAt });
          continue;
        }
      }

      updateGroup(group.key, (prev) => ({ loading: true, error: null, data: force ? prev.data : null }));
      fetchReportSection(group.endpoint, accountId, { force, rangePreset: preset, since, until })
        .then((json) => {
          if (generation !== fetchGenerationRef.current) return;
          if (json.error) {
            updateGroup(group.key, { error: json.error, loading: false });
          } else {
            updateGroup(group.key, { data: json, error: null, loading: false, fetchedAt: json.cachedAt });
            setCachedEntry(cacheKey, json);
          }
        })
        .catch((err) => {
          if (generation !== fetchGenerationRef.current) return;
          updateGroup(group.key, { error: err.message, loading: false });
        });
    }
  }

  useEffect(() => {
    if (!selectedAccountId) return;
    // Waits for the default-range effect above to resolve the saved
    // preference (or last_30d) before fetching anything, so there's no
    // wasted initial fetch for a range the user doesn't actually land on.
    if (!rangePreset) return;
    // Custom range waits for the user to hit Apply with both dates filled,
    // rather than firing a request on every keystroke in the date inputs.
    if (rangePreset === "custom" && !appliedCustomRange) return;

    const since = appliedCustomRange?.since;
    const until = appliedCustomRange?.until;
    const generation = ++fetchGenerationRef.current;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setGroups(Object.fromEntries(REPORT_GROUPS.map((g) => [g.key, initialGroupState()])));
    setExpandedCampaigns({});
    setExpandedAdsets({});
    runAllGroups(generation, selectedAccountId, { force: false, rangePreset, since, until });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runAllGroups is stable in spirit (deps are the args passed in); including it would just re-trigger on every render
  }, [selectedAccountId, rangePreset, appliedCustomRange]);

  function handleApplyCustomRange() {
    if (!customSince || !customUntil) return;
    setAppliedCustomRange({ since: customSince, until: customUntil });
  }

  function handleHardRefresh() {
    if (!selectedAccountId) return;
    const since = appliedCustomRange?.since;
    const until = appliedCustomRange?.until;
    const generation = ++fetchGenerationRef.current;
    runAllGroups(generation, selectedAccountId, { force: true, rangePreset, since, until });
  }

  function money(amount) {
    if (!currency) return amount.toFixed(2);
    try {
      return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(
        amount
      );
    } catch {
      return `${amount.toFixed(0)} ${currency}`;
    }
  }

  const METRIC_DEFS = {
    spend: { label: "Spend", format: money },
    purchases: { label: "Purchases", format: (v) => v.toFixed(0) },
    roas: { label: "ROAS", format: (v) => `${v.toFixed(2)}x` },
    ctr: { label: "CTR", format: (v) => `${v.toFixed(2)}%` },
    cvr: { label: "CVR", format: (v) => `${v.toFixed(2)}%` },
  };

  function openTrend(key) {
    setTrendMetric({ key, ...METRIC_DEFS[key] });
  }

  function toggleCampaign(id) {
    setExpandedCampaigns((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  function toggleAdset(id) {
    setExpandedAdsets((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  function jumpToCampaignInStructure(campaignId) {
    setExpandedCampaigns((prev) => ({ ...prev, [campaignId]: true }));
    document.getElementById("structure")?.scrollIntoView({ behavior: "smooth", block: "start" });
    window.requestAnimationFrame(() => {
      document.getElementById(`campaign-${campaignId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }

  function BudgetTypeBadge({ type }) {
    if (type === "CBO") return <span className={styles.pill}>CBO</span>;
    if (type === "ABO") return <span className={styles.badgeInfo}>ABO</span>;
    return <span className={styles.muted}>NO BUDGET</span>;
  }

  function StatusDot({ status }) {
    const color = status === "ACTIVE" ? "var(--green)" : status === "PAUSED" ? "var(--t3)" : "var(--red)";
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: color, flexShrink: 0 }} />
        <span style={{ fontSize: 11, fontWeight: 600, color: "var(--t2)" }}>{status}</span>
      </span>
    );
  }

  function expandAllStructure() {
    const campaigns = groups.core.data?.structure?.campaigns;
    if (!campaigns) return;
    const allCampaigns = {};
    const allAdsets = {};
    for (const c of campaigns) {
      allCampaigns[c.id] = true;
      for (const a of c.adsets) {
        allAdsets[a.id] = true;
      }
    }
    setExpandedCampaigns(allCampaigns);
    setExpandedAdsets(allAdsets);
  }

  function collapseAllStructure() {
    setExpandedCampaigns({});
    setExpandedAdsets({});
  }

  // Flattens the campaign → ad set → ad tree into Ads-Manager-style rows:
  // one indented table, consistent columns at every level, driven by the
  // current expand/collapse state. Siblings at each level are sorted by the
  // chosen metric (mapped to that level's field name) — the hierarchy stays
  // intact, only the order within each level changes. When a search term is
  // active, non-matching branches are dropped and matching ones are forced
  // open so the result is visible without a manual click.
  function buildStructureRows(campaigns) {
    const field = STRUCTURE_SORT_FIELD[structureSortKey];
    const { campaigns: visibleCampaigns, forceExpandIds } = filterStructureTree(campaigns, structureSearch);
    const isExpanded = (id) => (forceExpandIds ? forceExpandIds.has(id) : false) || !!expandedCampaigns[id];
    const isAdsetExpanded = (id) => (forceExpandIds ? forceExpandIds.has(id) : false) || !!expandedAdsets[id];

    const rows = [];
    const sortedCampaigns = sortByField(visibleCampaigns, field.campaign, structureSortDir);

    for (const c of sortedCampaigns) {
      const campaignExpanded = isExpanded(c.id);
      rows.push({
        key: `c-${c.id}`,
        anchorId: `campaign-${c.id}`,
        level: 0,
        hasChildren: c.adsets.length > 0,
        expanded: campaignExpanded,
        onToggle: () => toggleCampaign(c.id),
        name: c.name,
        thumbnailUrl: null,
        isVideo: false,
        countLabel: `${c.adsets.length} ad sets`,
        status: c.status,
        budgetText: c.budgetType === "CBO" ? money(c.dailyBudget) : c.budgetType === "ABO" ? "Ad set level" : "—",
        budgetBadge: c.budgetType,
        spend: c.spendInRange,
        purchases: c.purchasesInRange,
        roas: c.roasInRange,
        frequency: null,
        creativesText: c.additionalNeeded > 0 ? `${c.creativeCount} (+${c.additionalNeeded})` : `${c.creativeCount}`,
      });

      if (campaignExpanded) {
        const sortedAdsets = sortByField(c.adsets, field.adset, structureSortDir);
        for (const a of sortedAdsets) {
          const adsetExpanded = isAdsetExpanded(a.id);
          rows.push({
            key: `a-${a.id}`,
            level: 1,
            hasChildren: a.ads.length > 0,
            expanded: adsetExpanded,
            onToggle: () => toggleAdset(a.id),
            name: a.name,
            thumbnailUrl: null,
            isVideo: false,
            countLabel: `${a.ads.length} ads`,
            status: a.status,
            budgetText: c.budgetType === "ABO" ? money(a.dailyBudget) : "—",
            budgetBadge: null,
            spend: a.spendInRange,
            purchases: a.purchasesInRange,
            roas: a.roasInRange,
            frequency: null,
            creativesText:
              a.additionalNeeded > 0 ? `${a.creativeCount} (+${a.additionalNeeded})` : `${a.creativeCount}`,
          });

          if (adsetExpanded) {
            const sortedAds = sortByField(a.ads, field.ad, structureSortDir);
            for (const ad of sortedAds) {
              rows.push({
                key: `ad-${ad.id}`,
                level: 2,
                hasChildren: false,
                expanded: false,
                onToggle: null,
                name: ad.name,
                thumbnailUrl: ad.thumbnailUrl,
                isVideo: ad.isVideo,
                videoUrl: ad.videoUrl,
                countLabel: null,
                status: ad.status,
                budgetText: "—",
                budgetBadge: null,
                spend: ad.spend,
                purchases: ad.purchases,
                roas: ad.roas,
                frequency: ad.frequency,
                creativesText: "—",
              });
            }
          }
        }
      }
    }
    return rows;
  }

  // Available the moment account+range are resolved — doesn't wait on any
  // one section's fetch, so the date-range heading can render immediately.
  const dateRange = useMemo(
    () => resolveClientRange(rangePreset, appliedCustomRange?.since, appliedCustomRange?.until),
    [rangePreset, appliedCustomRange]
  );

  const canShowReport = !!selectedAccountId && !!rangePreset && (rangePreset !== "custom" || !!appliedCustomRange);
  const anyLoading = REPORT_GROUPS.some((g) => groups[g.key].loading);
  const allSettled = REPORT_GROUPS.every((g) => groups[g.key].data || groups[g.key].error);
  const pendingLabels = REPORT_GROUPS.filter((g) => !groups[g.key].data && !groups[g.key].error).map((g) => g.label);
  const latestFetchedAt = Math.max(0, ...REPORT_GROUPS.map((g) => groups[g.key].fetchedAt || 0)) || null;
  const allWarnings = REPORT_GROUPS.flatMap((g) => groups[g.key].data?.warnings || []);

  return (
    <Layout>
      <Head>
        <title>Account Handover Report · Facebook Auth Dashboard</title>
      </Head>
      <div className={styles.page}>
        <main className={styles.main} style={{ maxWidth: 1440, margin: "0 auto" }}>
          <div className={styles.sectionRow}>
            <h1 className={styles.h1}>Account Handover Report</h1>
            {accounts.length > 0 && (
              <AccountSelect accounts={accounts} value={selectedAccountId} onChange={setSelectedAccountId} style={{ minWidth: 240 }} />
            )}
          </div>

          {accounts.length > 0 && (
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: -4 }}>
              <span style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--t3)" }}>
                <CalendarIcon size={14} />
              </span>
              <div className={styles.tabGroup}>
                {RANGE_PRESETS.map((p) => (
                  <button
                    key={p.key}
                    className={rangePreset === p.key ? `${styles.tab} ${styles.tabActive}` : styles.tab}
                    onClick={() => setRangePreset(p.key)}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              {rangePreset === "custom" && (
                <>
                  <input
                    type="date"
                    className={styles.select}
                    value={customSince}
                    max={customUntil || undefined}
                    onChange={(e) => setCustomSince(e.target.value)}
                  />
                  <span className={styles.muted}>to</span>
                  <input
                    type="date"
                    className={styles.select}
                    value={customUntil}
                    min={customSince || undefined}
                    onChange={(e) => setCustomUntil(e.target.value)}
                  />
                  <button
                    className={styles.btnPrimary}
                    onClick={handleApplyCustomRange}
                    disabled={!customSince || !customUntil}
                  >
                    Apply
                  </button>
                </>
              )}
              <button
                type="button"
                className={styles.btnSecondary}
                onClick={() => setShowDefaultRangeModal(true)}
                title="Set the date range the report opens to by default"
              >
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <SettingsIcon size={13} />
                  Default: {RANGE_PRESETS.find((p) => p.key === defaultRangePreset)?.label || "Last 30 Days"}
                </span>
              </button>
            </div>
          )}

          {accountsError && <div className={styles.error}>Error loading ad accounts: {accountsError}</div>}
          {!accountsError && accounts.length === 0 && !anyLoading && (
            <p className={styles.sub}>No Ad Accounts found, or permission not granted.</p>
          )}

          {canShowReport && (
            <>
              <div className={styles.sectionRow} style={{ marginTop: -8 }}>
                <p className={styles.sub} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <span>
                    {dateRange.label}: {dateRange.since} → {dateRange.until}
                  </span>
                  {!allSettled ? (
                    <Loader
                      inline
                      label={pendingLabels.length > 0 ? `Loading ${pendingLabels.join(", ")}…` : "Loading…"}
                    />
                  ) : (
                    latestFetchedAt && <span>· updated {formatAge(now - latestFetchedAt)}</span>
                  )}
                </p>
                <button className={styles.btnSecondary} onClick={handleHardRefresh} disabled={anyLoading}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <RefreshIcon size={13} />
                    {anyLoading ? "Refreshing…" : "Hard Refresh"}
                  </span>
                </button>
              </div>

              <div className={styles.reportLayout}>
                <SectionNav sections={SECTIONS} />

                <div className={styles.reportContent} style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                {allWarnings.length > 0 && (
                  <div className={styles.card} style={{ borderColor: "rgba(245,158,11,.25)" }}>
                    <h2 className={styles.h2}>Some data could not be loaded</h2>
                    <ul className={styles.list}>
                      {allWarnings.map((w, i) => (
                        <li key={i} className={styles.sub}>
                          · {w}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Overview */}
                <SectionGate group={groups.headline} loadingLabel="Loading overview…">
                  {(data) => (
                    <section id="overview">
                      <h2 className={styles.h2}>{dateRange.label}</h2>
                      <p className={styles.sub} style={{ marginBottom: 10 }}>
                        Click any metric to see its {data.trend.granularity} trend.
                      </p>
                      <div className={styles.statBar}>
                        <Stat label="Spend" value={money(data.overview.spend)} onClick={() => openTrend("spend")} />
                        <Stat
                          label="Purchases"
                          value={data.overview.purchases.toFixed(0)}
                          onClick={() => openTrend("purchases")}
                        />
                        <Stat label="ROAS" value={`${data.overview.roas.toFixed(2)}x`} onClick={() => openTrend("roas")} />
                        <Stat label="CTR" value={`${data.overview.ctr.toFixed(2)}%`} onClick={() => openTrend("ctr")} />
                        <Stat label="CVR" value={`${data.overview.cvr.toFixed(2)}%`} onClick={() => openTrend("cvr")} />
                      </div>
                    </section>
                  )}
                </SectionGate>

                {/* Best week / month */}
                <SectionGate group={groups.headline} loadingLabel="Loading best week/month…">
                  {(data) => (
                    <section id="trends">
                      <p className={styles.sub} style={{ marginBottom: 10 }}>
                        Fixed 90-day/6-month lookback for historical context — independent of the date range selected
                        above.
                      </p>
                      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                      <div className={styles.card} style={{ flex: 1, minWidth: 260 }}>
                        <h2 className={styles.h2}>Best Week (ROAS, last 90 days)</h2>
                        {data.bestWeek ? (
                          <>
                            <p className={styles.statValue}>{data.bestWeek.roas.toFixed(2)}x</p>
                            <p className={styles.sub}>
                              {data.bestWeek.since} → {data.bestWeek.until} · spend {money(data.bestWeek.spend)}
                            </p>
                          </>
                        ) : (
                          <p className={styles.sub}>No weeks with spend in this window.</p>
                        )}
                      </div>
                      <div className={styles.card} style={{ flex: 1, minWidth: 260 }}>
                        <h2 className={styles.h2}>Best Month (ROAS, last 6 months)</h2>
                        {data.bestMonth ? (
                          <>
                            <p className={styles.statValue}>{data.bestMonth.roas.toFixed(2)}x</p>
                            <p className={styles.sub}>
                              {data.bestMonth.since} → {data.bestMonth.until} · spend{" "}
                              {money(data.bestMonth.spend)}
                            </p>
                          </>
                        ) : (
                          <p className={styles.sub}>No months with spend in this window.</p>
                        )}
                      </div>
                      </div>
                    </section>
                  )}
                </SectionGate>

                {/* Top spending campaigns */}
                <SectionGate group={groups.core} loadingLabel="Loading top campaigns…">
                  {(data) => (
                    <section id="top-campaigns" className={styles.card}>
                      <h2 className={styles.h2}>Top Spending Campaigns ({dateRange.label})</h2>
                      <p className={styles.sub} style={{ marginBottom: 12 }}>
                        Click a row to jump to it in Account Structure.
                      </p>
                      <SortableTable
                        defaultSortKey="spend"
                        maxHeight={360}
                        searchable
                        searchPlaceholder="Search campaigns…"
                        emptyMessage="No campaign spend in this window."
                        rows={data.topCampaigns}
                        onRowClick={(r) => jumpToCampaignInStructure(r.id)}
                        columns={[
                          { key: "name", label: "Campaign", maxWidth: NAME_COL_WIDTH },
                          { key: "spend", label: "Spend", align: "right", render: (r) => money(r.spend) },
                          { key: "revenue", label: "Revenue", align: "right", render: (r) => money(r.revenue) },
                          {
                            key: "revenueSharePct",
                            label: "% Revenue",
                            align: "right",
                            render: (r) => `${r.revenueSharePct.toFixed(1)}%`,
                          },
                          { key: "roas", label: "ROAS", align: "right", render: (r) => `${r.roas.toFixed(2)}x` },
                        ]}
                      />
                    </section>
                  )}
                </SectionGate>

                {/* 80% pareto */}
                <SectionGate group={groups.core} loadingLabel="Loading revenue concentration…">
                  {(data) => (
                    <section id="pareto" className={styles.card}>
                      <h2 className={styles.h2}>Where 80% of Purchase Revenue Comes From</h2>
                      {data.pareto.totalAdCount === 0 ? (
                        <p className={styles.sub}>No ad-level purchase data in this window.</p>
                      ) : (
                        <>
                          <p className={styles.sub} style={{ marginBottom: 12 }}>
                            <strong style={{ color: "var(--t1)" }}>
                              {data.pareto.contributorCount} of {data.pareto.totalAdCount} ads
                            </strong>{" "}
                            ({data.pareto.revenueSharePct.toFixed(0)}% of purchase revenue) account for{" "}
                            <strong style={{ color: "var(--t1)" }}>
                              {data.pareto.spendSharePct.toFixed(0)}% of spend
                            </strong>
                            .
                          </p>
                          <SortableTable
                            defaultSortKey="revenue"
                            maxHeight={360}
                            searchable
                            searchPlaceholder="Search creatives…"
                            rows={data.pareto.contributors}
                            columns={[
                              {
                                key: "name",
                                label: "Creative",
                                render: (r) => <CreativeCell ad={r} onOpen={setLightboxItem} />,
                              },
                              {
                                key: "status",
                                label: "Status",
                                render: (r) => (r.status ? <StatusDot status={r.status} /> : <span className={styles.muted}>—</span>),
                              },
                              {
                                key: "campaignName",
                                label: "Campaign",
                                maxWidth: 180,
                                render: (r) => <span className={styles.muted}>{r.campaignName}</span>,
                              },
                              { key: "spend", label: "Spend", align: "right", render: (r) => money(r.spend) },
                              { key: "revenue", label: "Revenue", align: "right", render: (r) => money(r.revenue) },
                              {
                                key: "revenueSharePct",
                                label: "% Revenue",
                                align: "right",
                                render: (r) => `${r.revenueSharePct.toFixed(1)}%`,
                              },
                              { key: "roas", label: "ROAS", align: "right", render: (r) => `${r.roas.toFixed(2)}x` },
                              { key: "purchases", label: "Purchases", align: "right", render: (r) => r.purchases.toFixed(0) },
                            ]}
                          />
                        </>
                      )}
                    </section>
                  )}
                </SectionGate>

                {/* Where 80% of purchase revenue comes from, by age/gender */}
                <SectionGate group={groups.ageGender} loadingLabel="Loading age/gender breakdown…">
                  {(data) => (
                    <BreakdownSection
                      id="age-gender"
                      title="Where 80% of Purchase Revenue Comes From — Age & Gender"
                      data={data.purchasesByAgeGender}
                      labelHeader="Age · Gender"
                      searchPlaceholder="Search age/gender…"
                      emptyMessage="No age/gender breakdown data in this window."
                      money={money}
                    />
                  )}
                </SectionGate>

                {/* Where 80% of spend goes, by state — Facebook doesn't return purchase revenue broken down by
                    region for this account (a Meta Aggregated Event Measurement restriction on geographic
                    breakdowns for web conversions, confirmed directly — not something fixable here), so this is a
                    spend pareto rather than the revenue one every other breakdown uses. */}
                <SectionGate group={groups.region} loadingLabel="Loading state breakdown…">
                  {(data) => (
                    <section id="region" className={styles.card}>
                      <h2 className={styles.h2}>Where 80% of Ad Spend Goes — State</h2>
                      <p className={styles.sub} style={{ marginBottom: 12 }}>
                        Facebook returns spend by state for this account, but never returns purchase revenue broken
                        down by state — the per-state rows carry engagement data (clicks, video views, etc.) but no
                        purchase action, even though the account has plenty of purchases overall (see Age & Gender or
                        Pareto above, which do carry it). That&apos;s a known Meta platform limitation — Aggregated
                        Event Measurement commonly excludes geographic breakdowns from web conversion event
                        reporting — not something this app can fetch around, so here&apos;s spend concentration
                        instead.
                      </p>
                      {data.spendByRegion.totalGroupCount === 0 ? (
                        <p className={styles.sub}>No region breakdown data in this window (not available for every country).</p>
                      ) : (
                        <>
                          <p className={styles.sub} style={{ marginBottom: 12 }}>
                            <strong style={{ color: "var(--t1)" }}>
                              {data.spendByRegion.contributorCount} of {data.spendByRegion.totalGroupCount} states
                            </strong>{" "}
                            account for <strong style={{ color: "var(--t1)" }}>{data.spendByRegion.spendSharePct.toFixed(0)}% of spend</strong>.
                          </p>
                          <SortableTable
                            defaultSortKey="spend"
                            maxHeight={360}
                            searchable={data.spendByRegion.contributors.length > 6}
                            searchKeys={["label"]}
                            searchPlaceholder="Search states…"
                            rows={data.spendByRegion.contributors}
                            columns={[
                              { key: "label", label: "State", maxWidth: 220 },
                              { key: "spend", label: "Spend", align: "right", render: (r) => money(r.spend) },
                              {
                                key: "spendSharePct",
                                label: "% Spend",
                                align: "right",
                                render: (r) => `${r.spendSharePct.toFixed(1)}%`,
                              },
                            ]}
                          />
                        </>
                      )}
                    </section>
                  )}
                </SectionGate>

                {/* Full purchase split by creative type — only 3 possible groups, so no 80% cutoff */}
                <SectionGate group={groups.core} loadingLabel="Loading creative type breakdown…">
                  {(data) => (
                    <BreakdownSection
                      id="creative-type"
                      title="Purchases by Creative Type"
                      data={data.purchasesByCreativeType}
                      labelHeader="Creative Type"
                      showSummary={false}
                      emptyMessage="No creative-level purchase data in this window."
                      money={money}
                    />
                  )}
                </SectionGate>

                {/* Where 80% of purchase revenue comes from, by platform + placement */}
                <SectionGate group={groups.placement} loadingLabel="Loading platform & placement breakdown…">
                  {(data) => (
                    <BreakdownSection
                      id="placement"
                      title="Where 80% of Purchase Revenue Comes From — Platform & Placement"
                      data={data.purchasesByPlacement}
                      labelHeader="Placement"
                      searchPlaceholder="Search placements…"
                      emptyMessage="No placement breakdown data in this window."
                      money={money}
                    />
                  )}
                </SectionGate>

                {/* Where 80% of purchase revenue comes from, by product — reverse-engineered from each ad's landing URL */}
                <SectionGate group={groups.core} loadingLabel="Loading product breakdown…">
                  {(data) => (
                    <section id="product" className={styles.card}>
                      <h2 className={styles.h2}>Where 80% of Purchase Revenue Comes From — Product</h2>
                      <p className={styles.sub} style={{ marginBottom: 12 }}>
                        Facebook has no native per-product revenue breakdown outside catalog reporting, so this is
                        derived from each ad&apos;s landing page URL (e.g. a Shopify-style <code>/products/handle</code>{" "}
                        path becomes the product name) — resolved from the ad&apos;s own creative, or from the
                        underlying Page post for ads built by boosting an existing post (common for video/Reels ads).
                        Catalog/Dynamic ads have no single fixed URL — Facebook generates the real destination per
                        product at serve time — so their revenue shows as its own &quot;Catalog / Dynamic
                        creative&quot; row instead of being dropped. A &quot;Unknown landing page&quot; row means
                        neither lookup found a URL (e.g. the underlying post is on a Page this login doesn&apos;t
                        have read access to, or was deleted) — shown only once it accounts for more than 10% of
                        spend, since below that it&apos;s rarely worth the clutter; past it, worth checking which ads
                        fall into it in Ads Manager directly.
                      </p>
                      {data.purchasesByProduct.totalGroupCount === 0 ? (
                        <p className={styles.sub}>No ad-level purchase data in this window.</p>
                      ) : (
                        <>
                          <p className={styles.sub} style={{ marginBottom: 12 }}>
                            <strong style={{ color: "var(--t1)" }}>
                              {data.purchasesByProduct.contributorCount} of{" "}
                              {data.purchasesByProduct.totalGroupCount} products/pages
                            </strong>{" "}
                            ({data.purchasesByProduct.revenueSharePct.toFixed(0)}% of purchase revenue) account for{" "}
                            <strong style={{ color: "var(--t1)" }}>
                              {data.purchasesByProduct.spendSharePct.toFixed(0)}% of spend
                            </strong>
                            .
                          </p>
                          <SortableTable
                            defaultSortKey="revenue"
                            maxHeight={360}
                            searchable={data.purchasesByProduct.contributors.length > 6}
                            searchKeys={["label"]}
                            searchPlaceholder="Search products…"
                            rows={data.purchasesByProduct.contributors}
                            columns={[
                              { key: "label", label: "Product / Landing Page", maxWidth: 240 },
                              { key: "spend", label: "Spend", align: "right", render: (r) => money(r.spend) },
                              { key: "revenue", label: "Revenue", align: "right", render: (r) => money(r.revenue) },
                              {
                                key: "revenueSharePct",
                                label: "% Revenue",
                                align: "right",
                                render: (r) => `${r.revenueSharePct.toFixed(1)}%`,
                              },
                              { key: "roas", label: "ROAS", align: "right", render: (r) => `${r.roas.toFixed(2)}x` },
                              {
                                key: "purchases",
                                label: "Purchases",
                                align: "right",
                                render: (r) => r.purchases.toFixed(0),
                              },
                            ]}
                          />
                        </>
                      )}
                      {data.unresolvedLandingPageAds?.length > 0 &&
                        data.purchasesByProduct.contributors.some((c) => c.label === "Unknown landing page") && (
                        <div style={{ marginTop: 20 }}>
                          <h2 className={styles.h2} style={{ fontSize: 13 }}>
                            Ads behind &quot;Unknown landing page&quot; (highest spend first)
                          </h2>
                          <p className={styles.sub} style={{ marginBottom: 12 }}>
                            Showing up to 50. Click through to Ads Manager to check each ad&apos;s destination directly.
                          </p>
                          <SortableTable
                            defaultSortKey="spend"
                            maxHeight={300}
                            searchable={data.unresolvedLandingPageAds.length > 6}
                            searchKeys={["name"]}
                            searchPlaceholder="Search ads…"
                            rows={data.unresolvedLandingPageAds}
                            columns={[
                              {
                                key: "name",
                                label: "Ad",
                                maxWidth: 220,
                                render: (r) => (
                                  <a
                                    href={`https://www.facebook.com/adsmanager/manage/ads?act=${selectedAccountId.replace(
                                      /^act_/,
                                      ""
                                    )}&selected_ad_ids=${r.id}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    style={{ color: "var(--purple)" }}
                                  >
                                    {r.name}
                                  </a>
                                ),
                              },
                              { key: "id", label: "Ad ID" },
                              {
                                key: "campaignName",
                                label: "Campaign",
                                maxWidth: 180,
                                render: (r) => <span className={styles.muted}>{r.campaignName}</span>,
                              },
                              { key: "creativeType", label: "Type" },
                              { key: "spend", label: "Spend", align: "right", render: (r) => money(r.spend) },
                            ]}
                          />
                        </div>
                      )}
                    </section>
                  )}
                </SectionGate>

                {/* Pixel health */}
                <SectionGate group={groups.pixelHealth} loadingLabel="Loading pixel health…">
                  {(data) => (
                    <section id="pixel-health" className={styles.card}>
                      <h2 className={styles.h2}>Pixel Event Health</h2>
                      {data.pixelHealth.pixels.length === 0 && data.pixelHealth.concerns.length === 0 ? (
                        <p className={styles.sub}>No pixel data available.</p>
                      ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                          {data.pixelHealth.pixels.map((p) => (
                            <div key={p.id} className={styles.listItem}>
                              {p.name}
                              <span
                                className={
                                  p.status === "healthy"
                                    ? styles.badgeGood
                                    : p.status === "stale"
                                    ? styles.badgeWarn
                                    : styles.badgeDanger
                                }
                              >
                                {p.status === "healthy"
                                  ? "Firing normally"
                                  : p.status === "stale"
                                  ? `Stale (${p.daysSinceFired.toFixed(1)}d)`
                                  : "Never fired"}
                              </span>
                            </div>
                          ))}
                          {data.pixelHealth.concerns
                            .filter((c) => c.status === "missing")
                            .map((c, i) => (
                              <div key={`missing-${i}`} className={styles.listItem}>
                                {c.name}
                                <span className={styles.badgeDanger}>Missing</span>
                              </div>
                            ))}
                        </div>
                      )}
                    </section>
                  )}
                </SectionGate>

                {/* Account structure: campaign → ad set → ad drill-down */}
                <SectionGate group={groups.core} loadingLabel="Loading account structure…">
                  {(data) => (
                    <section id="structure" className={styles.card}>
                      <div className={styles.sectionRow}>
                        <div>
                          <h2 className={styles.h2} style={{ marginBottom: 2 }}>
                            Account Structure ({data.structure.campaignCount} campaigns, {data.structure.adsetCount}{" "}
                            ad sets)
                          </h2>
                          <p className={styles.sub}>
                            Only campaigns/ad sets with spend in the selected range ({dateRange.label}) are shown.
                          </p>
                        </div>
                        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                          <div style={{ position: "relative" }}>
                            <span
                              style={{
                                position: "absolute",
                                left: 11,
                                top: "50%",
                                transform: "translateY(-50%)",
                                color: "var(--t3)",
                                pointerEvents: "none",
                              }}
                            >
                              <SearchIcon size={13} />
                            </span>
                            <input
                              type="text"
                              className={styles.select}
                              placeholder="Search campaigns, ad sets, ads…"
                              value={structureSearch}
                              onChange={(e) => setStructureSearch(e.target.value)}
                              style={{ width: 220, paddingLeft: 30 }}
                            />
                          </div>
                          <span className={styles.muted}>Sort by</span>
                          <select
                            className={styles.select}
                            value={structureSortKey}
                            onChange={(e) => setStructureSortKey(e.target.value)}
                          >
                            {STRUCTURE_SORT_OPTIONS.map((opt) => (
                              <option key={opt.key} value={opt.key}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                          <button
                            className={styles.btnSecondary}
                            onClick={() => setStructureSortDir((d) => (d === "asc" ? "desc" : "asc"))}
                          >
                            {structureSortDir === "asc" ? "▲ Asc" : "▼ Desc"}
                          </button>
                          <button className={styles.btnSecondary} onClick={expandAllStructure}>
                            Expand All
                          </button>
                          <button className={styles.btnSecondary} onClick={collapseAllStructure}>
                            Collapse All
                          </button>
                        </div>
                      </div>
                      {data.structure.campaigns.length === 0 ? (
                        <p className={styles.sub}>No campaigns with spend in this window.</p>
                      ) : buildStructureRows(data.structure.campaigns).length === 0 ? (
                        <p className={styles.sub}>No matches for &quot;{structureSearch}&quot;.</p>
                      ) : (
                        <div className={styles.tableScroll} style={{ maxHeight: 520 }}>
                          <table className={styles.table}>
                            <thead>
                              <tr>
                                <th>Name</th>
                                <th>Status</th>
                                <th style={{ textAlign: "right" }}>Budget</th>
                                <th style={{ textAlign: "right" }}>Spend</th>
                                <th style={{ textAlign: "right" }}>Purchases</th>
                                <th style={{ textAlign: "right" }}>ROAS</th>
                                <th style={{ textAlign: "right" }}>Frequency</th>
                                <th style={{ textAlign: "right" }}>Creatives</th>
                              </tr>
                            </thead>
                            <tbody>
                              {buildStructureRows(data.structure.campaigns).map((row) => (
                                <tr
                                  key={row.key}
                                  id={row.anchorId}
                                  onClick={row.onToggle || undefined}
                                  style={row.onToggle ? { cursor: "pointer" } : undefined}
                                >
                                  <td>
                                    <div
                                      style={{
                                        display: "flex",
                                        alignItems: "flex-start",
                                        gap: 6,
                                        paddingLeft: row.level * 20,
                                        maxWidth: NAME_COL_WIDTH + row.level * 20,
                                        overflow: "hidden",
                                      }}
                                    >
                                      <span style={{ width: 14, display: "inline-block", color: "var(--t3)", flexShrink: 0 }}>
                                        {row.hasChildren ? (row.expanded ? "▾" : "▸") : ""}
                                      </span>
                                      {row.level === 2 && (
                                        <Thumb
                                          src={row.thumbnailUrl}
                                          size={24}
                                          isVideo={row.isVideo}
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setLightboxItem(row);
                                          }}
                                        />
                                      )}
                                      <span
                                        title={row.name}
                                        className={styles.clamp3}
                                        style={{
                                          fontWeight: row.level === 0 ? 700 : row.level === 1 ? 600 : 400,
                                          color: row.level === 2 ? "var(--t2)" : "var(--t1)",
                                          minWidth: 0,
                                          flex: "1 1 auto",
                                        }}
                                      >
                                        {row.name}
                                      </span>
                                      {row.countLabel && (
                                        <span className={styles.muted} style={{ flexShrink: 0 }}>
                                          ({row.countLabel})
                                        </span>
                                      )}
                                      {row.budgetBadge && <BudgetTypeBadge type={row.budgetBadge} />}
                                    </div>
                                  </td>
                                  <td>{row.status ? <StatusDot status={row.status} /> : <span className={styles.muted}>—</span>}</td>
                                  <td style={{ textAlign: "right" }}>{row.budgetText}</td>
                                  <td style={{ textAlign: "right" }}>{money(row.spend)}</td>
                                  <td style={{ textAlign: "right" }}>{row.purchases.toFixed(0)}</td>
                                  <td style={{ textAlign: "right" }}>{row.roas.toFixed(2)}x</td>
                                  <td style={{ textAlign: "right" }}>
                                    {row.frequency != null ? row.frequency.toFixed(2) : "—"}
                                  </td>
                                  <td style={{ textAlign: "right" }}>{row.creativesText}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </section>
                  )}
                </SectionGate>

                {/* High frequency ads */}
                <SectionGate group={groups.core} loadingLabel="Loading high-frequency ads…">
                  {(data) => (
                    <section id="high-frequency" className={styles.card}>
                      <h2 className={styles.h2}>High-Frequency Ads (&gt;3, excluding retargeting)</h2>
                      <p className={styles.sub} style={{ marginBottom: 12 }}>
                        Frequency here is per-ad over {dateRange.label.toLowerCase()} ({dateRange.since} →{" "}
                        {dateRange.until}) — it will not match a campaign- or ad-set-level frequency column in Ads
                        Manager, since reach is deduplicated differently at each level. Compare against Ads
                        Manager&apos;s own per-ad frequency for the same dates.
                      </p>
                      <SortableTable
                        defaultSortKey="frequency"
                        maxHeight={360}
                        searchable
                        searchPlaceholder="Search ads…"
                        emptyMessage="No ads over frequency 3 outside retargeting campaigns/ad sets."
                        rows={data.highFrequencyAds}
                        columns={[
                          { key: "name", label: "Ad", render: (r) => <CreativeCell ad={r} onOpen={setLightboxItem} /> },
                          {
                            key: "status",
                            label: "Status",
                            render: (r) => (r.status ? <StatusDot status={r.status} /> : <span className={styles.muted}>—</span>),
                          },
                          {
                            key: "campaignName",
                            label: "Campaign",
                            maxWidth: 180,
                            render: (r) => <span className={styles.muted}>{r.campaignName}</span>,
                          },
                          {
                            key: "adsetName",
                            label: "Ad Set",
                            maxWidth: 180,
                            render: (r) => <span className={styles.muted}>{r.adsetName}</span>,
                          },
                          {
                            key: "frequency",
                            label: "Frequency",
                            align: "right",
                            render: (r) => <span className={styles.badgeWarn}>{r.frequency.toFixed(2)}</span>,
                          },
                        ]}
                      />
                    </section>
                  )}
                </SectionGate>

                {/* Budget utilization, split by CBO / ABO */}
                <SectionGate group={groups.core} loadingLabel="Loading budget utilization…">
                  {(data) => (
                    <section id="budget-utilization" className={styles.card}>
                      <h2 className={styles.h2}>Budget Utilization &amp; Creative Count</h2>
                      <p className={styles.sub} style={{ marginBottom: 12 }}>
                        CBO campaigns are judged at the campaign level; ABO campaigns are judged ad set by ad set,
                        since that is where the budget actually lives. Rows under 100% utilization are flagged — for
                        those, we take the avg daily spend split across its existing creatives (Avg Spend/Creative)
                        and work out how many creatives, at that same rate, it would take to spend the full daily
                        budget (Additional Needed). Fully-utilized rows show no recommendation — there&apos;s no
                        unspent budget left for extra creatives to unlock. Sort by Utilization to find underspend, or
                        by Additional Needed to find creative gaps.
                      </p>

                      <div className={styles.tabGroup} style={{ marginBottom: 14 }}>
                        <button
                          className={budgetTab === "CBO" ? `${styles.tab} ${styles.tabActive}` : styles.tab}
                          onClick={() => setBudgetTab("CBO")}
                        >
                          CBO Campaigns ({data.budgetUtilization.cboCampaigns.length})
                        </button>
                        <button
                          className={budgetTab === "ABO" ? `${styles.tab} ${styles.tabActive}` : styles.tab}
                          onClick={() => setBudgetTab("ABO")}
                        >
                          ABO Ad Sets ({data.budgetUtilization.aboAdsets.length})
                        </button>
                      </div>

                      {budgetTab === "CBO" ? (
                        <SortableTable
                          defaultSortKey="utilizationPct"
                          defaultSortDir="asc"
                          maxHeight={360}
                          searchable
                          searchPlaceholder="Search campaigns…"
                          emptyMessage="No active CBO campaigns."
                          rows={data.budgetUtilization.cboCampaigns}
                          rowClassName={(r) => (r.utilizationPct != null && r.utilizationPct < 100 ? styles.rowUnderutilized : undefined)}
                          columns={[
                            { key: "name", label: "Campaign", maxWidth: NAME_COL_WIDTH },
                            {
                              key: "dailyBudget",
                              label: "Daily Budget",
                              align: "right",
                              render: (r) => (r.dailyBudget != null ? money(r.dailyBudget) : "—"),
                            },
                            { key: "avgDailySpend7d", label: "Avg Daily Spend (7d)", align: "right", render: (r) => money(r.avgDailySpend7d) },
                            {
                              key: "utilizationPct",
                              label: "Utilization",
                              align: "right",
                              render: (r) =>
                                r.utilizationPct == null ? (
                                  "—"
                                ) : (
                                  <span className={r.utilizationPct < 100 ? styles.badgeWarn : styles.badgeGood}>
                                    {r.utilizationPct.toFixed(0)}%
                                  </span>
                                ),
                            },
                            { key: "creativeCount", label: "Creatives", align: "right" },
                            {
                              key: "avgSpendPerCreative",
                              label: "Avg Spend/Creative",
                              align: "right",
                              render: (r) => (r.avgSpendPerCreative != null ? money(r.avgSpendPerCreative) : "—"),
                            },
                            {
                              key: "recommendedCreatives",
                              label: "Recommended",
                              align: "right",
                              render: (r) => (r.recommendedCreatives != null ? r.recommendedCreatives : "—"),
                            },
                            {
                              key: "additionalNeeded",
                              label: "Additional Needed",
                              align: "right",
                              render: (r) =>
                                r.additionalNeeded > 0 ? (
                                  <span className={styles.badgeWarn}>+{r.additionalNeeded}</span>
                                ) : (
                                  "—"
                                ),
                            },
                          ]}
                        />
                      ) : (
                        <SortableTable
                          defaultSortKey="utilizationPct"
                          defaultSortDir="asc"
                          maxHeight={360}
                          searchable
                          searchPlaceholder="Search ad sets…"
                          emptyMessage="No active ad sets in ABO campaigns."
                          rows={data.budgetUtilization.aboAdsets}
                          rowClassName={(r) => (r.utilizationPct != null && r.utilizationPct < 100 ? styles.rowUnderutilized : undefined)}
                          columns={[
                            { key: "name", label: "Ad Set", maxWidth: NAME_COL_WIDTH },
                            {
                              key: "campaignName",
                              label: "Campaign",
                              maxWidth: 180,
                              render: (r) => <span className={styles.muted}>{r.campaignName}</span>,
                            },
                            {
                              key: "dailyBudget",
                              label: "Daily Budget",
                              align: "right",
                              render: (r) => (r.dailyBudget != null ? money(r.dailyBudget) : "—"),
                            },
                            { key: "avgDailySpend7d", label: "Avg Daily Spend (7d)", align: "right", render: (r) => money(r.avgDailySpend7d) },
                            {
                              key: "utilizationPct",
                              label: "Utilization",
                              align: "right",
                              render: (r) =>
                                r.utilizationPct == null ? (
                                  "—"
                                ) : (
                                  <span className={r.utilizationPct < 100 ? styles.badgeWarn : styles.badgeGood}>
                                    {r.utilizationPct.toFixed(0)}%
                                  </span>
                                ),
                            },
                            { key: "creativeCount", label: "Creatives", align: "right" },
                            {
                              key: "avgSpendPerCreative",
                              label: "Avg Spend/Creative",
                              align: "right",
                              render: (r) => (r.avgSpendPerCreative != null ? money(r.avgSpendPerCreative) : "—"),
                            },
                            {
                              key: "recommendedCreatives",
                              label: "Recommended",
                              align: "right",
                              render: (r) => (r.recommendedCreatives != null ? r.recommendedCreatives : "—"),
                            },
                            {
                              key: "additionalNeeded",
                              label: "Additional Needed",
                              align: "right",
                              render: (r) =>
                                r.additionalNeeded > 0 ? (
                                  <span className={styles.badgeWarn}>+{r.additionalNeeded}</span>
                                ) : (
                                  "—"
                                ),
                            },
                          ]}
                        />
                      )}
                    </section>
                  )}
                </SectionGate>
                </div>
              </div>
            </>
          )}
        </main>
      </div>
      <CreativeLightbox item={lightboxItem} onClose={() => setLightboxItem(null)} />
      <MetricTrendModal
        metric={trendMetric}
        trend={groups.headline.data?.trend}
        rangeLabel={dateRange.label}
        onClose={() => setTrendMetric(null)}
      />
      <DefaultRangeModal
        open={showDefaultRangeModal}
        current={defaultRangePreset}
        onSelect={handleSelectDefaultRange}
        onClose={() => setShowDefaultRangeModal(false)}
      />
    </Layout>
  );
}

function Stat({ label, value, onClick }) {
  if (!onClick) {
    return (
      <div className={styles.stat}>
        <p className={styles.statLabel}>{label}</p>
        <p className={styles.statValue}>{value}</p>
      </div>
    );
  }

  return (
    <button type="button" onClick={onClick} className={styles.stat} style={{ cursor: "pointer" }}>
      <p className={styles.statLabel} style={{ display: "flex", alignItems: "center", gap: 4 }}>
        {label}
        <ChartIcon size={11} />
      </p>
      <p className={styles.statValue}>{value}</p>
    </button>
  );
}

export async function getServerSideProps(context) {
  const session = await getServerSession(context.req, context.res, authOptions);

  if (!session) {
    return { redirect: { destination: "/", permanent: false } };
  }

  return { props: {} };
}
