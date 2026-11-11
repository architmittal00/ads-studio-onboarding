import { useCallback, useEffect, useMemo, useState } from "react";
import Loader from "@/components/Loader";
import Thumb from "@/components/Thumb";
import { loadCreativePool, clearCreativePool, loadAdsetExtras } from "@/lib/rules/creativePool";
import { rankPushCandidates, starvedAds, MAX_PUSH_OPTIONS, MIN_SCORE } from "@/lib/rules/pushRank";
import { pauseInBatches } from "@/lib/batchPause";
import { parseJsonResponse } from "@/lib/fetchJson";
import { invalidateCachedGets } from "@/lib/cachedGet";
import { clearRuleCaches } from "@/lib/rules/useRuleAttention";
import { track } from "@/lib/analytics";
import styles from "@/styles/Home.module.css";

// Under an "Add a creative" recommendation: which existing creatives to push into this ad set (ranked by
// lib/rules/pushRank.js) and, for "New creative -01", which of its own ads aren't being served and could be paused.
const CONCURRENCY = 3;
const money = (v, symbol) => (v == null ? "—" : `${symbol}${v < 100 ? v.toFixed(2) : Math.round(v).toLocaleString("en-IN")}`);

function Vs({ value, lowerIsBetter }) {
  if (value == null) return null;
  const good = lowerIsBetter ? value <= 0 : value >= 0;
  return (
    <span className={good ? styles.badgeGood : styles.badgeDanger} title="Compared with the account's 14-day figure">
      {value >= 0 ? "+" : "−"}
      {Math.abs(Math.round(value))}%
    </span>
  );
}

function Stat({ label, children }) {
  return (
    <div className={styles.recMetric}>
      <span className={styles.recMetricLabel}>{label}</span>
      {children}
    </div>
  );
}

function StatsRow({ stats, symbol }) {
  return (
    <div className={styles.pushStats}>
      <Stat label="14d ROAS">
        <strong>{stats.roas != null ? stats.roas.toFixed(2) : "—"}</strong>
        <Vs value={stats.roasVsAcct} />
      </Stat>
      <Stat label="14d CTR">
        <strong>{stats.ctr != null ? `${stats.ctr.toFixed(2)}%` : "—"}</strong>
        <Vs value={stats.ctrVsAcct} />
      </Stat>
      <Stat label="14d CPC">
        <strong>{money(stats.cpc, symbol)}</strong>
        <Vs value={stats.cpcVsAcct} lowerIsBetter />
      </Stat>
      <Stat label="Purchases">
        <strong>{Math.round(stats.purchases)}</strong>
      </Stat>
    </div>
  );
}

export default function PushAds({ flag, accountId, tz, symbol, pausedAdIds, onOpenThumb }) {
  const [pool, setPool] = useState(null);
  const [error, setError] = useState(null);
  const [pickedPush, setPickedPush] = useState(() => new Set());
  const [pickedPause, setPickedPause] = useState(() => new Set());
  const [busy, setBusy] = useState(null); // "push" | "pause"
  const [done, setDone] = useState({}); // creativeId / adId -> { ok, text?, error? }
  const [extras, setExtras] = useState(null); // this ad set's own ads: landing pages + thumbnails
  const [whyOpen, setWhyOpen] = useState(() => new Set());

  const load = useCallback(
    (force = false) => {
      setError(null);
      loadCreativePool(accountId, tz, { force })
        .then(setPool)
        .catch((e) => setError(e.message));
    },
    [accountId, tz]
  );
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- starts the pool lookup for this card
    load();
  }, [load]);

  const adsetId = flag.entityId;
  // The ad set's own ads need their landing pages to learn which page it spends on.
  useEffect(() => {
    if (!pool) return;
    let cancelled = false;
    loadAdsetExtras(pool.ads.filter((a) => a.adsetId === adsetId).map((a) => a.id)).then((x) => {
      if (!cancelled) setExtras(x);
    });
    return () => {
      cancelled = true;
    };
  }, [pool, adsetId]);
  const readyPool = useMemo(() => (pool && extras ? { ...pool, ads: pool.ads.map((a) => (a.adsetId === adsetId ? { ...a, landing: extras.landings[a.id] || a.landing || null, thumbnailUrl: extras.thumbnails[a.id]?.thumbnailUrl || a.thumbnailUrl || null, format: a.format || (extras.thumbnails[a.id]?.isVideo ? "Video" : null) } : a)) } : null), [pool, extras, adsetId]);
  const ranked = useMemo(() => (readyPool ? rankPushCandidates({ pool: readyPool, adsetId, pausedAdIds, symbol }) : null), [readyPool, adsetId, pausedAdIds, symbol]);
  const isStarvedRule = flag.matchedRules.some((r) => r.id === "new-creative-01");
  const starved = useMemo(() => (readyPool && isStarvedRule ? starvedAds({ pool: readyPool, adsetId }) : []), [readyPool, adsetId, isStarvedRule]);

  const toggle = (setter) => (id) =>
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  async function pushPicked() {
    const chosen = ranked.candidates.filter((c) => pickedPush.has(c.creativeId) && !done[c.creativeId]?.ok);
    if (chosen.length === 0) return;
    setBusy("push");
    let next = 0;
    const out = {};
    async function worker() {
      while (next < chosen.length) {
        const c = chosen[next++];
        try {
          const res = await fetch("/api/fb/duplicate-ad", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ accountId, sourceAdId: c.sourceAdId, destinationAdsetId: adsetId }),
          });
          const json = await parseJsonResponse(res).catch((e) => ({ error: e.message }));
          if (!res.ok || json.error) throw new Error(json.error || `Request failed (${res.status})`);
          out[c.creativeId] = { ok: true, text: "Added, paused" };
        } catch (err) {
          out[c.creativeId] = { ok: false, error: err.message };
        }
        setDone((d) => ({ ...d, [c.creativeId]: out[c.creativeId] }));
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, chosen.length) }, worker));
    const added = Object.values(out).filter((o) => o.ok).length;
    track("recommendation_ads_pushed", { screen: window.location.pathname, rule_id: flag.matchedRules?.[0]?.id, selected: chosen.length, added, failed: chosen.length - added });
    if (added > 0) {
      invalidateCachedGets();
      clearRuleCaches(accountId);
      clearCreativePool(accountId); // the ad set's ads changed, so the next card re-reads the pool
    }
    setPickedPush((prev) => new Set([...prev].filter((id) => !out[id]?.ok)));
    setBusy(null);
  }

  async function pausePicked() {
    const ids = [...pickedPause].filter((id) => !done[id]?.ok);
    if (ids.length === 0) return;
    setBusy("pause");
    const results = await pauseInBatches(ids);
    const out = {};
    for (const id of ids) out[id] = results.get(id)?.ok ? { ok: true, text: "Paused" } : { ok: false, error: results.get(id)?.error || "Not paused" };
    setDone((d) => ({ ...d, ...out }));
    const paused = Object.values(out).filter((o) => o.ok).length;
    track("recommendation_starved_ads_paused", { screen: window.location.pathname, rule_id: "new-creative-01", selected: ids.length, paused, failed: ids.length - paused });
    if (paused > 0) {
      invalidateCachedGets();
      clearRuleCaches(accountId);
    }
    setPickedPause((prev) => new Set([...prev].filter((id) => !out[id]?.ok)));
    setBusy(null);
  }

  if (error) {
    return (
      <div className={styles.pushBox}>
        <p className={styles.sub}>Couldn&apos;t load the account&apos;s creatives: {error}</p>
        <button type="button" className={styles.btnSecondary} onClick={() => load(true)}>
          Try again
        </button>
      </div>
    );
  }
  if (!pool || !ranked) {
    return (
      <div className={styles.pushBox}>
        <Loader label="Finding proven creatives for this ad set…" />
      </div>
    );
  }

  const pushPending = ranked.candidates.filter((c) => pickedPush.has(c.creativeId) && !done[c.creativeId]?.ok).length;
  const pausePending = starved.filter((a) => pickedPause.has(a.adId) && !done[a.adId]?.ok).length;
  const allPush = ranked.candidates.length > 0 && ranked.candidates.every((c) => done[c.creativeId]?.ok || pickedPush.has(c.creativeId));

  return (
    <div className={styles.pushBox}>
      {starved.length > 0 && (
        <section className={styles.pushSection}>
          <div className={styles.pushHead}>
            <div>
              <div className={styles.recContextTitle} style={{ margin: 0 }}>
                Pause these — they aren&apos;t getting served
              </div>
              <p className={styles.sub} style={{ margin: "4px 0 0" }}>
                This ad set&apos;s lowest-spending half of ads over the last 3 days, worst performers first. Nothing is ticked for you.
              </p>
            </div>
          </div>
          <div className={styles.pushList}>
            {starved.map((a) => {
              const r = done[a.adId];
              return (
                <div key={a.adId} className={styles.pushRow}>
                  <input type="checkbox" aria-label={`Select ${a.name}`} checked={pickedPause.has(a.adId) && !r?.ok} disabled={r?.ok || busy} onChange={() => toggle(setPickedPause)(a.adId)} />
                  <Thumb size={44} src={a.thumbnailUrl} isVideo={a.format === "Video"} onClick={a.thumbnailUrl || a.format === "Video" ? () => onOpenThumb?.({ entityId: a.adId, name: a.name }, { thumbnailUrl: a.thumbnailUrl, isVideo: a.format === "Video" }) : undefined} />
                  <div className={styles.pushMain}>
                    <div className={styles.recName}>
                      <span title={a.name}>{a.name}</span>
                    </div>
                    <div className={styles.recWhere}>
                      {a.spendShare3 != null ? `${a.spendShare3.toFixed(1)}% of the ad set's spend, last 3 days` : "No spend in the last 3 days"}
                      {a.beatsAccount && <span className={styles.badgeGood} style={{ marginLeft: 8 }}>performing well — consider keeping</span>}
                      {r && <span style={{ marginLeft: 8, color: r.ok ? "var(--green)" : "var(--red)" }}>{r.ok ? `✓ ${r.text}` : r.error}</span>}
                    </div>
                  </div>
                  <StatsRow stats={a.stats} symbol={symbol} />
                </div>
              );
            })}
          </div>
          <div className={styles.pushFoot}>
            <button type="button" className={styles.btnSecondary} style={{ color: "var(--red)" }} disabled={pausePending === 0 || !!busy} onClick={pausePicked}>
              {busy === "pause" ? "Pausing…" : `Pause ${pausePending || ""} ad${pausePending === 1 ? "" : "s"}`.replace("  ", " ")}
            </button>
          </div>
        </section>
      )}

      <section className={styles.pushSection}>
        <div className={styles.pushHead}>
          <div>
            <div className={styles.recContextTitle} style={{ margin: 0 }}>
              Ads to push into this ad set{ranked.candidates.length > 0 ? ` · top ${ranked.candidates.length}` : ""}
            </div>
            <p className={styles.sub} style={{ margin: "4px 0 0" }}>
              {ranked.mainLanding
                ? `Most of this ad set's spend${ranked.mainLanding.share != null ? ` (${ranked.mainLanding.share.toFixed(0)}%)` : ""} goes to ${ranked.mainLanding.key}, and that page counts far more than the others. Ranked by landing page, ROAS, CTR, CPC, consistency, evidence and freshness over the last 14 days — across every ad that uses the creative. Only creatives scoring ${MIN_SCORE}+ are shown.`
                : `Ranked by ROAS, CTR, CPC, consistency, evidence and freshness over the last 14 days — across every ad that uses the creative. Only creatives scoring ${MIN_SCORE}+ are shown.`}
              {ranked.qualified > MAX_PUSH_OPTIONS ? ` Showing the best ${MAX_PUSH_OPTIONS} of ${ranked.qualified}.` : ""}
            </p>
          </div>
          {ranked.candidates.length > 0 && (
            <div className={styles.pushLinks}>
              <button type="button" className={styles.recWhyBtn} onClick={() => setPickedPush(new Set(ranked.candidates.filter((c) => !done[c.creativeId]?.ok).map((c) => c.creativeId)))} disabled={!!busy || allPush}>
                Select all
              </button>
              <button type="button" className={styles.recWhyBtn} onClick={() => setPickedPush(new Set())} disabled={!!busy || pickedPush.size === 0}>
                Clear
              </button>
            </div>
          )}
        </div>

        {ranked.candidates.length === 0 ? (
          <p className={styles.sub}>
            {ranked.belowBar > 0
              ? `${ranked.belowBar} creative${ranked.belowBar === 1 ? "" : "s"} qualified, but none scored ${MIN_SCORE} or more for this ad set. Upload a fresh one in Ads Manager.`
              : "No proven creatives to add yet — none of the account's other creatives has 10+ purchases in the last 14 days and beats the account's 14-day ROAS. Upload a fresh one in Ads Manager."}
          </p>
        ) : (
          <div className={styles.pushList}>
            {ranked.candidates.map((c) => {
              const r = done[c.creativeId];
              return (
                <div key={c.creativeId} className={styles.pushRow}>
                  <input type="checkbox" aria-label={`Select ${c.name}`} checked={pickedPush.has(c.creativeId) && !r?.ok} disabled={r?.ok || !!busy} onChange={() => toggle(setPickedPush)(c.creativeId)} />
                  <Thumb size={44} src={c.thumbnailUrl} isVideo={c.format === "Video"} onClick={c.thumbnailUrl || c.format === "Video" ? () => onOpenThumb?.({ entityId: c.sourceAdId, name: c.name }, { thumbnailUrl: c.thumbnailUrl, isVideo: c.format === "Video" }) : undefined} />
                  <div className={styles.pushMain}>
                    <div className={styles.recName}>
                      <span className={styles.badgeInfo} style={{ flexShrink: 0 }}>
                        {c.format || "Ad"}
                      </span>
                      <span title={c.name}>{c.name}</span>
                    </div>
                    <div className={styles.recWhere}>
                      Running in {c.runningIn.length} ad set{c.runningIn.length === 1 ? "" : "s"}
                      <button type="button" className={styles.recWhyBtn} style={{ marginLeft: 10 }} onClick={() => toggle(setWhyOpen)(c.creativeId)} aria-expanded={whyOpen.has(c.creativeId)}>
                        {whyOpen.has(c.creativeId) ? "Hide why ▴" : "Why push this? ▾"}
                      </button>
                    </div>
                    {r && <div style={{ color: r.ok ? "var(--green)" : "var(--red)", fontSize: 12 }}>{r.ok ? `✓ ${r.text}` : r.error}</div>}
                  </div>
                  <StatsRow stats={c.stats} symbol={symbol} />
                  <div className={styles.pushScore}>
                    <span className={styles.recMetricLabel}>Score</span>
                    <strong>{c.score}</strong>
                  </div>
                  {whyOpen.has(c.creativeId) && (
                    <div className={styles.pushWhy}>
                      <div>
                        <div className={styles.recContextTitle} style={{ marginTop: 0 }}>
                          Why it ranks {c.score}/100 for this ad set
                        </div>
                        {c.breakdown.map((b) => (
                          <div key={b.key} className={styles.pushFactor}>
                            <div className={styles.pushFactorHead}>
                              <span>{b.label}</span>
                              <span className={styles.muted}>
                                {b.points.toFixed(1)} / {b.max.toFixed(1)}
                              </span>
                            </div>
                            <div className={styles.pushBar}>
                              <span style={{ width: `${b.max > 0 ? Math.round((b.points / b.max) * 100) : 0}%` }} />
                            </div>
                            <div className={styles.pushFactorText}>{b.detail}</div>
                          </div>
                        ))}
                      </div>
                      <div>
                        <div className={styles.recContextTitle} style={{ marginTop: 0 }}>
                          Already running in {c.runningIn.length} ad set{c.runningIn.length === 1 ? "" : "s"} (14 days)
                        </div>
                        <dl className={styles.recContextList}>
                          {c.runningIn.map((r) => (
                            <div key={r.adsetId} className={styles.recContextRow}>
                              <dt title={[r.campaignName, r.adsetName].filter(Boolean).join(" › ")}>
                                <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 300 }}>{r.adsetName || r.adsetId}</span>
                                <span className={styles.muted} style={{ fontWeight: 400 }}>
                                  {r.campaignName || ""}
                                </span>
                              </dt>
                              <dd>
                                {r.roas != null ? `${r.roas.toFixed(2)} ROAS` : "—"} · {Math.round(r.purchases)} purchases
                              </dd>
                            </div>
                          ))}
                        </dl>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {ranked.candidates.length > 0 && (
          <div className={styles.pushFoot}>
            <button type="button" className={styles.btnPrimary} disabled={pushPending === 0 || !!busy} onClick={pushPicked}>
              {busy === "push" ? "Adding…" : pushPending ? `Add ${pushPending} ad${pushPending === 1 ? "" : "s"} to this ad set` : "Select ads to add"}
            </button>
            <span className={styles.muted} style={{ fontWeight: 400 }}>
              Added as paused copies that reuse the same creative — review them in Ads Manager before turning them on.
            </span>
          </div>
        )}
      </section>
    </div>
  );
}
