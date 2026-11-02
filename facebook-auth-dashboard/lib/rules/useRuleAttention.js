import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchWithTimeout, parseJsonResponse } from "@/lib/fetchJson";
import { getCachedEntry, setCachedEntry } from "@/lib/clientCache";

// Runs the Rules page's checks in the background for the accounts of a Custom View and reports which
// rows need attention. It calls the same /api/fb/rules/check route (lean variant, narrowed to the level
// on screen) so the rules themselves live in one place (lib/rules/*). Never blocks the view: callers
// start it once their own result is on screen.
const CHECK_TTL_MS = 30 * 60 * 1000;
const MAX_ACCOUNTS = 8;
const CONCURRENCY = 2;
const RULE_LEVELS = new Set(["campaign", "adset", "ad"]);

export const attentionKey = (accountId, entityType, entityId) => `${accountId}:${entityType}:${entityId}`;

// A result the Rules page already saved (full variant) answers this without any request.
function fromFullCache(accountId, level) {
  const full = getCachedEntry(`rules-check:${accountId}`, CHECK_TTL_MS)?.data;
  if (!full?.flags) return null;
  return full.flags.filter((f) => f.entityType === level).map((f) => ({ key: f.key, entityType: f.entityType, entityId: f.entityId, action: f.action, rules: f.matchedRules.map((r) => r.name) }));
}

async function loadFlags(account, level, force) {
  if (!force) {
    const shared = fromFullCache(account.id, level);
    if (shared) return shared;
    const cached = getCachedEntry(`rules-attn:${account.id}:${level}`, CHECK_TTL_MS);
    if (cached) return cached.data;
  }
  const tz = account.timezone_name ? `&tz=${encodeURIComponent(account.timezone_name)}` : "";
  const res = await fetchWithTimeout(`/api/fb/rules/check?accountId=${encodeURIComponent(account.id)}&lean=1&levels=${level}${tz}`, {}, 130000);
  const json = await parseJsonResponse(res);
  if (!res.ok || json.error) throw new Error(json.error || `Request failed (${res.status})`);
  // A result missing its 48-hour cool-down check isn't worth keeping.
  if (json.heldChecked) setCachedEntry(`rules-attn:${account.id}:${level}`, json.flags, { prefix: "rules-attn:", maxEntriesForPrefix: 40 });
  return json.flags;
}

// `accounts`: [{ id, timezone_name }] for the view; `level`: the view's entity level; `ready`: true once
// the view's own result is shown; `refreshKey`: changes on a hard refresh of the view (skips saved results).
export function useRuleAttention({ accounts, level, ready, refreshKey }) {
  const [state, setState] = useState({ byKey: new Map(), loading: false, done: 0, total: 0, failed: 0 });
  // Entities the user already acted on from the view (paused, budget changed): hidden until the next check.
  const [dismissed, setDismissed] = useState(() => new Set());
  const lastRefresh = useRef(refreshKey);
  const accountsKey = accounts.map((a) => a.id).join(",");

  useEffect(() => {
    const force = lastRefresh.current !== refreshKey;
    lastRefresh.current = refreshKey;
    if (!ready || !RULE_LEVELS.has(level) || accounts.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- nothing to check for this view
      setState({ byKey: new Map(), loading: false, done: 0, total: 0, failed: 0 });
      return;
    }
    let cancelled = false;
    setDismissed(new Set());
    const list = accounts.slice(0, MAX_ACCOUNTS);
    const byKey = new Map();
    let done = 0;
    let failed = 0;
    setState({ byKey: new Map(), loading: true, done: 0, total: list.length, failed: 0 });
    let next = 0;
    async function worker() {
      while (next < list.length && !cancelled) {
        const account = list[next++];
        try {
          const flags = await loadFlags(account, level, force);
          for (const f of flags) byKey.set(attentionKey(account.id, f.entityType, f.entityId), f);
        } catch {
          failed++;
        }
        done++;
        if (!cancelled) setState({ byKey: new Map(byKey), loading: done < list.length, done, total: list.length, failed });
      }
    }
    // A short pause so the view's own rendering and thumbnail lookups get the first go.
    const timer = setTimeout(() => Promise.all(Array.from({ length: Math.min(CONCURRENCY, list.length) }, worker)), 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the account ids, level and refresh, not the array identity
  }, [accountsKey, level, ready, refreshKey]);

  const dismiss = useCallback((entityId) => setDismissed((prev) => new Set(prev).add(String(entityId))), []);
  const flags = useMemo(() => {
    if (dismissed.size === 0) return state.byKey;
    return new Map([...state.byKey].filter(([, f]) => !dismissed.has(String(f.entityId))));
  }, [state.byKey, dismissed]);

  return { flags, loading: state.loading, done: state.done, total: state.total, failed: state.failed, dismiss };
}
