import { useCallback, useEffect, useSyncExternalStore } from "react";
import { useSession } from "next-auth/react";

// The Monitor watchlist: campaigns, ad sets and ads a marketer wants to keep an eye on without acting yet. Saved in this
// browser under the signed-in user's id (there is no server-side store), so it is theirs alone and survives reloads and
// sign-out; another person signing in on the same browser has their own, separate list.
//
// state: { items: [{ key, level, entityId, name, accountId, campaignName, adsetName, addedAt }],
//          prefs: { [accountId]: { metricKeys, rangePreset, customSince, customUntil, colorScales } } }
const STORAGE_PREFIX = "monitor:v1:";
export const MAX_MONITORED = 500;
const EMPTY = { items: [], prefs: {} };

export const monitorKey = (level, entityId) => `${level}:${entityId}`;

let userId = null;
let snapshot = EMPTY;
const listeners = new Set();

function readStored() {
  if (!userId) return EMPTY;
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_PREFIX + userId) || "null");
    return {
      items: Array.isArray(parsed?.items) ? parsed.items.filter((i) => i && i.key && i.level && i.entityId && i.accountId) : [],
      prefs: parsed?.prefs && typeof parsed.prefs === "object" ? parsed.prefs : {},
    };
  } catch {
    return EMPTY;
  }
}

function publish(next) {
  snapshot = next;
  listeners.forEach((l) => l());
}

function save(next) {
  if (userId) {
    try {
      localStorage.setItem(STORAGE_PREFIX + userId, JSON.stringify(next));
    } catch {}
  }
  publish(next);
}

export function setMonitorUser(id) {
  const next = id ? String(id) : null;
  if (next === userId) return;
  userId = next;
  publish(readStored());
}

export function addMonitorItem(item) {
  if (!userId) return false;
  const key = monitorKey(item.level, item.entityId);
  if (snapshot.items.some((i) => i.key === key) || snapshot.items.length >= MAX_MONITORED) return false;
  save({ ...snapshot, items: [...snapshot.items, { ...item, key, addedAt: Date.now() }] });
  return true;
}

export function removeMonitorItem(key) {
  save({ ...snapshot, items: snapshot.items.filter((i) => i.key !== key) });
}

export function setMonitorPrefs(accountId, patch) {
  save({ ...snapshot, prefs: { ...snapshot.prefs, [accountId]: { ...(snapshot.prefs[accountId] || {}), ...patch } } });
}

function subscribe(listener) {
  listeners.add(listener);
  // Another tab of this browser changed the list.
  const onStorage = (e) => {
    if (e.key === STORAGE_PREFIX + userId) publish(readStored());
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

// items / prefs plus helpers. Call it from any screen that adds to or lists the watchlist.
export function useMonitor() {
  const { data: session, status } = useSession();
  const id = session?.user?.id || null;
  useEffect(() => {
    setMonitorUser(id);
  }, [id]);
  const state = useSyncExternalStore(subscribe, () => snapshot, () => EMPTY);
  const isMonitored = useCallback((level, entityId) => state.items.some((i) => i.key === monitorKey(level, entityId)), [state]);
  return {
    ready: status !== "loading" && !!id,
    items: state.items,
    prefs: state.prefs,
    isMonitored,
    add: addMonitorItem,
    remove: removeMonitorItem,
    setPrefs: setMonitorPrefs,
  };
}
