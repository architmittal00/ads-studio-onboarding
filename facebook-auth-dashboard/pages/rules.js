import Head from "next/head";
import { getServerSession } from "next-auth/next";
import { useEffect, useMemo, useState } from "react";
import { authOptions } from "./api/auth/[...nextauth]";
import { publicSession } from "@/lib/publicSession";
import Layout from "@/components/Layout";
import PinLock from "@/components/PinLock";
import AccountSelect from "@/components/AccountSelect";
import FlagTable from "@/components/rules/FlagTable";
import BulkRuleActionModal from "@/components/rules/BulkRuleActionModal";
import LabeledPill from "@/components/LabeledPill";
import RuleActionModal from "@/components/rules/RuleActionModal";
import CreativeLightbox from "@/components/CreativeLightbox";
import RuleCheckProgress from "@/components/rules/RuleCheckProgress";
import { RefreshIcon } from "@/components/icons";
import { useAccounts } from "@/components/AccountProvider";
import { fetchWithTimeout, parseJsonResponse } from "@/lib/fetchJson";
import { getCachedEntry, setCachedEntry, clearCachedEntry, formatAge } from "@/lib/clientCache";
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
];

function money(v, symbol) {
  return v == null ? "—" : `${symbol}${Math.round(v).toLocaleString("en-IN")}`;
}

// The account check runs from RulesContent, so nothing is fetched until the PIN is entered.
export default function Rules() {
  return (
    <Layout>
      <Head>
        <title>Rules · Facebook Auth Dashboard</title>
      </Head>
      <PinLock>
        <RulesContent />
      </PinLock>
    </Layout>
  );
}

function RulesContent() {
  const { adAccounts, accountsLoading, selectedAccountId, setSelectedAccountId } = useAccounts();
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
  const [thumbs, setThumbs] = useState({}); // ad id -> { thumbnailUrl, isVideo } | null once loaded
  const [lightboxItem, setLightboxItem] = useState(null);

  const tz = adAccounts.find((a) => a.id === selectedAccountId)?.timezone_name;

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
      setSteps({});
      const res = await fetchWithTimeout(`/api/fb/rules/check?accountId=${encodeURIComponent(accountId)}&stream=1${tz ? `&tz=${encodeURIComponent(tz)}` : ""}`, {}, 130000);
      if (!res.ok || !res.body) {
        const failed = await parseJsonResponse(res).catch(() => ({}));
        throw new Error(failed.error || `Request failed (${res.status})`);
      }
      // Progress arrives as one JSON object per line; the last one is the result (or an error).
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let json = null;
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
          else if (event.type === "error") throw new Error(event.error);
          else if (event.type === "result") json = event.data;
        }
      }
      if (!json) throw new Error("The check ended before finishing — please hard refresh.");
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
    const c = { all: 0, INCREASE_BUDGET: 0, DECREASE_BUDGET: 0, PAUSE_AD: 0 };
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
      <div className={styles.page}>
        <main className={styles.main} style={{ maxWidth: 1600, margin: "0 auto" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, flexWrap: "wrap" }}>
            <div>
              <h1 className={styles.h1} style={{ margin: 0 }}>
                Rules
              </h1>
              <p className={styles.sub} style={{ marginTop: 6 }}>
                Pick an account and we check every active campaign, ad set and ad against your rules, then flag what needs attention — with the action one click away.
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
          {result && (
            <span className={styles.muted}>
              Checked {new Date(result.generatedAt).toLocaleTimeString()}
              {savedNote ? ` (saved result, ${savedNote})` : ""} · data up to {result.windowEnd}
            </span>
          )}

          {loading && <RuleCheckProgress accountName={adAccounts.find((a) => a.id === selectedAccountId)?.name} steps={steps} />}
          {error && <div className={styles.error}>{error}</div>}

          {result && (
            <>
              <div className={styles.statBar}>
                <div className={styles.stat} style={{ flex: "1.6 1 220px" }}>
                  <div className={styles.statLabel}>Account</div>
                  <div className={styles.statValue} style={{ fontSize: 15 }}>
                    {result.accountName}
                  </div>
                  <div className={styles.muted} style={{ marginTop: 4 }}>
                    {result.counts.campaigns} campaigns · {result.counts.adsets} ad sets · {result.counts.ads} ads · {result.rulesChecked.length} rules
                  </div>
                </div>
                {result.baseline.map((b) => (
                  <div key={b.days} className={styles.stat}>
                    <div className={styles.statLabel}>{b.days}-day ROAS</div>
                    <div className={styles.statValue}>{b.roas != null ? b.roas.toFixed(2) : "—"}</div>
                    <div className={styles.muted} style={{ marginTop: 4 }}>
                      Spend {money(b.spend, result.currencySymbol)}
                    </div>
                  </div>
                ))}
              </div>

              <div className={styles.statBar}>
                {FILTERS.map((f) => (
                  <button key={f.key} type="button" className={styles.stat} aria-pressed={filter === f.key} onClick={() => setFilter(f.key === filter ? "all" : f.key)} style={filter === f.key ? { background: "rgba(var(--purple-rgb), 0.08)" } : undefined}>
                    <div className={styles.statLabel}>{f.label}</div>
                    <div className={styles.statValue} style={{ color: f.color || "var(--t1)" }}>
                      {counts[f.key]}
                    </div>
                  </button>
                ))}
              </div>

              {selected.size > 0 && (
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
                <section className={styles.card}>
                  <FlagTable
                    flags={shown}
                    currencySymbol={result.currencySymbol}
                    accountRoas7={base7?.roas ?? null}
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
                </section>
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
                  {result.held.map((h) => (
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
                      Windows are full days ending yesterday. Account figures are the account&apos;s own totals for the same window. Budget changes are suggested at 10% and can be edited before applying. A budget increase/decrease is held back if that ad set or campaign&apos;s budget was changed in the last 48 hours.
                    </p>
                  </div>
                )}
              </div>
            </>
          )}
        </main>
      </div>
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
            if (ok.length > 0) clearCachedEntry(cacheKey(selectedAccountId));
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
            clearCachedEntry(cacheKey(selectedAccountId));
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
