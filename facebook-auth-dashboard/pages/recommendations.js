import Head from "next/head";
import { getServerSession } from "next-auth/next";
import { useCallback, useEffect, useMemo, useState } from "react";
import { authOptions } from "./api/auth/[...nextauth]";
import { publicSession } from "@/lib/publicSession";
import Layout from "@/components/Layout";
import ViewTabs from "@/components/ViewTabs";
import AccountSelect from "@/components/AccountSelect";
import RecBoard, { RecSummary } from "@/components/rules/RecBoard";
import FlagCards from "@/components/rules/FlagCards";
import { MobileContextBar, MobileIconBtn, MobileChips, PickerSheet } from "@/components/mobile/MobileChrome";
import { useIsMobile } from "@/lib/useIsMobile";
import BulkRuleActionModal from "@/components/rules/BulkRuleActionModal";
import LabeledPill from "@/components/LabeledPill";
import RuleActionModal from "@/components/rules/RuleActionModal";
import CreativeLightbox from "@/components/CreativeLightbox";
import RuleCheckProgress from "@/components/rules/RuleCheckProgress";
import { RefreshIcon } from "@/components/icons";
import { useAccounts } from "@/components/AccountProvider";
import { fetchWithTimeout, parseJsonResponse, withNetworkRetry } from "@/lib/fetchJson";
import { getCachedEntry, setCachedEntry, formatAge } from "@/lib/clientCache";
import { clearRuleCaches } from "@/lib/rules/useRuleAttention";
import styles from "@/styles/Home.module.css";

// A finished check is saved in the browser for 30 minutes (shared cache, survives reloads), so
// coming back or switching accounts doesn't re-run a heavy check; "Hard refresh" re-runs it now.
const CACHE_MS = 30 * 60 * 1000;
const cacheKey = (accountId) => `rules-check:${accountId}`;
// Ad creative thumbnails already fetched, by ad id (null = the ad has none).
const thumbCache = new Map();

const BULK_ACTIONS = [
  { action: "PAUSE_AD", color: "var(--red)", label: (n) => `Pause ${n} ad${n === 1 ? "" : "s"}` },
  { action: "INCREASE_BUDGET", color: "var(--green)", label: (n) => `Increase ${n} budget${n === 1 ? "" : "s"}` },
  { action: "DECREASE_BUDGET", color: "var(--amber)", label: (n) => `Decrease ${n} budget${n === 1 ? "" : "s"}` },
];

const FILTERS = [
  { key: "all", label: "All flagged" },
  { key: "INCREASE_BUDGET", label: "Increase budget", color: "var(--green)" },
  { key: "DECREASE_BUDGET", label: "Decrease budget", color: "var(--amber)" },
  { key: "PAUSE_AD", label: "Pause ads", color: "var(--red)" },
  { key: "ADD_CREATIVE", label: "Add a creative", color: "var(--blue)" },
];

// ₹27.8L, ₹1.02Cr — short money for phone tiles.
function compactMoney(v, symbol) {
  return v == null ? "—" : `${symbol}${new Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 1 }).format(v)}`;
}

function money(v, symbol) {
  return v == null ? "—" : `${symbol}${Math.round(v).toLocaleString("en-IN")}`;
}

export default function Recommendations() {
  return (
    <Layout>
      <Head>
        <title>Recommendations · Facebook Auth Dashboard</title>
      </Head>
      <RecommendationTabs />
    </Layout>
  );
}

const TABS_KEY = "recs-tabs:v1";
const newTabId = () => `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// Several recommendation views open at once, like Custom Views' tabs: each tab has its own ad account,
// filter, ticked rows and results, and keeps them while you look at another tab. A tab's check only starts
// the first time it is shown. The tab list (accounts, names, which one is open) is remembered in this browser.
function RecommendationTabs() {
  const { adAccounts, selectedAccountId, setSelectedAccountId } = useAccounts();
  const [tabs, setTabs] = useState(() => [{ id: "t1", accountId: null, name: "" }]);
  const [activeId, setActiveId] = useState("t1");
  const [visited, setVisited] = useState(() => new Set(["t1"])); // tabs shown at least once stay mounted
  const [loadingIds, setLoadingIds] = useState(() => new Set());

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(TABS_KEY) || "null");
      if (!saved?.tabs?.length) return;
      const restored = saved.tabs.map((t) => ({ id: String(t.id), accountId: t.accountId || null, name: t.name || "" }));
      const active = restored.some((t) => t.id === saved.activeId) ? saved.activeId : restored[0].id;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- restores the saved tabs once in the browser (not available during server render)
      setTabs(restored);
      setActiveId(active);
      setVisited(new Set([active]));
    } catch {}
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(TABS_KEY, JSON.stringify({ activeId, tabs }));
    } catch {}
  }, [tabs, activeId]);

  // A tab opened before the accounts loaded has no account yet; pin it to the app-wide pick once there is
  // one, so changing the account in another tab later never moves it.
  useEffect(() => {
    if (!selectedAccountId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- pins an unset tab to the account that was selected when it loaded
    setTabs((prev) => (prev.some((t) => !t.accountId) ? prev.map((t) => (t.accountId ? t : { ...t, accountId: selectedAccountId })) : prev));
  }, [selectedAccountId, tabs.length]);

  const accountIdOf = (tab) => tab.accountId || selectedAccountId;
  const titleOf = (tab, i) => tab.name || adAccounts.find((a) => a.id === accountIdOf(tab))?.name || `Tab ${i + 1}`;

  function select(id) {
    setActiveId(id);
    setVisited((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
  }
  function add() {
    // Starts on the account of the tab you are looking at (instant, the result is saved); change it from there.
    const from = tabs.find((t) => t.id === activeId);
    const tab = { id: newTabId(), accountId: from ? accountIdOf(from) : selectedAccountId, name: "" };
    setTabs((prev) => [...prev, tab]);
    select(tab.id);
  }
  function close(id) {
    if (tabs.length <= 1) return;
    const idx = tabs.findIndex((t) => t.id === id);
    const next = tabs.filter((t) => t.id !== id);
    setTabs(next);
    setVisited((prev) => {
      const v = new Set(prev);
      v.delete(id);
      return v;
    });
    if (id === activeId) select(next[Math.max(0, idx - 1)].id);
  }
  const setTabLoading = useCallback((id, on) => {
    setLoadingIds((prev) => {
      if (prev.has(id) === on) return prev;
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  return (
    <div className={styles.page}>
      {/* minWidth 0: .page is a flex row, and without it the sideways-scrolling tiles/chips inside make this column as wide as their content (the whole page then scrolls sideways on a phone). */}
      <main className={styles.main} style={{ maxWidth: 1600, margin: "0 auto", minWidth: 0 }}>
        <ViewTabs
          tabs={tabs.map((t, i) => ({ id: t.id, title: titleOf(t, i), loading: loadingIds.has(t.id) }))}
          activeId={activeId}
          onSelect={select}
          onAdd={add}
          onClose={close}
          onRename={(id, name) => setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, name } : t)))}
          addTitle="New recommendations tab"
          sticky={false}
        />
        {tabs.map((t) =>
          visited.has(t.id) || t.id === activeId ? (
            <div key={t.id} hidden={t.id !== activeId} style={{ display: t.id === activeId ? "flex" : "none", flexDirection: "column", gap: 14, minWidth: 0 }}>
              <RulesContent
                accountId={accountIdOf(t)}
                onAccountChange={(id) => {
                  setTabs((prev) => prev.map((x) => (x.id === t.id ? { ...x, accountId: id } : x)));
                  setSelectedAccountId(id);
                }}
                tabId={t.id}
                onLoadingChange={setTabLoading}
              />
            </div>
          ) : null
        )}
      </main>
    </div>
  );
}

function RulesContent({ tabId, accountId: selectedAccountId, onAccountChange: setSelectedAccountId, onLoadingChange }) {
  const { adAccounts, accountsLoading } = useAccounts();
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState("all");
  const [applied, setApplied] = useState({}); // flag key -> short outcome text
  const [acting, setActing] = useState(null);
  const [showRules, setShowRules] = useState(false);
  const [selected, setSelected] = useState(() => new Set()); // flag keys ticked for a bulk action
  const [bulk, setBulk] = useState(null); // { action, flags } while the bulk confirm window is open
  const [savedNote, setSavedNote] = useState(null); // e.g. "saved 12 minutes ago" when the shown result came from the cache
  const [steps, setSteps] = useState({}); // check step id -> { done, detail }
  const [retryNote, setRetryNote] = useState(null); // shown in the loader while a dropped connection is retried
  const [thumbs, setThumbs] = useState({}); // ad id -> { thumbnailUrl, isVideo } | null once loaded
  const [lightboxItem, setLightboxItem] = useState(null);

  useEffect(() => {
    onLoadingChange?.(tabId, loading);
  }, [loading, tabId, onLoadingChange]);

  const isMobile = useIsMobile();
  const [pickingAccount, setPickingAccount] = useState(false);
  const selectedAccount = adAccounts.find((a) => a.id === selectedAccountId);
  const tz = selectedAccount?.timezone_name;

  async function run(accountId, force = false) {
    if (!accountId) return;
    const cached = force ? null : getCachedEntry(cacheKey(accountId), CACHE_MS);
    if (cached) {
      setResult(cached.data);
      setSavedNote(formatAge(Date.now() - cached.fetchedAt));
      setApplied({});
      setSelected(new Set());
      setError(null);
      return;
    }
    setSavedNote(null);
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      setRetryNote(null);
      // The check streams for up to a minute, so the connection can drop mid-way; that is retried a couple
      // of times (a failure the server itself reports is not).
      const json = await withNetworkRetry(
        async () => {
          setSteps({});
          const res = await fetchWithTimeout(`/api/fb/rules/check?accountId=${encodeURIComponent(accountId)}&stream=1${tz ? `&tz=${encodeURIComponent(tz)}` : ""}`, {}, 130000);
          if (!res.ok || !res.body) {
            const failed = await parseJsonResponse(res).catch(() => ({}));
            throw Object.assign(new Error(failed.error || `Request failed (${res.status})`), { noRetry: res.status < 500 || res.status === 504 });
          }
          // Progress arrives as one JSON object per line; the last one is the result (or an error).
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          let result = null;
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop();
            for (const line of lines) {
              if (!line.trim()) continue;
              const event = JSON.parse(line);
              if (event.type === "step" && !event.pending) setSteps((prev) => ({ ...prev, [event.id]: { done: true, detail: event.detail } }));
              else if (event.type === "error") throw Object.assign(new Error(event.error), { noRetry: true });
              else if (event.type === "result") result = event.data;
            }
          }
          if (!result) throw Object.assign(new Error("The check ended before finishing — please hard refresh."), { retryable: true });
          return result;
        },
        { retries: 2, onRetry: (n) => setRetryNote(`Connection dropped — retrying (${n}/2)…`) }
      );
      // A result missing its 48-hour cool-down check isn't worth keeping for half an hour.
      if (json.heldChecked) setCachedEntry(cacheKey(accountId), json, { prefix: "rules-check:", maxEntriesForPrefix: 15 });
      setApplied({});
      setSelected(new Set());
      setResult(json);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- starts the check for the picked account
    run(selectedAccountId);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-runs only when the account changes
  }, [selectedAccountId]);

  // Ad previews load after the flags are already on screen: each ad card shows a small spinner
  // until its creative arrives (or settles on a blank tile when it has none / the lookup fails).
  useEffect(() => {
    const adIds = [...new Set((result?.flags || []).filter((f) => f.entityType === "ad").map((f) => f.entityId))];
    const fromCache = {};
    const missing = [];
    for (const id of adIds) {
      if (thumbCache.has(id)) fromCache[id] = thumbCache.get(id);
      else missing.push(id);
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- shows already-known previews right away
    setThumbs(fromCache);
    if (missing.length === 0) return;
    let cancelled = false;
    fetchWithTimeout("/api/fb/ad-thumbnails", { idempotent: true, method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ adIds: missing }) }, 60000)
      .then((res) => parseJsonResponse(res))
      .then((json) => json.thumbnails || {})
      .catch(() => ({}))
      .then((thumbnails) => {
        const loaded = {};
        for (const id of missing) {
          loaded[id] = thumbnails[id] || null;
          thumbCache.set(id, loaded[id]);
        }
        if (!cancelled) setThumbs((prev) => ({ ...prev, ...loaded }));
      });
    return () => {
      cancelled = true;
    };
  }, [result]);

  const counts = useMemo(() => {
    const c = { all: 0, INCREASE_BUDGET: 0, DECREASE_BUDGET: 0, PAUSE_AD: 0, ADD_CREATIVE: 0 };
    for (const f of result?.flags || []) {
      c.all++;
      c[f.action]++;
    }
    return c;
  }, [result]);
  const shown = (result?.flags || []).filter((f) => filter === "all" || f.action === filter);
  const base7 = result?.baseline?.find((b) => b.days === 7);
  const selectedFlags = (result?.flags || []).filter((f) => selected.has(f.key));

  return (
    <>
      {isMobile && (
        <MobileContextBar
          title={selectedAccount?.name || "Select an ad account"}
          sub={result ? `Checked ${new Date(result.generatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}${savedNote ? ` · saved ${savedNote}` : ""}` : "Recommendations"}
          onOpen={() => setPickingAccount(true)}
        >
          <MobileIconBtn label="Hard refresh" onClick={() => run(selectedAccountId, true)} disabled={loading || !selectedAccountId} spinning={loading}>
            <RefreshIcon size={16} />
          </MobileIconBtn>
        </MobileContextBar>
      )}
      {isMobile && pickingAccount && (
        <PickerSheet
          open
          title="Ad account"
          options={adAccounts.map((a) => ({ id: a.id, name: a.name, sub: a.id }))}
          value={selectedAccountId}
          onPick={setSelectedAccountId}
          onClose={() => setPickingAccount(false)}
          searchPlaceholder="Search ad accounts"
        />
      )}
      <div className={isMobile ? styles.hideOnMobile : undefined} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, flexWrap: "wrap" }}>
        <div>
          <h1 className={styles.h1} style={{ margin: 0 }}>
            Recommendations
          </h1>
          <p className={styles.sub} style={{ marginTop: 6 }}>
            We check every active campaign, ad set and ad against your rules and recommend what to do.
          </p>
        </div>
        <div className={styles.headerPillRow} style={{ alignItems: "flex-end" }}>
          <LabeledPill label="Ad Account">
            <AccountSelect
              accounts={adAccounts}
              value={selectedAccountId}
              onChange={setSelectedAccountId}
              placeholder="Select an ad account…"
              inputClassName={styles.headerPillSelect}
              inputStyle={{ width: 190 }}
              loading={accountsLoading}
            />
          </LabeledPill>
          <button
            type="button"
            className={loading ? `${styles.headerPillIconBtn} spinning` : styles.headerPillIconBtn}
            onClick={() => run(selectedAccountId, true)}
            disabled={loading || !selectedAccountId}
            title="Hard refresh — re-run the whole check now. Results are otherwise saved for 30 minutes."
            aria-label="Hard refresh"
          >
            <RefreshIcon size={14} />
          </button>
        </div>
      </div>
      {loading && <RuleCheckProgress accountName={adAccounts.find((a) => a.id === selectedAccountId)?.name} steps={steps} notice={retryNote} />}
      {error && <div className={styles.error}>{error}</div>}

      {result && (
        <>
          {isMobile ? (
            <>
              <div className={styles.kpiStrip} aria-label="Account ROAS">
                {result.baseline.map((b) => (
                  <div key={b.days} className={styles.kpiTile}>
                    <div className={styles.kpiLabel}>{b.days}-day ROAS</div>
                    <div className={styles.kpiValue}>{b.roas != null ? b.roas.toFixed(2) : "—"}</div>
                    <div className={styles.rowCardSub}>
                      CPP {b.cpr != null ? compactMoney(b.cpr, result.currencySymbol) : "—"} · {compactMoney(b.spend, result.currencySymbol)} spend
                    </div>
                  </div>
                ))}
              </div>
              <div className={styles.mvMeta}>
                {result.counts.campaigns} campaigns · {result.counts.adsets} ad sets · {result.counts.ads} ads · {result.rulesChecked.length} rules
                {result.counts.skipped && result.counts.skipped.adsets > 0 && ` · ${result.counts.skipped.adsets} ad sets, ${result.counts.skipped.ads} ads skipped (not optimized for purchases)`}
                {result.counts.learning && result.counts.learning.adsets > 0 && ` · ${result.counts.learning.adsets} ad sets, ${result.counts.learning.campaigns} campaigns in learning (not judged)`}
              </div>
            </>
          ) : (
            <RecSummary result={result} counts={counts} flags={result.flags} filter={filter} setFilter={setFilter} checkedText={`Checked ${new Date(result.generatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}${savedNote ? ` (saved, ${savedNote})` : ""}`} />
          )}

          {isMobile && (
            <MobileChips tabs={FILTERS.map((f) => ({ key: f.key, label: `${f.label} (${counts[f.key]})`, short: `${f.key === "all" ? "All" : f.label.replace(" budget", "").replace(" ads", "")} ${counts[f.key]}` }))} active={filter} onChange={setFilter} label="Filter flags" />
          )}
          {!isMobile && selected.size > 0 && (
            <div className={styles.card} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", padding: "10px 14px" }}>
              <strong style={{ fontSize: 13 }}>{selected.size} selected</strong>
              {BULK_ACTIONS.map((a) => {
                const flags = selectedFlags.filter((f) => f.action === a.action);
                return flags.length > 0 ? (
                  <button key={a.action} type="button" className={styles.btnSecondary} style={{ color: a.color }} onClick={() => setBulk({ action: a.action, flags })}>
                    {a.label(flags.length)}
                  </button>
                ) : null;
              })}
              <button type="button" className={styles.btnSecondary} onClick={() => setSelected(new Set())} style={{ marginLeft: "auto" }}>
                Clear
              </button>
            </div>
          )}

          {result.flags.length === 0 ? (
            <div className={styles.card}>
              <p style={{ fontWeight: 700, marginBottom: 4 }}>Nothing flagged ✓</p>
              <p className={styles.sub}>No active campaign, ad set or ad matches any rule right now.</p>
            </div>
          ) : shown.length === 0 ? (
            <p className={styles.sub}>Nothing in this category.</p>
          ) : (
            isMobile ? (
              <FlagCards
                flags={shown}
                currencySymbol={result.currencySymbol}
                accountRoas7={base7?.roas ?? null}
                accountCpp7={base7?.cpr ?? null}
                applied={applied}
                thumbs={thumbs}
                onAct={setActing}
                onOpenThumb={(flag, t) => setLightboxItem({ id: flag.entityId, name: flag.name, thumbnailUrl: t?.thumbnailUrl, isVideo: t?.isVideo })}
              />
            ) : (
            <RecBoard
              flags={result.flags}
              filter={filter}
              currencySymbol={result.currencySymbol}
              baseline={base7}
              accountId={selectedAccountId}
              tz={tz}
              applied={applied}
              thumbs={thumbs}
              onAct={setActing}
              selected={selected}
              onToggle={(key) =>
                setSelected((prev) => {
                  const next = new Set(prev);
                  if (next.has(key)) next.delete(key);
                  else next.add(key);
                  return next;
                })
              }
              onToggleAll={(keys, checked) =>
                setSelected((prev) => {
                  const next = new Set(prev);
                  for (const k of keys) {
                    if (checked) next.add(k);
                    else next.delete(k);
                  }
                  return next;
                })
              }
              onOpenThumb={(flag, t) => setLightboxItem({ id: flag.entityId, name: flag.name, thumbnailUrl: t?.thumbnailUrl, isVideo: t?.isVideo })}
            />
            )
          )}

          {!result.heldChecked && (
            <p className={styles.muted} style={{ marginTop: 14, fontWeight: 400 }}>
              Couldn&apos;t read the account&apos;s recent changes, so the 48-hour budget cool-down wasn&apos;t applied this time — hard refresh to try again.
            </p>
          )}
          {result.held?.length > 0 && (
            <div className={styles.card} style={{ marginTop: 18 }}>
              <h2 className={styles.h2} style={{ marginBottom: 2 }}>
                Held back — budget changed in the last 48 hours ({result.held.length})
              </h2>
              <p className={styles.sub} style={{ marginBottom: 10 }}>
                These match a budget rule, but we don&apos;t suggest another budget change so soon after the last one. Give the change time to settle; they&apos;ll show up here or above after 48 hours.
              </p>
              {[...result.held].sort((a, b) => new Date(b.changedAt) - new Date(a.changedAt)).map((h) => (
                <div key={h.key} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "8px 0", borderTop: "1px solid var(--border)", flexWrap: "wrap" }}>
                  <div style={{ minWidth: 0 }}>
                    <span className={styles.badgeInfo}>{h.entityType === "adset" ? "Ad set" : "Campaign"}</span> <span style={{ fontWeight: 600, fontSize: 13 }}>{h.name}</span>
                    <div className={styles.muted} style={{ fontWeight: 400 }}>
                      Would have been: {h.action === "INCREASE_BUDGET" ? "increase" : "decrease"} budget ({h.ruleNames.join(", ")})
                    </div>
                  </div>
                  <div className={styles.muted} style={{ fontWeight: 400, textAlign: "right" }}>
                    {h.changedWhat === "campaign" && h.entityType !== "campaign" ? "Its campaign's" : "Its"} budget was changed {new Date(h.changedAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true })}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div style={{ marginTop: 22 }}>
            <button type="button" className={styles.btnSecondary} onClick={() => setShowRules((s) => !s)}>
              {showRules ? "Hide" : "Show"} the {result.rulesChecked.length} rules checked
            </button>
            {showRules && (
              <div className={styles.card} style={{ marginTop: 10 }}>
                {result.rulesChecked.map((r) => (
                  <div key={r.id} style={{ padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>
                      {r.name} <span className={styles.muted}>· {r.level} · {r.action.replace("_", " ").toLowerCase()}</span>
                    </div>
                    <div className={styles.sub} style={{ fontSize: 12.5 }}>
                      {r.text}
                    </div>
                  </div>
                ))}
                <p className={styles.muted} style={{ fontSize: 11.5, marginTop: 10 }}>
                  Rules only apply to ad sets optimized for Purchase or purchase value (ads follow their ad set; a campaign is judged only if all its ad sets are). Windows are full days ending yesterday. Account figures are the account&apos;s own totals for the same window. Budget changes are suggested at 10% and can be edited before applying. A budget increase/decrease is held back if that ad set or campaign&apos;s budget was changed in the last 48 hours.
                </p>
              </div>
            )}
          </div>
        </>
      )}
      <CreativeLightbox item={lightboxItem} onClose={() => setLightboxItem(null)} />
      {bulk && (
        <BulkRuleActionModal
          action={bulk.action}
          flags={bulk.flags}
          currencySymbol={result.currencySymbol}
          onClose={() => setBulk(null)}
          onDone={(results) => {
            const ok = results.filter((r) => r.ok);
            setApplied((p) => ({ ...p, ...Object.fromEntries(ok.map((r) => [r.key, r.text])) }));
            setSelected((prev) => {
              const next = new Set(prev);
              for (const r of ok) next.delete(r.key);
              return next;
            });
            // The saved result no longer matches the account, so the next visit re-checks.
            if (ok.length > 0) clearRuleCaches(selectedAccountId);
          }}
        />
      )}
      {acting && (
        <RuleActionModal
          flag={acting}
          currencySymbol={result.currencySymbol}
          onClose={() => setActing(null)}
          onApplied={(text) => {
            setApplied((p) => ({ ...p, [acting.key]: text }));
            // The saved result no longer matches the account, so the next visit re-checks.
            clearRuleCaches(selectedAccountId);
            setActing(null);
          }}
        />
      )}
    </>
  );
}

export async function getServerSideProps(context) {
  const session = await getServerSession(context.req, context.res, authOptions);
  if (!session) return { redirect: { destination: "/", permanent: false } };
  return { props: { session: publicSession(session) } };
}
