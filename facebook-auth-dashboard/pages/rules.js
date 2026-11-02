import Head from "next/head";
import { getServerSession } from "next-auth/next";
import { useEffect, useMemo, useState } from "react";
import { authOptions } from "./api/auth/[...nextauth]";
import { publicSession } from "@/lib/publicSession";
import Layout from "@/components/Layout";
import PinLock from "@/components/PinLock";
import AccountSelect from "@/components/AccountSelect";
import RuleFlagCard from "@/components/rules/RuleFlagCard";
import RuleActionModal from "@/components/rules/RuleActionModal";
import CreativeLightbox from "@/components/CreativeLightbox";
import RuleCheckProgress from "@/components/rules/RuleCheckProgress";
import { RefreshIcon } from "@/components/icons";
import { useAccounts } from "@/components/AccountProvider";
import { fetchWithTimeout, parseJsonResponse } from "@/lib/fetchJson";
import styles from "@/styles/Home.module.css";

// Results stay in memory while the page is open, so switching accounts back and forth doesn't re-run a heavy check.
const resultCache = new Map();
const CACHE_MS = 10 * 60 * 1000;
// Ad creative thumbnails already fetched, by ad id (null = the ad has none).
const thumbCache = new Map();

const ACTION_TEXT = { INCREASE_BUDGET: "increase budget", DECREASE_BUDGET: "decrease budget", PAUSE_AD: "pause ad" };

const FILTERS = [
  { key: "all", label: "All" },
  { key: "INCREASE_BUDGET", label: "Increase budget" },
  { key: "DECREASE_BUDGET", label: "Decrease budget" },
  { key: "PAUSE_AD", label: "Pause ads" },
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
  const [query, setQuery] = useState("");
  const [steps, setSteps] = useState({}); // check step id -> { done, detail }
  const [thumbs, setThumbs] = useState({}); // ad id -> { thumbnailUrl, isVideo } | null once loaded
  const [lightboxItem, setLightboxItem] = useState(null);

  const tz = adAccounts.find((a) => a.id === selectedAccountId)?.timezone_name;

  async function run(accountId, force = false) {
    if (!accountId) return;
    const cached = resultCache.get(accountId);
    if (!force && cached && Date.now() - cached.at < CACHE_MS) {
      setResult(cached.data);
      setError(null);
      return;
    }
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
      if (!json) throw new Error("The check ended before finishing — please re-check.");
      resultCache.set(accountId, { at: Date.now(), data: json });
      setApplied({});
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

  // Search matches the name, its campaign / ad set, the rule names, the entity type and the action.
  const searched = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = result?.flags || [];
    if (!q) return all;
    return all.filter((f) =>
      [f.name, f.campaignName, f.adsetName, f.entityType === "adset" ? "ad set" : f.entityType, ACTION_TEXT[f.action], ...f.matchedRules.map((r) => r.name)].filter(Boolean).join(" ").toLowerCase().includes(q)
    );
  }, [result, query]);
  const searchedHeld = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = result?.held || [];
    if (!q) return all;
    return all.filter((h) => `${h.name} ${h.ruleNames.join(" ")}`.toLowerCase().includes(q));
  }, [result, query]);

  const counts = useMemo(() => {
    const c = { all: 0, INCREASE_BUDGET: 0, DECREASE_BUDGET: 0, PAUSE_AD: 0 };
    for (const f of searched) {
      c.all++;
      c[f.action]++;
    }
    return c;
  }, [searched]);
  const shown = searched.filter((f) => filter === "all" || f.action === filter);
  const base7 = result?.baseline?.find((b) => b.days === 7);

  return (
    <>
      <div className={styles.page}>
        <main className={styles.main} style={{ maxWidth: 1100, margin: "0 auto" }}>
          <h1 className={styles.h1}>Rules</h1>
          <p className={styles.sub} style={{ marginBottom: 16 }}>
            Pick an account and we check every active campaign, ad set and ad against your rules, then flag what needs attention — with the action one click away.
          </p>

          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 18 }}>
            <AccountSelect accounts={adAccounts} value={selectedAccountId} onChange={setSelectedAccountId} style={{ minWidth: 260 }} loading={accountsLoading} />
            <button type="button" className={styles.btnSecondary} disabled={loading || !selectedAccountId} onClick={() => run(selectedAccountId, true)} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <RefreshIcon size={13} />
              Re-check
            </button>
            {result && <span className={styles.muted}>Checked {new Date(result.generatedAt).toLocaleTimeString()} · data up to {result.windowEnd}</span>}
          </div>

          {loading && <RuleCheckProgress accountName={adAccounts.find((a) => a.id === selectedAccountId)?.name} steps={steps} />}
          {error && <div className={styles.error}>{error}</div>}

          {result && (
            <>
              <div className={styles.card} style={{ marginBottom: 16 }}>
                <div style={{ display: "flex", gap: 24, flexWrap: "wrap", alignItems: "baseline", justifyContent: "space-between" }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 15 }}>{result.accountName}</div>
                    <div className={styles.muted} style={{ fontSize: 12 }}>
                      {result.counts.campaigns} active campaigns · {result.counts.adsets} ad sets · {result.counts.ads} ads · {result.rulesChecked.length} rules checked
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 22, flexWrap: "wrap" }}>
                    {result.baseline.map((b) => (
                      <div key={b.days}>
                        <div className={styles.muted} style={{ fontSize: 11 }}>
                          {b.days}-day account
                        </div>
                        <div style={{ fontWeight: 700 }}>
                          ROAS {b.roas != null ? b.roas.toFixed(2) : "—"}
                        </div>
                        <div className={styles.muted} style={{ fontSize: 11 }}>
                          Spend {money(b.spend, result.currencySymbol)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
                {FILTERS.map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    onClick={() => setFilter(f.key)}
                    className={filter === f.key ? styles.btnPrimary : styles.btnSecondary}
                    style={{ padding: "7px 14px" }}
                  >
                    {f.label} ({counts[f.key]})
                  </button>
                ))}
              </div>

              {result.flags.length > 0 && (
                <input
                  type="search"
                  className={styles.select}
                  style={{ width: "100%", marginBottom: 14 }}
                  placeholder="Search by ad, ad set or campaign name, or by rule…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  aria-label="Search flags"
                />
              )}

              {result.flags.length === 0 ? (
                <div className={styles.card}>
                  <p style={{ fontWeight: 700, marginBottom: 4 }}>Nothing flagged ✓</p>
                  <p className={styles.sub}>No active campaign, ad set or ad matches any rule right now.</p>
                </div>
              ) : shown.length === 0 ? (
                <p className={styles.sub}>{query.trim() ? `Nothing matches “${query.trim()}”${filter === "all" ? "" : " in this category"}.` : "Nothing in this category."}</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {shown.map((f) => (
                    <RuleFlagCard key={f.key} flag={f} currencySymbol={result.currencySymbol} accountRoas7={base7?.roas ?? null} applied={applied[f.key]} onAct={setActing} thumb={f.entityType === "ad" ? thumbs[f.entityId] : undefined} onOpenThumb={(flag, t) => setLightboxItem({ id: flag.entityId, name: flag.name, thumbnailUrl: t?.thumbnailUrl, isVideo: t?.isVideo })} />
                  ))}
                </div>
              )}

              {!result.heldChecked && (
                <p className={styles.muted} style={{ marginTop: 14, fontWeight: 400 }}>
                  Couldn&apos;t read the account&apos;s recent changes, so the 48-hour budget cool-down wasn&apos;t applied this time — re-check to try again.
                </p>
              )}
              {searchedHeld.length > 0 && (
                <div className={styles.card} style={{ marginTop: 18 }}>
                  <h2 className={styles.h2} style={{ marginBottom: 2 }}>
                    Held back — budget changed in the last 48 hours ({searchedHeld.length})
                  </h2>
                  <p className={styles.sub} style={{ marginBottom: 10 }}>
                    These match a budget rule, but we don&apos;t suggest another budget change so soon after the last one. Give the change time to settle; they&apos;ll show up here or above after 48 hours.
                  </p>
                  {searchedHeld.map((h) => (
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
      {acting && (
        <RuleActionModal
          flag={acting}
          currencySymbol={result.currencySymbol}
          onClose={() => setActing(null)}
          onApplied={(text) => {
            setApplied((p) => ({ ...p, [acting.key]: text }));
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
