import Head from "next/head";
import { getServerSession } from "next-auth/next";
import { useEffect, useState } from "react";
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
import { CloseIcon } from "@/components/icons";
import { useAccounts } from "@/components/AccountProvider";
import { computeRange } from "@/lib/dateRanges";
import { DEFAULT_COPY_METRIC_KEYS } from "@/lib/adCopy";
import { METRIC_CATALOG, formatMetricValue } from "@/lib/insightsMetrics";
import { METRIC_FILTER_OPERATORS, applyResultFilters } from "@/lib/copyAdsFilters";
import { parseJsonResponse, fetchWithTimeout } from "@/lib/fetchJson";
import styles from "@/styles/Home.module.css";

function newFilterId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `f${Date.now()}_${Math.random().toString(36).slice(2)}`;
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
const METRIC_GROUPS = [...new Set(PICKER_METRIC_CATALOG.map((m) => m.group))];
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
  const { adAccounts, accountsError, selectedAccountId, setSelectedAccountId } = useAccounts();

  const [ads, setAds] = useState([]);
  const [adsLoading, setAdsLoading] = useState(false);
  const [adsError, setAdsError] = useState(null);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [modalOpen, setModalOpen] = useState(false);
  const [lightboxItem, setLightboxItem] = useState(null);

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
  const range = computeRange(rangePreset, customSince, customUntil);

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

  // Clears out any ads/selection left over from a previously loaded
  // account — doesn't itself fetch anything (that still needs an explicit
  // Load Ads click below), just prevents the table from silently going on
  // showing a different account's ads/selection once `selectedAccountId`
  // has already moved on, which would otherwise let a copy fire against a
  // mismatched source account.
  useEffect(() => {
    // Reacting to the source account changing, not a derived-state
    // anti-pattern — clears state tied to whichever account was previously
    // selected.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAds([]);
    setSelectedIds(new Set());
    setHasLoaded(false);
    setAdsError(null);
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
    const params = new URLSearchParams({
      accountId: selectedAccountId,
      since: range.since,
      until: range.until,
      metrics: metricKeys.join(","),
    });
    fetchWithTimeout(`/api/fb/copy-ads/source-ads?${params.toString()}`)
      .then(parseJsonResponse)
      .then((json) => {
        if (json.error) setAdsError(json.error);
        else setAds(json.ads || []);
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

  const columns = [
    {
      key: "select",
      label: "",
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
          </div>
        </div>
      ),
    },
    { key: "campaignName", label: "Campaign", render: (row) => row.campaignName || "—" },
    { key: "adsetName", label: "Ad set", render: (row) => row.adsetName || "—" },
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
      render: (row) => <span className={row.effectiveStatus === "ACTIVE" ? styles.badgeGood : styles.badgeInfo}>{row.effectiveStatus || row.status}</span>,
    },
  ];

  return (
    <Layout>
      <Head>
        <title>Copy Ads · Facebook Auth Dashboard</title>
      </Head>
      <div className={styles.page}>
        <main className={styles.main} style={{ maxWidth: 1000, margin: "0 auto" }}>
          <h1 className={styles.h1}>Copy Ads Across Accounts</h1>
          <p className={styles.sub} style={{ marginTop: -8, marginBottom: 20 }}>
            Select ads running in one ad account and copy their creative into an ad set that already exists in a different ad
            account — the same Page, no retargeting needed.
          </p>

          {accountsError && <div className={styles.error}>Error loading ad accounts: {accountsError}</div>}

          <div className={styles.card} style={{ marginBottom: 20, display: "flex", gap: 20, flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 240px" }}>
              <p className={styles.sub} style={{ marginBottom: 6 }}>
                Source ad account
              </p>
              <AccountSelect accounts={adAccounts} value={selectedAccountId} onChange={setSelectedAccountId} placeholder="Select an ad account…" />
            </div>
            <div style={{ flex: "1 1 240px" }}>
              <p
                className={styles.sub}
                style={{ marginBottom: 6 }}
                title="Only ads with real delivery (spend/impressions) in this window show up — there's no way to list ads by recency any other way on this API. A just-launched ad with no spend yet won't appear until it has some."
              >
                Only show ads with spend in
              </p>
              <DateRangeMenu
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
            <div style={{ display: "flex", alignItems: "flex-end" }}>
              <button type="button" className={styles.btnPrimary} onClick={loadAds} disabled={!selectedAccountId || !range || adsLoading}>
                {adsLoading ? "Loading…" : hasLoaded ? "Reload Ads" : "Load Ads"}
              </button>
            </div>
          </div>

          <div className={styles.card} style={{ marginBottom: 20 }}>
            <p className={styles.sub} style={{ marginBottom: 10 }}>
              Metrics to show — changes take effect next time you Load Ads.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {METRIC_GROUPS.map((group) => (
                <div key={group}>
                  <p className={styles.muted} style={{ marginBottom: 6 }}>
                    {group}
                  </p>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {PICKER_METRIC_CATALOG.filter((m) => m.group === group).map((m) => {
                      const selected = metricKeys.includes(m.key);
                      return (
                        <button
                          key={m.key}
                          type="button"
                          onClick={() => toggleMetric(m.key)}
                          className={selected ? styles.badgeInfo : styles.pill}
                          style={
                            selected
                              ? { cursor: "pointer" }
                              : { cursor: "pointer", background: "transparent", border: "1px dashed var(--border)", color: "var(--t2)" }
                          }
                        >
                          {selected ? "✓ " : "+ "}
                          {m.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {!selectedAccountId && <p className={styles.sub}>Pick a source ad account above to see its ads.</p>}
          {selectedAccountId && !range && <p className={styles.sub}>Pick both custom dates above, then click Load Ads.</p>}
          {selectedAccountId && range && !hasLoaded && !adsLoading && <p className={styles.sub}>Click Load Ads to fetch ads for this account.</p>}
          {adsLoading && <Loader label="Loading ads…" />}
          {adsError && (
            <div className={styles.error}>
              {adsError}
              {adsError.toLowerCase().includes("reduce the amount of data") && " — try a narrower date range above, then Reload Ads."}
            </div>
          )}

          {!adsLoading && !adsError && hasLoaded && (
            <>
              <div className={styles.card} style={{ padding: 12, marginBottom: 20 }}>
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
                          {metricKeys
                            .filter((k) => PICKER_METRIC_CATALOG.find((m) => m.key === k)?.format !== "text")
                            .map((k) => (
                              <option key={k} value={k}>
                                {PICKER_METRIC_CATALOG.find((m) => m.key === k)?.label || k}
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
              </div>

              <SortableTable
                columns={columns}
                rows={filteredAds}
                defaultSortKey="name"
                defaultSortDir="asc"
                searchable
                searchKeys={["name", "campaignName", "adsetName"]}
                emptyMessage={appliedConditions.length > 0 ? "No ads match the current filters." : "No ads found in this account."}
              />
            </>
          )}
        </main>
      </div>

      <SelectionBar count={selectedAds.length} onClear={() => setSelectedIds(new Set())} onCopy={() => setModalOpen(true)} />

      {modalOpen && (
        <CopyAdsModal
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
