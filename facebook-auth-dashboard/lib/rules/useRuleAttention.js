import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchWithTimeout, parseJsonResponse } from "@/lib/fetchJson";
import { getCachedEntry, setCachedEntry, clearCachedEntry } from "@/lib/clientCache";
import { toLeanFlag } from "@/lib/rules/leanFlag";

// Runs the Rules page's checks in the background for the accounts of a Custom View and reports which
// rows need attention. It calls the same /api/fb/rules/check route (lean variant, narrowed to the level
// on screen) so the rules themselves live in one place (lib/rules/*). Never blocks the view: callers
// start it once their own result is on screen.
const CHECK_TTL_MS = 30 * 60 * 1000;
const MAX_ACCOUNTS = 8;
const CONCURRENCY = 2;
const RULE_LEVELS = new Set(["campaign", "adset", "ad"]);

// Rule results are kept 30 minutes: in memory (so switching between Custom View tabs is instant and
// shows no "Checking rules…") and in localStorage (so a reload doesn't redo them). Hard refresh and any
// action on a flagged row drop an account's entries.
const memory = new Map(); // "accountId:level" -> { at, flags }

// Drops an account's saved checks (the Rules page's full one and Custom Views' light ones) — call after
// a budget or status change or a hard refresh so a stale flag does not come back from the cache.
export function clearRuleCaches(accountId) {
  clearCachedEntry(`rules-check:${accountId}`);
  for (const level of RULE_LEVELS) {
    clearCachedEntry(`rules-attn:${accountId}:${level}`);
    memory.delete(`${accountId}:${level}`);
  }
}

export const attentionKey = (accountId, entityType, entityId) => `${accountId}:${entityType}:${entityId}`;

// A result the Rules page already saved (full variant) answers this without any request.
function fromFullCache(accountId, level) {
  const entry = getCachedEntry(`rules-check:${accountId}`, CHECK_TTL_MS);
  if (!entry?.data?.flags) return null;
  return { at: entry.fetchedAt, flags: entry.data.flags.filter((f) => f.entityType === level).map(toLeanFlag) };
}

// Saved flags for one account and level, or null when there are none (or they are older than 30 minutes).
function cachedFlags(accountId, level) {
  const key = `${accountId}:${level}`;
  const hit = memory.get(key);
  if (hit && Date.now() - hit.at < CHECK_TTL_MS) return hit.flags;
  // Keep the original fetch time so a result is never treated as younger than it is.
  const light = getCachedEntry(`rules-attn:${accountId}:${level}`, CHECK_TTL_MS);
  const saved = fromFullCache(accountId, level) || (light ? { at: light.fetchedAt, flags: light.data } : null);
  if (!saved) return null;
  memory.set(key, saved);
  return saved.flags;
}

async function loadFlags(account, level) {
  const saved = cachedFlags(account.id, level);
  if (saved) return saved;
  const tz = account.timezone_name ? `&tz=${encodeURIComponent(account.timezone_name)}` : "";
  const res = await fetchWithTimeout(`/api/fb/rules/check?accountId=${encodeURIComponent(account.id)}&lean=1&levels=${level}${tz}`, {}, 130000);
  const json = await parseJsonResponse(res);
  if (!res.ok || json.error) throw new Error(json.error || `Request failed (${res.status})`);
  // A result missing its 48-hour cool-down check isn't worth keeping.
  if (json.heldChecked) {
    memory.set(`${account.id}:${level}`, { at: Date.now(), flags: json.flags });
    setCachedEntry(`rules-attn:${account.id}:${level}`, json.flags, { prefix: "rules-attn:", maxEntriesForPrefix: 40 });
  }
  return json.flags;
}

const toMap = (byTask) => {
  const byKey = new Map();
  for (const [accountId, flags] of byTask) for (const f of flags) byKey.set(attentionKey(accountId, f.entityType, f.entityId), { ...f, accountId });
  return byKey;
};

// Entities the user already acted on (paused, budget changed): hidden for the same 30 minutes the saved
// results live, so they don't come back when a tab is revisited.
const dismissedAt = new Map(); // entityId -> time
const isDismissed = (entityId) => {
  const at = dismissedAt.get(String(entityId));
  return at != null && Date.now() - at < CHECK_TTL_MS;
};

const IDLE = { byKey: new Map(), loading: false, done: 0, total: 0, failed: 0 };

// `accounts`: [{ id, timezone_name }] for the view; `level`: the view's entity level; `ready`: true once
// the view's own result is shown; `refreshKey`: bumped after a hard refresh (the caller has cleared the
// saved results by then), so the check runs again.
//
// Every entity is judged on its own: an ad can need attention while its ad set is fine and the other way
// round. The view's own level is checked up front; `ensureLevel("ad")` adds another level (a drilled-into
// child list) on demand, so marks can also show on those rows without checking levels nobody opened.
export function useRuleAttention({ accounts, level, ready, refreshKey }) {
  const accountsKey = accounts.map((a) => a.id).join(",");
  const baseKey = `${accountsKey}|${level}|${refreshKey}`;
  const [extra, setExtra] = useState({ baseKey: null, levels: [] });
  const [state, setState] = useState({ ...IDLE, key: null });
  const [dismissVersion, setDismissVersion] = useState(0);
  const active = ready && RULE_LEVELS.has(level) && accounts.length > 0;
  const extraLevels = extra.baseKey === baseKey ? extra.levels : [];
  const levels = [level, ...extraLevels];
  const key = `${baseKey}|${extraLevels.join(",")}`;

  // Everything already saved → the answer right now, in the same render (no loader, no flicker when
  // coming back to a tab).
  const snapshot = useMemo(() => {
    if (!active) return null;
    const list = accounts.slice(0, MAX_ACCOUNTS);
    const byTask = [];
    for (const lv of levels) {
      for (const a of list) {
        const flags = cachedFlags(a.id, lv);
        if (!flags) return null;
        byTask.push([a.id, flags]);
      }
    }
    return { byKey: toMap(byTask), loading: false, done: byTask.length, total: byTask.length, failed: 0 };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the account ids, levels and refresh, not the array identity
  }, [active, key]);

  useEffect(() => {
    if (!active) return;
    if (snapshot) return; // answered from the saved results above
    let cancelled = false;
    const list = accounts.slice(0, MAX_ACCOUNTS);
    const tasks = levels.flatMap((lv) => list.map((account) => ({ account, level: lv })));
    // Whatever is already saved is shown straight away; only the rest is fetched.
    const byTask = [];
    const todo = [];
    for (const t of tasks) {
      const flags = cachedFlags(t.account.id, t.level);
      if (flags) byTask.push([t.account.id, flags]);
      else todo.push(t);
    }
    let done = byTask.length;
    let failed = 0;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- starts the background check for this view
    setState({ key, byKey: toMap(byTask), loading: true, done, total: tasks.length, failed: 0 });
    let next = 0;
    async function worker() {
      while (next < todo.length && !cancelled) {
        const t = todo[next++];
        try {
          byTask.push([t.account.id, await loadFlags(t.account, t.level)]);
        } catch {
          failed++;
        }
        done++;
        if (!cancelled) setState({ key, byKey: toMap(byTask), loading: done < tasks.length, done, total: tasks.length, failed });
      }
    }
    // A short pause so the view's own rendering and thumbnail lookups get the first go.
    const timer = setTimeout(() => Promise.all(Array.from({ length: Math.min(CONCURRENCY, todo.length) }, worker)), 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the account ids, levels and refresh, not the array identity
  }, [active, key, snapshot]);

  const shown = !active ? IDLE : snapshot || (state.key === key ? state : { ...IDLE, loading: true, total: Math.min(accounts.length, MAX_ACCOUNTS) * levels.length });
  const dismiss = useCallback((entityId) => {
    dismissedAt.set(String(entityId), Date.now());
    setDismissVersion((v) => v + 1);
  }, []);
  const ensureLevel = useCallback(
    (lv) => {
      if (!RULE_LEVELS.has(lv) || lv === level) return;
      setExtra((prev) => {
        const levelsNow = prev.baseKey === baseKey ? prev.levels : [];
        return levelsNow.includes(lv) ? prev : { baseKey, levels: [...levelsNow, lv] };
      });
    },
    [level, baseKey]
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps -- dismissVersion changes whenever the dismissed set does
  const flags = useMemo(() => new Map([...shown.byKey].filter(([, f]) => !isDismissed(f.entityId))), [shown.byKey, dismissVersion]);

  // Rows needing attention at the view's own level (drilled-into child rows are marked but not counted here).
  const count = useMemo(() => [...flags.values()].filter((f) => f.entityType === level).length, [flags, level]);

  return { flags, count, loading: shown.loading, done: shown.done, total: shown.total, failed: shown.failed, dismiss, ensureLevel };
}
