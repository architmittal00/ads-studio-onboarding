import { useCallback, useEffect, useMemo, useState } from "react";
import Loader from "@/components/Loader";
import Thumb from "@/components/Thumb";
import { loadCreativePool, clearCreativePool, loadAdsetExtras, peekCreativePool, peekAdsetExtras } from "@/lib/rules/creativePool";
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
  const [pool, setPool] = useState(() => peekCreativePool(accountId));
  const [error, setError] = useState(null);
  const [pickedPush, setPickedPush] = useState(() => new Set());
  const [pickedPause, setPickedPause] = useState(() => new Set());
  const [busy, setBusy] = useState(null); // "push" | "pause"
  const [done, setDone] = useState({}); // creativeId / adId -> { ok, text?, error? }
  const [extras, setExtras] = useState(() => {
    const p = peekCreativePool(accountId);
    return p ? peekAdsetExtras(p.ads.filter((a) => a.adsetId === flag.entityId).map((a) => a.id)) : null;
  }); // this ad set's own ads: landing pages + thumbnails
  const [whyOpen, setWhyOpen] = useState(() => new Set());
  // Both lists start folded so the card stays readable; the header says what's inside.
  const [tab, setTab] = useState("push");
  const [confirming, setConfirming] = useState(false); // asking paused or active before adding
  const [launchAs, setLaunchAs] = useState("PAUSED");

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
  const readyPool = useMemo(
    () =>
      pool && extras
        ? {
            ...pool,
            ads: pool.ads.map((a) => {
              if (a.adsetId !== adsetId) return a;
              const i = extras.info[a.id] || {};
              return { ...a, name: i.name || a.name, landing: i.landing || a.landing || null, kind: i.kind || a.kind || null, thumbnailUrl: i.thumbnailUrl || a.thumbnailUrl || null, format: a.format || (i.isVideo ? "Video" : null) };
            }),
          }
        : null,
    [pool, extras, adsetId]
  );
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

  async function pushPicked(status) {
    setConfirming(false);
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
            body: JSON.stringify({ accountId, sourceAdId: c.sourceAdId, destinationAdsetId: adsetId, status }),
          });
          const json = await parseJsonResponse(res).catch((e) => ({ error: e.message }));
          if (!res.ok || json.error) throw new Error(json.error || `Request failed (${res.status})`);
          out[c.creativeId] = { ok: true, text: status === "ACTIVE" ? "Added, active" : "Added, paused" };
          // One event per ad added, in the same family as the other recommendation_applied_* events.
          track("recommendation_applied_ad_added", { screen: window.location.pathname, entity_type: "ad", entity_id: c.sourceAdId, creative_id: c.creativeId, destination_adset_id: adsetId, rule_id: flag.matchedRules?.[0]?.id, score: c.score, status, bulk: chosen.length > 1 });
        } catch (err) {
          out[c.creativeId] = { ok: false, error: err.message };
        }
        setDone((d) => ({ ...d, [c.creativeId]: out[c.creativeId] }));
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, chosen.length) }, worker));
    const added = Object.values(out).filter((o) => o.ok).length;
    track("recommendation_ads_pushed", { screen: window.location.pathname, rule_id: flag.matchedRules?.[0]?.id, selected: chosen.length, added, failed: chosen.length - added, status });
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
    for (const id of ids) if (out[id].ok) track("recommendation_applied_ad_paused", { screen: window.location.pathname, entity_type: "ad", entity_id: id, rule_id: "new-creative-01", source: "starved_ads", bulk: ids.length > 1 });
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

  const spendsOn = [
    ranked.mainLanding ? `landing page ${ranked.mainLanding.key}${ranked.mainLanding.share != null ? ` (${ranked.mainLanding.share.toFixed(0)}% of spend)` : ""}` : null,
    ranked.profile?.type ? `${ranked.profile.type.label} ads (${ranked.profile.type.share.toFixed(0)}%)` : null,
    ranked.profile?.language ? `${ranked.profile.language.label} (${ranked.profile.language.share.toFixed(0)}%)` : null,
  ].filter(Boolean);
  const pushPending = ranked.candidates.filter((c) => pickedPush.has(c.creativeId) && !done[c.creativeId]?.ok).length;
  const pausePending = starved.filter((a) => pickedPause.has(a.adId) && !done[a.adId]?.ok).length;
  const allPush = ranked.candidates.length > 0 && ranked.candidates.every((c) => done[c.creativeId]?.ok || pickedPush.has(c.creativeId));

  const showPause = starved.length > 0 && tab === "pause";
  return (
    <div className={styles.pushBox}>
      {starved.length > 0 && (
        <div className={styles.tabGroup} role="tablist">
          <button type="button" role="tab" aria-selected={!showPause} className={`${styles.tab} ${!showPause ? styles.tabActive : ""}`} onClick={() => setTab("push")}>
            Push ads{ranked.candidates.length > 0 ? ` · ${ranked.candidates.length}` : ""}
          </button>
          <button type="button" role="tab" aria-selected={showPause} className={`${styles.tab} ${showPause ? styles.tabActive : ""}`} onClick={() => setTab("pause")}>
            Pause ads · {starved.length}
          </button>
        </div>
      )}
      {showPause && (
        <section className={styles.pushSection}>
          <>
              <p className={styles.sub} style={{ margin: 0 }}>
                This ad set&apos;s lowest-spending half of ads over the last 3 days, worst performers first. Nothing is ticked for you.
              </p>
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
          </>
        </section>
      )}

      {!showPause && (
      <section className={styles.pushSection}>
        <>
            <div className={styles.pushHead}>
              <p className={styles.sub} style={{ margin: 0 }}>
                {spendsOn.length > 0
                  ? `This ad set mostly spends on ${spendsOn.join(", ")}, and creatives that match count far more. Ranked over the last 14 days across every ad that uses the creative.`
                  : "Ranked by ROAS, CTR, CPC, consistency, evidence and freshness over the last 14 days — across every ad that uses the creative."}
                {ranked.qualified > MAX_PUSH_OPTIONS ? ` Showing the best ${MAX_PUSH_OPTIONS} of ${ranked.qualified}.` : ""}
              </p>
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
                        <div className={styles.pushVerdict}>
                          <strong>
                            {c.score}/100 · {c.summary.grade} for this ad set
                          </strong>
                          {c.summary.strong.length > 0 && (
                            <p>
                              <span className={styles.badgeGood}>Strong</span> {c.summary.strong.join(" · ")}
                            </p>
                          )}
                          {c.summary.slight.length > 0 && (
                            <p>
                              <span className={styles.badgeInfo}>Slight edge</span> {c.summary.slight.join(" · ")}
                            </p>
                          )}
                          {c.summary.weak.length > 0 && (
                            <p>
                              <span className={styles.badgeDanger}>Weak</span> {c.summary.weak.join(" · ")}
                            </p>
                          )}
                        </div>
                        <div className={styles.pushWhyTable}>
                          <div className={`${styles.pushWhyRow} ${styles.pushWhyHead}`}>
                            <span>What we checked</span>
                            <span>This creative</span>
                            <span>Compared with</span>
                            <span style={{ textAlign: "right" }}>Result</span>
                          </div>
                          {c.breakdown.map((b) => (
                            <div key={b.key} className={styles.pushWhyRow}>
                              <span>{b.label}</span>
                              <strong>{b.value}</strong>
                              <span className={styles.pushWhyAgainst}>{b.against}</span>
                              <span style={{ textAlign: "right" }}>
                                <span className={b.level === "strong" ? styles.badgeGood : b.level === "fair" ? styles.badgeWarn : b.level === "slight" ? styles.badgeInfo : styles.badgeDanger}>
                                  {b.level === "strong" ? "Strong" : b.level === "fair" ? "Fair" : b.level === "slight" ? "Slight edge" : "Weak"}
                                </span>
                                <span className={styles.pushWhyPoints}>
                                  {b.points.toFixed(0)}/{b.max.toFixed(0)}
                                </span>
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div>
                        <div className={styles.recContextTitle} style={{ marginTop: 0 }}>
                          Already running in {c.runningIn.length} ad set{c.runningIn.length === 1 ? "" : "s"} · last 14 days
                        </div>
                        <dl className={styles.recContextList}>
                          {c.runningIn.map((r) => (
                            <div key={r.adsetId} className={styles.recContextRow}>
                              <dt title={[r.campaignName, r.adsetName].filter(Boolean).join(" › ")}>
                                <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 260 }}>{r.adsetName || r.adsetId}</span>
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
            {confirming && pushPending > 0 ? (
              <div className={styles.pushConfirm}>
                <strong>
                  Launch {pushPending} ad{pushPending === 1 ? "" : "s"} as…
                </strong>
                <div className={styles.tabGroup} role="radiogroup" aria-label="Launch as">
                  <button type="button" role="radio" aria-checked={launchAs === "PAUSED"} className={`${styles.tab} ${launchAs === "PAUSED" ? styles.tabActive : ""}`} onClick={() => setLaunchAs("PAUSED")}>
                    Paused
                  </button>
                  <button type="button" role="radio" aria-checked={launchAs === "ACTIVE"} className={`${styles.tab} ${launchAs === "ACTIVE" ? styles.tabActive : ""}`} onClick={() => setLaunchAs("ACTIVE")}>
                    Active
                  </button>
                </div>
                <span className={styles.muted} style={{ fontWeight: 400 }}>
                  {launchAs === "ACTIVE" ? "Active ads start spending right away." : "Paused copies don't spend until you turn them on in Ads Manager."}
                </span>
                <div className={styles.pushConfirmActions}>
                  <button type="button" className={styles.btnPrimary} onClick={() => pushPicked(launchAs)}>
                    Launch as {launchAs === "ACTIVE" ? "active" : "paused"}
                  </button>
                  <button type="button" className={styles.btnSecondary} onClick={() => setConfirming(false)}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <>
                <button type="button" className={styles.btnPrimary} disabled={pushPending === 0 || !!busy} onClick={() => setConfirming(true)}>
                  {busy === "push" ? "Adding…" : pushPending ? `Add ${pushPending} ad${pushPending === 1 ? "" : "s"} to this ad set` : "Select ads to add"}
                </button>
                <span className={styles.muted} style={{ fontWeight: 400 }}>
                  Each one reuses the same creative; you choose paused or active before anything is created.
                </span>
              </>
            )}
          </div>
        )}
        </>
      </section>
      )}
    </div>
  );
}
