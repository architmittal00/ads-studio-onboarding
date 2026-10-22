import { useEffect, useMemo, useState } from "react";
import Loader from "../Loader";
import CreatorAdsDrawer from "./CreatorAdsDrawer";
import { getPermissionRequestLog } from "@/lib/clientStorage";
import { fetchWithTimeout, parseJsonResponse } from "@/lib/fetchJson";
import { groupByCreator } from "@/lib/partnershipCreatorStats";
import styles from "@/styles/Home.module.css";

// Status pill for one of Meta's own permission_status values. AUTHORIZED is
// the only value confirmed from the reference material; the others are
// best-effort guesses at what a pending/declined state is actually spelled
// (never seen in the wild yet) — if a real account returns something this
// doesn't recognize, it falls through to a plain, unstyled label rather than
// silently miscategorizing it as approved or denied.
function StatusPill({ status }) {
  const s = (status || "").toUpperCase();
  if (s === "AUTHORIZED") return <span className={styles.badgeGood}>✓ Approved</span>;
  if (s === "PENDING" || s === "REQUESTED") return <span className={styles.badgeWarn}>⏳ Pending</span>;
  if (s === "DECLINED" || s === "REJECTED" || s === "UNAUTHORIZED") return <span className={styles.badgeDanger}>✕ Declined</span>;
  return <span className={styles.badgeInfo}>{status || "Unknown"}</span>;
}

function formatDate(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return "—";
  }
}

// My Requests: the live, authoritative list of this IG account's
// branded-content permission records (one row per creator — see
// pages/api/fb/partnership/permissions.js's own comment for why this is
// creator-level, not content-level), decorated with locally-remembered
// context (which content prompted the request, when) wherever a matching
// log entry exists on this device. Status always comes from Graph; a
// request sent seconds ago may not show up here yet (Graph's own
// eventual-consistency, not a bug in this page) — refresh if a just-sent
// request doesn't appear right away.
export default function RequestsTab({ igUserId, ready, ads, currency, perfLoading, perfHasLoaded, onCheckPerformance, canCheckPerformance }) {
  const [state, setState] = useState({ loading: false, error: null, permissions: [] });
  const [openCreator, setOpenCreator] = useState(null);

  // Lets a row open the same per-creator ads drawer Creator Hub uses —
  // reusing its exact grouping (lib/partnershipCreatorStats.js) rather than a
  // separate fetch. The two datasets don't share a join key in practice:
  // Graph's permission records key creators by `creator_ig_id`, but ads from
  // /api/fb/partnership/mine (My Partnership Ads/Creator Hub's shared fetch)
  // never actually get a resolved creatorIgId (only a username, from an IG
  // Media lookup — see pages/api/fb/partnership/mine.js) — groupByCreator's
  // own `ad.creatorIgId ||` fallback already accounts for this and buckets by
  // username in practice. So matching here is deliberately by username, not
  // id, with the same caveats a different Instagram handle would bring. The
  // ads themselves are also whatever window Overview/My Partnership
  // Ads/Creator Hub last checked (not the creator's full history, and not
  // this tab's own range), since that's the one ad-performance fetch this
  // page already makes.
  const creatorsByUsername = useMemo(() => {
    const map = new Map();
    for (const c of groupByCreator(ads || [])) {
      if (c.creatorUsername) map.set(c.creatorUsername.toLowerCase(), c);
    }
    return map;
  }, [ads]);

  useEffect(() => {
    if (!ready || !igUserId) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- kicks off an async fetch that itself sets loading/error/result state, not a derived-state anti-pattern
    setState({ loading: true, error: null, permissions: [] });
    fetchWithTimeout(`/api/fb/partnership/permissions?igUserId=${encodeURIComponent(igUserId)}`)
      .then(parseJsonResponse)
      .then((json) => {
        if (cancelled) return;
        if (json.error) setState({ loading: false, error: json.error, permissions: [] });
        else setState({ loading: false, error: null, permissions: json.permissions || [] });
      })
      .catch((err) => {
        if (!cancelled) setState({ loading: false, error: err.message, permissions: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [igUserId, ready]);

  const rows = useMemo(() => {
    if (!igUserId) return [];
    const log = getPermissionRequestLog(igUserId);
    return state.permissions.map((p) => {
      const key = p.creator_ig_id;
      const matches = log.filter((e) => e.creatorIgId === key || (e.creatorUsername && e.creatorUsername === p.creator_username));
      const latest = matches.sort((a, b) => new Date(b.requestedAt) - new Date(a.requestedAt))[0];
      return {
        key: p.creator_ig_id || p.creator_username,
        creatorUsername: p.creator_username,
        status: p.permission_status,
        requestedAt: latest?.requestedAt || null,
        requestCount: matches.length,
      };
    });
  }, [state.permissions, igUserId]);

  if (!ready) {
    return <p className={styles.sub}>Pick an ad account and Instagram Business Account above to see this.</p>;
  }
  if (state.loading) return <Loader label="Loading permission requests…" />;
  if (state.error) return <div className={styles.error}>{state.error}</div>;
  if (rows.length === 0) {
    return (
      <section className={styles.card} style={{ textAlign: "center", padding: "48px 24px" }}>
        <p style={{ fontWeight: 700, marginBottom: 6 }}>No requests yet</p>
        <p className={styles.sub}>Request permission from a creator in Explore Ads to see it tracked here.</p>
      </section>
    );
  }

  return (
    <div>
      {!perfHasLoaded && (
        <div className={styles.card} style={{ padding: 12, marginBottom: 12, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span className={styles.sub} style={{ margin: 0 }}>
            Check ad performance to see a creator&apos;s own ads from here.
          </span>
          <button type="button" className={styles.btnSecondary} disabled={!canCheckPerformance || perfLoading} onClick={onCheckPerformance}>
            {perfLoading ? "Checking…" : "Check Performance"}
          </button>
        </div>
      )}
      <div className={styles.tableScroll}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Creator</th>
              <th>Requested On</th>
              <th>Status</th>
              <th>Ads</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const matched = r.creatorUsername ? creatorsByUsername.get(r.creatorUsername.toLowerCase()) : null;
              return (
                <tr
                  key={r.key}
                  onClick={() => matched && setOpenCreator(matched)}
                  style={matched ? { cursor: "pointer" } : undefined}
                  title={matched ? "View this creator's ads" : perfHasLoaded ? "No ads found for this creator in the current window" : undefined}
                >
                  <td style={{ fontWeight: 600 }}>@{r.creatorUsername || r.key}</td>
                  <td>{formatDate(r.requestedAt)}</td>
                  <td>
                    <StatusPill status={r.status} />
                  </td>
                  <td className={styles.muted}>{matched ? `${matched.adCount} ad${matched.adCount === 1 ? "" : "s"}` : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <CreatorAdsDrawer creator={openCreator} currency={currency} onClose={() => setOpenCreator(null)} />
    </div>
  );
}
