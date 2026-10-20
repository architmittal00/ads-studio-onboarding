import { useEffect, useMemo, useState } from "react";
import Loader from "../Loader";
import { getPermissionRequestLog } from "@/lib/clientStorage";
import { fetchWithTimeout, parseJsonResponse } from "@/lib/fetchJson";
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
export default function RequestsTab({ igUserId, ready }) {
  const [state, setState] = useState({ loading: false, error: null, permissions: [] });

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
    <div className={styles.tableScroll}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Creator</th>
            <th>Requested On</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td style={{ fontWeight: 600 }}>@{r.creatorUsername || r.key}</td>
              <td>{formatDate(r.requestedAt)}</td>
              <td>
                <StatusPill status={r.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
