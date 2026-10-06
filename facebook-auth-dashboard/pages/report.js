import Head from "next/head";
import { getServerSession } from "next-auth/next";
import { useEffect, useRef, useState } from "react";
import { authOptions } from "./api/auth/[...nextauth]";
import Nav from "@/components/Nav";
import SectionNav from "@/components/SectionNav";
import SortableTable from "@/components/SortableTable";
import Thumb from "@/components/Thumb";
import CreativeLightbox from "@/components/CreativeLightbox";
import MetricTrendModal from "@/components/MetricTrendModal";
import Loader from "@/components/Loader";
import DefaultRangeModal from "@/components/DefaultRangeModal";
import { RefreshIcon, SearchIcon, CalendarIcon, ChartIcon, SettingsIcon } from "@/components/icons";
import { getLastAccountId, setLastAccountId, getDefaultRangePreset, setDefaultRangePreset } from "@/lib/clientStorage";
import styles from "@/styles/Home.module.css";

// How long a report payload for a given (account, range) stays usable in the
// browser tab without re-hitting the API at all — separate from, and in
// addition to, the server's own 30-min cache (lib/reportCache.js). This is
// what makes flipping Last 7 Days -> Last 30 Days -> back to Last 7 Days an
// instant, no-network operation instead of a fresh request every time.
const CLIENT_CACHE_TTL_MS = 30 * 60 * 1000;

function clientCacheKey(accountId, rangePreset, since, until) {
  return `${accountId}:${rangePreset}:${since || ""}:${until || ""}`;
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

async function fetchReportData(accountId, { force, rangePreset, since, until } = {}) {
  const params = new URLSearchParams({ accountId, rangePreset: rangePreset || "last_30d" });
  if (force) params.set("force", "true");
  if (rangePreset === "custom" && since && until) {
    params.set("since", since);
    params.set("until", until);
  }
  const res = await fetch(`/api/fb/report?${params.toString()}`);
  return res.json();
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
  const [accounts, setAccounts] = useState([]);
  const [accountsError, setAccountsError] = useState(null);
  const [selectedAccountId, setSelectedAccountId] = useState("");

  const [report, setReport] = useState(null);
  const [reportError, setReportError] = useState(null);
  const [reportLoading, setReportLoading] = useState(false);

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

  // In-memory per-tab cache of report payloads, keyed by account+range, so
  // switching back to a range already seen in this tab within the last 30
  // minutes shows instantly with no API call. A ref (not state) since
  // writing to it should never itself trigger a re-render.
  const reportCacheRef = useRef(new Map());

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(interval);
  }, []);

  const currency = accounts.find((a) => a.id === selectedAccountId)?.currency;

  useEffect(() => {
    fetch("/api/fb/data")
      .then((res) => res.json())
      .then((json) => {
        if (json.error) {
          setAccountsError(json.error);
        } else {
          setAccounts(json.adAccounts || []);
          if (json.adAccounts?.length) {
            const lastId = getLastAccountId();
            const stillExists = json.adAccounts.some((a) => a.id === lastId);
            setSelectedAccountId(stillExists ? lastId : json.adAccounts[0].id);
          }
        }
      })
      .catch((err) => setAccountsError(err.message));
  }, []);

  useEffect(() => {
    if (!selectedAccountId) return;
    // Waits for the default-range effect above to resolve the saved
    // preference (or last_30d) before fetching anything, so there's no
    // wasted initial fetch for a range the user doesn't actually land on.
    if (!rangePreset) return;
    // Custom range waits for the user to hit Apply with both dates filled,
    // rather than firing a request on every keystroke in the date inputs.
    if (rangePreset === "custom" && !appliedCustomRange) return;

    setLastAccountId(selectedAccountId);

    const since = appliedCustomRange?.since;
    const until = appliedCustomRange?.until;
    const cacheKey = clientCacheKey(selectedAccountId, rangePreset, since, until);
    const cached = reportCacheRef.current.get(cacheKey);

    if (cached && Date.now() - cached.fetchedAt < CLIENT_CACHE_TTL_MS) {
      // Seen this exact account+range within the last 30 minutes in this tab
      // — show it immediately, no request at all (Hard Refresh still bypasses this).
      setReport(cached.data);
      setReportError(null);
      setReportLoading(false);
      setExpandedCampaigns({});
      setExpandedAdsets({});
      return;
    }

    // Standard fetch-on-param-change pattern (react.dev/learn/synchronizing-with-effects#fetching-data):
    // resetting loading/error/data state synchronously here is intentional, not a sync-derived-state bug.
    setReportLoading(true);
    setReportError(null);
    setReport(null);
    setExpandedCampaigns({});
    setExpandedAdsets({});

    let ignore = false;
    fetchReportData(selectedAccountId, { force: false, rangePreset, since, until })
      .then((json) => {
        if (ignore) return;
        if (json.error) setReportError(json.error);
        else {
          setReport(json);
          reportCacheRef.current.set(cacheKey, { data: json, fetchedAt: Date.now() });
        }
      })
      .catch((err) => {
        if (!ignore) setReportError(err.message);
      })
      .finally(() => {
        if (!ignore) setReportLoading(false);
      });

    return () => {
      ignore = true;
    };
  }, [selectedAccountId, rangePreset, appliedCustomRange]);

  function handleApplyCustomRange() {
    if (!customSince || !customUntil) return;
    setAppliedCustomRange({ since: customSince, until: customUntil });
  }

  function handleHardRefresh() {
    if (!selectedAccountId) return;
    const since = appliedCustomRange?.since;
    const until = appliedCustomRange?.until;
    const cacheKey = clientCacheKey(selectedAccountId, rangePreset, since, until);
    setReportLoading(true);
    setReportError(null);
    fetchReportData(selectedAccountId, { force: true, rangePreset, since, until })
      .then((json) => {
        if (json.error) setReportError(json.error);
        else {
          setReport(json);
          reportCacheRef.current.set(cacheKey, { data: json, fetchedAt: Date.now() });
        }
      })
      .catch((err) => setReportError(err.message))
      .finally(() => setReportLoading(false));
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
    if (!report) return;
    const allCampaigns = {};
    const allAdsets = {};
    for (const c of report.structure.campaigns) {
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
  function buildStructureRows() {
    if (!report) return [];
    const field = STRUCTURE_SORT_FIELD[structureSortKey];
    const { campaigns: visibleCampaigns, forceExpandIds } = filterStructureTree(
      report.structure.campaigns,
      structureSearch
    );
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

  return (
    <>
      <Head>
        <title>Account Handover Report · Facebook Auth Dashboard</title>
      </Head>
      <div className={styles.page}>
        <main className={styles.main} style={{ maxWidth: 1440, margin: "0 auto" }}>
          <Nav />

          <div className={styles.sectionRow}>
            <h1 className={styles.h1}>Account Handover Report</h1>
            {accounts.length > 0 && (
              <select
                className={styles.select}
                value={selectedAccountId}
                onChange={(e) => setSelectedAccountId(e.target.value)}
              >
                {accounts.map((acc) => (
                  <option key={acc.id} value={acc.id}>
                    {acc.name}
                  </option>
                ))}
              </select>
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
          {!accountsError && accounts.length === 0 && !reportLoading && (
            <p className={styles.sub}>No Ad Accounts found, or permission not granted.</p>
          )}

          {reportLoading && !report && <Loader label="Building the report…" />}
          {reportError && <div className={styles.error}>Error: {reportError}</div>}

          {report && (
            <>
              <div className={styles.sectionRow} style={{ marginTop: -8 }}>
                <p className={styles.sub} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span>
                    {report.dateRange.label}: {report.dateRange.since} → {report.dateRange.until} ·{" "}
                    {report.fromCache ? "cached" : "freshly fetched"}, updated {formatAge(now - report.cachedAt)}
                  </span>
                  {reportLoading && <Loader inline label="Refreshing…" />}
                </p>
                <button className={styles.btnSecondary} onClick={handleHardRefresh} disabled={reportLoading}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <RefreshIcon size={13} />
                    {reportLoading ? "Refreshing…" : "Hard Refresh"}
                  </span>
                </button>
              </div>

              <div className={styles.reportLayout}>
                <SectionNav sections={SECTIONS} />

                <div className={styles.reportContent} style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                {report.warnings?.length > 0 && (
                  <div className={styles.card} style={{ borderColor: "rgba(245,158,11,.25)" }}>
                    <h2 className={styles.h2}>Some data could not be loaded</h2>
                    <ul className={styles.list}>
                      {report.warnings.map((w, i) => (
                        <li key={i} className={styles.sub}>
                          · {w}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Overview */}
                <section id="overview">
                  <h2 className={styles.h2}>{report.dateRange.label}</h2>
                  <p className={styles.sub} style={{ marginBottom: 10 }}>
                    Click any metric to see its {report.trend.granularity} trend.
                  </p>
                  <div className={styles.statBar}>
                    <Stat label="Spend" value={money(report.overview.spend)} onClick={() => openTrend("spend")} />
                    <Stat
                      label="Purchases"
                      value={report.overview.purchases.toFixed(0)}
                      onClick={() => openTrend("purchases")}
                    />
                    <Stat label="ROAS" value={`${report.overview.roas.toFixed(2)}x`} onClick={() => openTrend("roas")} />
                    <Stat label="CTR" value={`${report.overview.ctr.toFixed(2)}%`} onClick={() => openTrend("ctr")} />
                    <Stat label="CVR" value={`${report.overview.cvr.toFixed(2)}%`} onClick={() => openTrend("cvr")} />
                  </div>
                </section>

                {/* Best week / month */}
                <section id="trends">
                  <p className={styles.sub} style={{ marginBottom: 10 }}>
                    Fixed 90-day/6-month lookback for historical context — independent of the date range selected
                    above.
                  </p>
                  <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                  <div className={styles.card} style={{ flex: 1, minWidth: 260 }}>
                    <h2 className={styles.h2}>Best Week (ROAS, last 90 days)</h2>
                    {report.bestWeek ? (
                      <>
                        <p className={styles.statValue}>{report.bestWeek.roas.toFixed(2)}x</p>
                        <p className={styles.sub}>
                          {report.bestWeek.since} → {report.bestWeek.until} · spend {money(report.bestWeek.spend)}
                        </p>
                      </>
                    ) : (
                      <p className={styles.sub}>No weeks with spend in this window.</p>
                    )}
                  </div>
                  <div className={styles.card} style={{ flex: 1, minWidth: 260 }}>
                    <h2 className={styles.h2}>Best Month (ROAS, last 6 months)</h2>
                    {report.bestMonth ? (
                      <>
                        <p className={styles.statValue}>{report.bestMonth.roas.toFixed(2)}x</p>
                        <p className={styles.sub}>
                          {report.bestMonth.since} → {report.bestMonth.until} · spend{" "}
                          {money(report.bestMonth.spend)}
                        </p>
                      </>
                    ) : (
                      <p className={styles.sub}>No months with spend in this window.</p>
                    )}
                  </div>
                  </div>
                </section>

                {/* Top spending campaigns */}
                <section id="top-campaigns" className={styles.card}>
                  <h2 className={styles.h2}>Top Spending Campaigns ({report.dateRange.label})</h2>
                  <p className={styles.sub} style={{ marginBottom: 12 }}>
                    Click a row to jump to it in Account Structure.
                  </p>
                  <SortableTable
                    defaultSortKey="spend"
                    maxHeight={360}
                    searchable
                    searchPlaceholder="Search campaigns…"
                    emptyMessage="No campaign spend in this window."
                    rows={report.topCampaigns}
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

                {/* 80% pareto */}
                <section id="pareto" className={styles.card}>
                  <h2 className={styles.h2}>Where 80% of Purchase Revenue Comes From</h2>
                  {report.pareto.totalAdCount === 0 ? (
                    <p className={styles.sub}>No ad-level purchase data in this window.</p>
                  ) : (
                    <>
                      <p className={styles.sub} style={{ marginBottom: 12 }}>
                        <strong style={{ color: "var(--t1)" }}>
                          {report.pareto.contributorCount} of {report.pareto.totalAdCount} ads
                        </strong>{" "}
                        ({report.pareto.revenueSharePct.toFixed(0)}% of purchase revenue) account for{" "}
                        <strong style={{ color: "var(--t1)" }}>
                          {report.pareto.spendSharePct.toFixed(0)}% of spend
                        </strong>
                        .
                      </p>
                      <SortableTable
                        defaultSortKey="revenue"
                        maxHeight={360}
                        searchable
                        searchPlaceholder="Search creatives…"
                        rows={report.pareto.contributors}
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

                {/* Where 80% of purchase revenue comes from, by age/gender */}
                <BreakdownSection
                  id="age-gender"
                  title="Where 80% of Purchase Revenue Comes From — Age & Gender"
                  data={report.purchasesByAgeGender}
                  labelHeader="Age · Gender"
                  searchPlaceholder="Search age/gender…"
                  emptyMessage="No age/gender breakdown data in this window."
                  money={money}
                />

                {/* Where 80% of purchase revenue comes from, by state/region */}
                <BreakdownSection
                  id="region"
                  title="Where 80% of Purchase Revenue Comes From — State"
                  data={report.purchasesByRegion}
                  labelHeader="State"
                  searchPlaceholder="Search states…"
                  emptyMessage="No region breakdown data in this window (not available for every country)."
                  noRevenueMessage="Facebook returns spend by state for this account, but doesn't return purchase revenue broken down by state — the per-state rows carry engagement data (clicks, video views, etc.) but never a purchase action, even though the account has plenty of purchases overall (see Age & Gender or Pareto above, which do carry it). This is a known Meta platform limitation: geographic breakdowns are commonly excluded from the data Aggregated Event Measurement reports for web conversion events (a post-iOS14 restriction), not something fixable from this app's side."
                  money={money}
                />

                {/* Full purchase split by creative type — only 3 possible groups, so no 80% cutoff */}
                <BreakdownSection
                  id="creative-type"
                  title="Purchases by Creative Type"
                  data={report.purchasesByCreativeType}
                  labelHeader="Creative Type"
                  showSummary={false}
                  emptyMessage="No creative-level purchase data in this window."
                  money={money}
                />

                {/* Where 80% of purchase revenue comes from, by platform + placement */}
                <BreakdownSection
                  id="placement"
                  title="Where 80% of Purchase Revenue Comes From — Platform & Placement"
                  data={report.purchasesByPlacement}
                  labelHeader="Placement"
                  searchPlaceholder="Search placements…"
                  emptyMessage="No placement breakdown data in this window."
                  money={money}
                />

                {/* Where 80% of purchase revenue comes from, by product — reverse-engineered from each ad's landing URL */}
                <section id="product" className={styles.card}>
                  <h2 className={styles.h2}>Where 80% of Purchase Revenue Comes From — Product</h2>
                  <p className={styles.sub} style={{ marginBottom: 12 }}>
                    Facebook has no native per-product revenue breakdown outside catalog reporting, so this is
                    derived from each ad&apos;s landing page URL (e.g. a Shopify-style <code>/products/handle</code>{" "}
                    path becomes the product name) — resolved from the ad&apos;s own creative, or from the
                    underlying Page post for ads built by boosting an existing post (common for video/Reels ads).
                    Catalog/Dynamic ads have no single fixed URL — Facebook generates the real destination per
                    product at serve time — so their revenue shows as its own &quot;Catalog / Dynamic creative&quot;
                    row instead of being dropped. A &quot;Unknown landing page&quot; row means neither lookup found a
                    URL (e.g. the underlying post is on a Page this login doesn&apos;t have read access to, or was
                    deleted) — if that row is large, it&apos;s worth checking which ads fall into it in Ads Manager
                    directly.
                  </p>
                  {report.purchasesByProduct.totalGroupCount === 0 ? (
                    <p className={styles.sub}>No ad-level purchase data in this window.</p>
                  ) : (
                    <>
                      <p className={styles.sub} style={{ marginBottom: 12 }}>
                        <strong style={{ color: "var(--t1)" }}>
                          {report.purchasesByProduct.contributorCount} of{" "}
                          {report.purchasesByProduct.totalGroupCount} products/pages
                        </strong>{" "}
                        ({report.purchasesByProduct.revenueSharePct.toFixed(0)}% of purchase revenue) account for{" "}
                        <strong style={{ color: "var(--t1)" }}>
                          {report.purchasesByProduct.spendSharePct.toFixed(0)}% of spend
                        </strong>
                        .
                      </p>
                      <SortableTable
                        defaultSortKey="revenue"
                        maxHeight={360}
                        searchable={report.purchasesByProduct.contributors.length > 6}
                        searchKeys={["label"]}
                        searchPlaceholder="Search products…"
                        rows={report.purchasesByProduct.contributors}
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
                </section>

                {/* Pixel health */}
                <section id="pixel-health" className={styles.card}>
                  <h2 className={styles.h2}>Pixel Event Health</h2>
                  {report.pixelHealth.pixels.length === 0 && report.pixelHealth.concerns.length === 0 ? (
                    <p className={styles.sub}>No pixel data available.</p>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {report.pixelHealth.pixels.map((p) => (
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
                      {report.pixelHealth.concerns
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

                {/* Account structure: campaign → ad set → ad drill-down */}
                <section id="structure" className={styles.card}>
                  <div className={styles.sectionRow}>
                    <div>
                      <h2 className={styles.h2} style={{ marginBottom: 2 }}>
                        Account Structure ({report.structure.campaignCount} campaigns, {report.structure.adsetCount}{" "}
                        ad sets)
                      </h2>
                      <p className={styles.sub}>
                        Only campaigns/ad sets with spend in the selected range ({report.dateRange.label}) are shown.
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
                  {report.structure.campaigns.length === 0 ? (
                    <p className={styles.sub}>No campaigns with spend in this window.</p>
                  ) : buildStructureRows().length === 0 ? (
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
                          {buildStructureRows().map((row) => (
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

                {/* High frequency ads */}
                <section id="high-frequency" className={styles.card}>
                  <h2 className={styles.h2}>High-Frequency Ads (&gt;3, excluding retargeting)</h2>
                  <p className={styles.sub} style={{ marginBottom: 12 }}>
                    Frequency here is per-ad over {report.dateRange.label.toLowerCase()} ({report.dateRange.since} →{" "}
                    {report.dateRange.until}) — it will not match a campaign- or ad-set-level frequency column in
                    Ads Manager, since reach is deduplicated differently at each level. Compare against Ads
                    Manager&apos;s own per-ad frequency for the same dates.
                  </p>
                  <SortableTable
                    defaultSortKey="frequency"
                    maxHeight={360}
                    searchable
                    searchPlaceholder="Search ads…"
                    emptyMessage="No ads over frequency 3 outside retargeting campaigns/ad sets."
                    rows={report.highFrequencyAds}
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

                {/* Budget utilization, split by CBO / ABO */}
                <section id="budget-utilization" className={styles.card}>
                  <h2 className={styles.h2}>Budget Utilization &amp; Creative Count</h2>
                  <p className={styles.sub} style={{ marginBottom: 12 }}>
                    CBO campaigns are judged at the campaign level; ABO campaigns are judged ad set by ad set, since
                    that is where the budget actually lives. Creative recommendations benchmark against this
                    account&apos;s own average spend per active creative over {report.dateRange.label.toLowerCase()} —
                    {" "}
                    <strong style={{ color: "var(--t1)" }}>
                      {money(report.budgetUtilization.accountAvgSpendPerCreative)}
                    </strong>
                    . Sort by Utilization to find underspend, or by Additional Needed to find creative gaps.
                  </p>

                  <div className={styles.tabGroup} style={{ marginBottom: 14 }}>
                    <button
                      className={budgetTab === "CBO" ? `${styles.tab} ${styles.tabActive}` : styles.tab}
                      onClick={() => setBudgetTab("CBO")}
                    >
                      CBO Campaigns ({report.budgetUtilization.cboCampaigns.length})
                    </button>
                    <button
                      className={budgetTab === "ABO" ? `${styles.tab} ${styles.tabActive}` : styles.tab}
                      onClick={() => setBudgetTab("ABO")}
                    >
                      ABO Ad Sets ({report.budgetUtilization.aboAdsets.length})
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
                      rows={report.budgetUtilization.cboCampaigns}
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
                        { key: "recommendedCreatives", label: "Recommended", align: "right" },
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
                      rows={report.budgetUtilization.aboAdsets}
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
                        { key: "recommendedCreatives", label: "Recommended", align: "right" },
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
                </div>
              </div>
            </>
          )}
        </main>
      </div>
      <CreativeLightbox item={lightboxItem} onClose={() => setLightboxItem(null)} />
      <MetricTrendModal
        metric={trendMetric}
        trend={report?.trend}
        rangeLabel={report?.dateRange?.label}
        onClose={() => setTrendMetric(null)}
      />
      <DefaultRangeModal
        open={showDefaultRangeModal}
        current={defaultRangePreset}
        onSelect={handleSelectDefaultRange}
        onClose={() => setShowDefaultRangeModal(false)}
      />
    </>
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
