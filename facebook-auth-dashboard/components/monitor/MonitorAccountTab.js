import { useCallback, useEffect, useMemo, useState } from "react";
import SortableTable from "@/components/SortableTable";
import DateRangeMenu from "@/components/DateRangeMenu";
import MetricPicker from "@/components/MetricPicker";
import RowActions from "@/components/RowActions";
import Loader from "@/components/Loader";
import EntityDetailDrawer from "@/components/EntityDetailDrawer";
import EntityInvestigateDrawer from "@/components/EntityInvestigateDrawer";
import EntityHistoryDrawer from "@/components/EntityHistoryDrawer";
import { DEFAULT_COMPARISON_METRIC_KEYS } from "@/components/WindowComparisonTable";
import { AttentionMark, AttentionPopover } from "@/components/rules/RuleAttention";
import { useRuleAttention, attentionKey, clearRuleCaches } from "@/lib/rules/useRuleAttention";
import { buildEffectiveCatalog, formatMetricValue, humanizeStatus } from "@/lib/insightsMetrics";
import { computeRange } from "@/lib/dateRanges";
import { getCustomMetrics } from "@/lib/clientStorage";
import { fetchCustomEvents } from "@/lib/customEvents";
import { readExploreInsightsStream } from "@/lib/exploreStream";
import { track } from "@/lib/analytics";
import styles from "@/styles/Home.module.css";

const LEVELS = [
  { level: "campaign", title: "Campaigns", idField: "campaignId" },
  { level: "adset", title: "Ad sets", idField: "adsetId" },
  { level: "ad", title: "Ads", idField: "adId" },
];
const DEFAULT_METRICS = [...DEFAULT_COMPARISON_METRIC_KEYS, "ctr", "cpc"];
const ID_CHUNK = 50; // the data route takes at most 50 ids per request
const MAX_RANGE_DAYS = 365;

const chunk = (list, n) => Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, i * n + n));
const sinceLabel = (ms) => new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short" });

// One ad account's monitored items: their performance over a chosen date range and metrics (the same data as Custom Views),
// recommendations flagged on them, and the same row actions — pause / budget / duplicate / investigate / change history —
// plus "Remove from monitor". Items are grouped by level (campaigns, ad sets, ads), each its own table.
export default function MonitorAccountTab({ accountId, account, accountsLoading, items, prefs, onRemove, onPrefs, isMonitored }) {
  const timeZone = account?.timezone_name;
  const currency = account?.currency;
  const rangePreset = prefs.rangePreset || "last_7d";
  const metricKeys = prefs.metricKeys?.length ? prefs.metricKeys : DEFAULT_METRICS;
  const range = useMemo(() => computeRange(rangePreset, prefs.customSince, prefs.customUntil, timeZone), [rangePreset, prefs.customSince, prefs.customUntil, timeZone]);

  const [customMetrics] = useState(() => getCustomMetrics());
  const [customEvents, setCustomEvents] = useState([]);
  useEffect(() => {
    let cancelled = false;
    fetchCustomEvents([accountId]).then((events) => !cancelled && setCustomEvents(events));
    return () => {
      cancelled = true;
    };
  }, [accountId]);
  const catalog = useMemo(() => buildEffectiveCatalog(customMetrics, customEvents), [customMetrics, customEvents]);

  const [data, setData] = useState({ rows: {}, fetchedAt: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [reload, setReload] = useState(0);
  const [patches, setPatches] = useState({}); // entityId -> fields changed by a row action since the last read
  const [showMetrics, setShowMetrics] = useState(false);
  const [detailEntity, setDetailEntity] = useState(null);
  const [investigateEntity, setInvestigateEntity] = useState(null);
  const [historyEntity, setHistoryEntity] = useState(null);
  const [attentionOpen, setAttentionOpen] = useState(null);

  // Items of each level, as a stable string so the read only reruns when the list itself changes.
  const idsKey = items.map((i) => i.key).sort().join(",");
  useEffect(() => {
    if (accountsLoading) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- starts the read for the monitored list, range and metrics
    setLoading(true);
    setError(null);
    const sortedKeys = [...metricKeys].sort();
    const pickedCustomMetrics = customMetrics.filter((cm) => sortedKeys.includes(cm.id)).map((cm) => ({ id: cm.id, numeratorKey: cm.numeratorKey, denominatorKey: cm.denominatorKey }));
    const pickedCustomEvents = customEvents.filter((ce) => sortedKeys.includes(ce.id)).map((ce) => ({ id: ce.id, accountId: ce.accountId, actionType: ce.actionType }));
    const jobs = [];
    for (const { level, idField } of LEVELS) {
      const ids = items.filter((i) => i.level === level).map((i) => i.entityId);
      for (const group of chunk(ids, ID_CHUNK)) {
        jobs.push(
          fetch("/api/fb/explore-insights", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              accountIds: [accountId],
              level,
              breakdownGroup: "none",
              metricKeys,
              customFields: [],
              customMetrics: pickedCustomMetrics,
              customEvents: pickedCustomEvents,
              includeZeroSpend: true,
              since: range.since,
              until: range.until,
              idFilter: { field: idField, value: group.join(",") },
            }),
          })
            .then(readExploreInsightsStream)
            .then((json) => json.rows || [])
        );
      }
    }
    Promise.allSettled(jobs).then((results) => {
      if (cancelled) return;
      const rows = {};
      let failed = null;
      for (const r of results) {
        if (r.status === "fulfilled") {
          for (const row of r.value) if (row.entityId) rows[String(row.entityId)] = row;
        } else {
          failed = r.reason?.message || "Request failed";
        }
      }
      setData({ rows, fetchedAt: Date.now() });
      setPatches({});
      setError(failed);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reruns on the list, range, metrics or a manual refresh
  }, [accountId, accountsLoading, idsKey, range.since, range.until, metricKeys.join(","), customEvents.length, reload]);

  // Recommendations: the same rule check Custom Views runs, for this account, covering campaigns, ad sets and ads.
  const attention = useRuleAttention({ accounts: [{ id: accountId, timezone_name: timeZone }], level: "campaign", ready: !accountsLoading, refreshKey: reload });

  const refreshAll = useCallback(() => {
    clearRuleCaches(accountId);
    setReload((n) => n + 1);
  }, [accountId]);

  const rowsFor = (level) =>
    items
      .filter((i) => i.level === level)
      .map((item) => {
        const fetched = data.rows[String(item.entityId)] || null;
        return { ...(fetched || {}), ...(patches[item.entityId] || {}), entityId: item.entityId, accountId, entityLabel: item.name, label: item.name, _item: item, _hasData: !!fetched };
      });

  const columnsFor = (level) => {
    const metricColumns = metricKeys
      .filter((k) => catalog.some((m) => m.key === k))
      .map((k) => {
        const m = catalog.find((c) => c.key === k);
        return {
          key: k,
          label: m.label,
          align: "right",
          render: (row) => (row._hasData ? formatMetricValue(row[k], m.format || "number", currency) : "—"),
          sortValue: (row) => (typeof row[k] === "number" ? row[k] : -Infinity),
        };
      });
    return [
      {
        key: "name",
        label: "Name",
        maxWidth: 320,
        sortValue: (row) => String(row.label || "").toLowerCase(),
        render: (row) => {
          const item = row._item;
          const flag = attention.flags.get(attentionKey(accountId, level, row.entityId));
          const where = level === "campaign" ? null : [item.campaignName, level === "ad" ? item.adsetName : null].filter(Boolean).join(" › ");
          return (
            <div style={{ minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span title={row.label} style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis" }}>
                  {row.label}
                </span>
                <AttentionMark flag={flag} onOpen={setAttentionOpen} />
              </div>
              {where && (
                <div className={styles.muted} style={{ fontWeight: 400 }} title={where}>
                  {where}
                </div>
              )}
            </div>
          );
        },
      },
      {
        key: "status",
        label: "Status",
        sortValue: (row) => row.status || "",
        render: (row) => (row.status ? <span className={row.status === "ACTIVE" ? styles.badgeGood : styles.badgeInfo}>{humanizeStatus(row.status)}</span> : "—"),
      },
      { key: "addedAt", label: "Monitoring since", sortValue: (row) => row._item.addedAt, render: (row) => sinceLabel(row._item.addedAt) },
      ...metricColumns,
      {
        key: "__actions",
        label: "",
        maxWidth: 48,
        freezeExempt: true,
        stickyRight: true,
        render: (row) => (
          <RowActions
            variant="icon"
            row={row}
            level={level}
            currency={currency}
            onActionApplied={(entityId, patch) => {
              clearRuleCaches(accountId);
              setPatches((prev) => ({ ...prev, [entityId]: { ...(prev[entityId] || {}), ...patch } }));
            }}
            onViewDetails={setDetailEntity}
            onInvestigate={setInvestigateEntity}
            onHistory={setHistoryEntity}
            monitor={{
              isMonitored: isMonitored(level, row.entityId),
              onToggle: () => {
                onRemove(row._item.key);
                track("monitor_removed", { screen: "/monitor", level });
              },
            }}
          />
        ),
      },
    ];
  };

  const colorScales = prefs.colorScales || {};
  const presentLevels = LEVELS.filter((l) => items.some((i) => i.level === l.level));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <DateRangeMenu
          timeZone={timeZone}
          rangePreset={rangePreset}
          customSince={prefs.customSince}
          customUntil={prefs.customUntil}
          maxRangeDays={MAX_RANGE_DAYS}
          compareToPrevious={false}
          compareDisabled
          compareDisabledReason="Not available on Monitor."
          onApply={(patch) => onPrefs({ rangePreset: patch.rangePreset, customSince: patch.customSince, customUntil: patch.customUntil })}
        />
        <button type="button" className={styles.btnSecondary} onClick={() => setShowMetrics((v) => !v)} aria-expanded={showMetrics}>
          Metrics · {metricKeys.length}
        </button>
        <button type="button" className={styles.btnSecondary} onClick={refreshAll} disabled={loading}>
          Refresh
        </button>
        <span className={styles.muted} style={{ fontWeight: 400 }}>
          {range.since} → {range.until}
          {data.fetchedAt ? ` · updated ${new Date(data.fetchedAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}` : ""}
          {attention.loading ? " · checking recommendations…" : ""}
        </span>
      </div>

      {showMetrics && (
        <div className={styles.card} style={{ padding: 14 }}>
          <MetricPicker
            catalog={catalog}
            selectedKeys={metricKeys}
            onToggle={(key) => onPrefs({ metricKeys: metricKeys.includes(key) ? metricKeys.filter((k) => k !== key) : [...metricKeys, key] })}
          />
        </div>
      )}

      {error && <div className={styles.error}>{error}</div>}
      {loading && !data.fetchedAt && <Loader label="Reading performance…" />}

      {presentLevels.map(({ level, title }) => {
        const rows = rowsFor(level);
        return (
          <section key={level} style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
            <h2 className={styles.h2} style={{ margin: 0 }}>
              {title} <span className={styles.muted}>· {rows.length}</span>
            </h2>
            <SortableTable
              columns={columnsFor(level)}
              rows={rows}
              rowKey={(row) => row._item.key}
              defaultSortKey="addedAt"
              defaultSortDir="desc"
              maxHeight={520}
              resizableColumns
              colorScales={colorScales}
              onColorScalesChange={(next) => onPrefs({ colorScales: next })}
            />
          </section>
        );
      })}

      {attentionOpen && (
        <AttentionPopover
          flag={attentionOpen}
          currency={currency}
          onClose={() => setAttentionOpen(null)}
          onApplied={(entityId, patch) => {
            setAttentionOpen(null);
            clearRuleCaches(accountId);
            setPatches((prev) => ({ ...prev, [entityId]: { ...(prev[entityId] || {}), ...patch } }));
          }}
        />
      )}
      <EntityDetailDrawer entity={detailEntity} onClose={() => setDetailEntity(null)} onNavigate={setDetailEntity} onSaved={() => setReload((n) => n + 1)} />
      <EntityInvestigateDrawer entity={investigateEntity} onClose={() => setInvestigateEntity(null)} currency={currency} />
      <EntityHistoryDrawer entity={historyEntity} onClose={() => setHistoryEntity(null)} />
    </div>
  );
}
