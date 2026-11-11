import { useCallback, useEffect, useMemo, useState } from "react";
import Loader from "@/components/Loader";
import Thumb from "@/components/Thumb";
import { loadCreativePool, clearCreativePool } from "@/lib/rules/creativePool";
import { rankPushCandidates, starvedAds, FACTOR_LABELS, MAX_PUSH_OPTIONS } from "@/lib/rules/pushRank";
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
    <span className={good ? styles.badgeGood : styles.badgeDanger} title="Compared with the account's 30-day figure">
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
      <Stat label="30d ROAS">
        <strong>{stats.roas != null ? stats.roas.toFixed(2) : "—"}</strong>
        <Vs value={stats.roasVsAcct} />
      </Stat>
      <Stat label="30d CTR">
        <strong>{stats.ctr != null ? `${stats.ctr.toFixed(2)}%` : "—"}</strong>
        <Vs value={stats.ctrVsAcct} />
      </Stat>
      <Stat label="30d CPC">
        <strong>{money(stats.cpc, symbol)}</strong>
        <Vs value={stats.cpcVsAcct} lowerIsBetter />
      </Stat>
      <Stat label="Purchases">
        <strong>{Math.round(stats.purchases)}</strong>
      </Stat>
    </div>
  );
}

function scoreTitle(c) {
  return Object.entries(c.parts)
    .filter(([, v]) => v != null)
    .map(([k, v]) => `${FACTOR_LABELS[k]} ${Math.round(v * 100)}%`)
    .join(" · ");
}

export default function PushAds({ flag, accountId, tz, symbol, pausedAdIds }) {
  const [pool, setPool] = useState(null);
  const [error, setError] = useState(null);
  const [pickedPush, setPickedPush] = useState(() => new Set());
  const [pickedPause, setPickedPause] = useState(() => new Set());
  const [busy, setBusy] = useState(null); // "push" | "pause"
  const [done, setDone] = useState({}); // creativeId / adId -> { ok, text?, error? }

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
  const ranked = useMemo(() => (pool ? rankPushCandidates({ pool, adsetId, pausedAdIds }) : null), [pool, adsetId, pausedAdIds]);
  const isStarvedRule = flag.matchedRules.some((r) => r.id === "new-creative-01");
  const starved = useMemo(() => (pool && isStarvedRule ? starvedAds({ pool, adsetId }) : []), [pool, adsetId, isStarvedRule]);

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

  const adsetAdsCount = ranked.mainLanding?.totalAds;
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
                  <Thumb size={44} src={a.thumbnailUrl} isVideo={a.format === "Video"} />
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
                ? `Most of this ad set's ads (${ranked.mainLanding.adCount} of ${adsetAdsCount}) go to ${ranked.mainLanding.key}. Ranked by that landing page, ROAS, CTR, CPC, consistency, evidence and freshness — compared across every ad that uses the creative.`
                : "Ranked by ROAS, CTR, CPC, consistency, evidence and freshness — compared across every ad that uses the creative."}
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
            No proven creatives to add yet — none of the account&apos;s other creatives has 10+ purchases (or spend above 3× the account&apos;s cost per purchase) and beats the account&apos;s 30-day ROAS. Upload a fresh one in Ads Manager.
          </p>
        ) : (
          <div className={styles.pushList}>
            {ranked.candidates.map((c) => {
              const r = done[c.creativeId];
              return (
                <div key={c.creativeId} className={styles.pushRow}>
                  <input type="checkbox" aria-label={`Select ${c.name}`} checked={pickedPush.has(c.creativeId) && !r?.ok} disabled={r?.ok || !!busy} onChange={() => toggle(setPickedPush)(c.creativeId)} />
                  <Thumb size={44} src={c.thumbnailUrl} isVideo={c.format === "Video"} />
                  <div className={styles.pushMain}>
                    <div className={styles.recName}>
                      <span className={styles.badgeInfo} style={{ flexShrink: 0 }}>
                        {c.format || "Ad"}
                      </span>
                      <span title={c.name}>{c.name}</span>
                    </div>
                    <div className={styles.recWhere} title={c.where}>
                      Runs in {c.where || "another ad set"}
                      {c.adCount > 1 ? ` · ${c.adCount} ads use this creative` : ""}
                    </div>
                    <div className={styles.pushTags}>
                      {c.tags.map((t) => (
                        <span key={t} className={t.startsWith("Main landing") ? styles.badgeGood : styles.badgeInfo}>
                          {t}
                        </span>
                      ))}
                      {r && <span style={{ color: r.ok ? "var(--green)" : "var(--red)", fontSize: 12 }}>{r.ok ? `✓ ${r.text}` : r.error}</span>}
                    </div>
                  </div>
                  <StatsRow stats={c.stats} symbol={symbol} />
                  <div className={styles.pushScore} title={scoreTitle(c)}>
                    <span className={styles.recMetricLabel}>Score</span>
                    <strong>{c.score}</strong>
                  </div>
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
