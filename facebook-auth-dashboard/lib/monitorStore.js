import { useCallback, useEffect, useSyncExternalStore } from "react";
import { useSession } from "next-auth/react";

// The Monitor watchlist: campaigns, ad sets and ads a marketer wants to keep an eye on without acting yet.
//
// Signed in with Google (the normal case) the list lives in the database, keyed by Google email, as a log of what was added
// and when (lib/monitorDb.js); nothing about it is kept in the browser. Items this browser saved before that are carried
// over once, with the time they were originally added, then removed from the browser. Without a Google sign-in (Google auth
// off) it behaves as it always did: saved in this browser under the signed-in user's id.
// Per-account view settings (metrics, date range, colour scales) stay in this browser either way.
//
// state: { items: [{ key, level, entityId, name, accountId, campaignName, adsetName, source, addedAt }],
//          prefs: { [accountId]: { metricKeys, rangePreset, customSince, customUntil, colorScales } },
//          loaded, error }
const STORAGE_PREFIX = "monitor:v1:";
export const MAX_MONITORED = 500;
const EMPTY = { items: [], prefs: {}, loaded: false, error: null };
const REFRESH_MIN_MS = 30000;

export const monitorKey = (level, entityId) => `${level}:${entityId}`;

let userId = null;
let email = null;
let snapshot = EMPTY;
let lastLoad = 0;
const listeners = new Set();

function readStored() {
  if (!userId) return { items: [], prefs: {} };
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_PREFIX + userId) || "null");
    return {
      items: Array.isArray(parsed?.items) ? parsed.items.filter((i) => i && i.key && i.level && i.entityId && i.accountId) : [],
      prefs: parsed?.prefs && typeof parsed.prefs === "object" ? parsed.prefs : {},
    };
  } catch {
    return { items: [], prefs: {} };
  }
}

function publish(next) {
  snapshot = next;
  listeners.forEach((l) => l());
}

// With the database holding the list, the browser keeps only the settings.
function persistLocal(next) {
  if (!userId) return;
  try {
    localStorage.setItem(STORAGE_PREFIX + userId, JSON.stringify({ items: email ? [] : next.items, prefs: next.prefs }));
  } catch {}
}

function save(next) {
  persistLocal(next);
  publish(next);
}

async function call(body) {
  const res = await fetch("/api/monitor", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`Monitor ${body.action} failed (${res.status})`);
  return res.json();
}

async function fetchItems() {
  const res = await fetch("/api/monitor");
  if (!res.ok) throw new Error(`Monitor load failed (${res.status})`);
  return (await res.json()).items || [];
}

async function load(who) {
  try {
    // First time this person opens Monitor since the move: carry over what this browser already held, once.
    const legacy = readStored();
    if (legacy.items.length > 0) {
      await call({ action: "import", items: legacy.items });
      persistLocal({ items: [], prefs: legacy.prefs });
    }
    const items = await fetchItems();
    if (email !== who) return;
    lastLoad = Date.now();
    publish({ ...snapshot, items, loaded: true, error: null });
  } catch (err) {
    if (email !== who) return;
    publish({ ...snapshot, loaded: true, error: err.message || "Could not load Monitor" });
  }
}

export function setMonitorUser(id, googleEmail) {
  const nextId = id ? String(id) : null;
  const nextEmail = nextId && googleEmail ? String(googleEmail).toLowerCase() : null;
  if (nextId === userId && nextEmail === email) return;
  userId = nextId;
  email = nextEmail;
  const stored = readStored();
  if (!userId) return publish(EMPTY);
  if (!email) return publish({ items: stored.items, prefs: stored.prefs, loaded: true, error: null });
  publish({ items: [], prefs: stored.prefs, loaded: false, error: null });
  void load(email);
}

export function addMonitorItem(item) {
  if (!userId || !snapshot.loaded || snapshot.error) return false;
  const key = monitorKey(item.level, item.entityId);
  if (snapshot.items.some((i) => i.key === key) || snapshot.items.length >= MAX_MONITORED) return false;
  const entry = { ...item, key, addedAt: Date.now() };
  save({ ...snapshot, items: [...snapshot.items, entry] });
  if (email) {
    const who = email;
    call({ action: "add", item: entry }).catch(() => {
      // Not saved: take it back off the list rather than show something the database doesn't have.
      if (email === who) publish({ ...snapshot, items: snapshot.items.filter((i) => i.key !== key) });
    });
  }
  return true;
}

export function removeMonitorItem(key) {
  save({ ...snapshot, items: snapshot.items.filter((i) => i.key !== key) });
  if (email) {
    const who = email;
    call({ action: "remove", key }).catch(() => {
      if (email === who) void load(who);
    });
  }
}

export function setMonitorPrefs(accountId, patch) {
  save({ ...snapshot, prefs: { ...snapshot.prefs, [accountId]: { ...(snapshot.prefs[accountId] || {}), ...patch } } });
}

function subscribe(listener) {
  listeners.add(listener);
  // Another tab of this browser changed the settings (or, without the database, the list).
  const onStorage = (e) => {
    if (e.key !== STORAGE_PREFIX + userId) return;
    const stored = readStored();
    publish(email ? { ...snapshot, prefs: stored.prefs } : { ...snapshot, items: stored.items, prefs: stored.prefs });
  };
  // Someone else's change (another browser, a teammate on the same login) shows up when this tab is looked at again.
  const onVisible = () => {
    if (document.visibilityState !== "visible" || !email || !snapshot.loaded || Date.now() - lastLoad < REFRESH_MIN_MS) return;
    lastLoad = Date.now(); // before the request, so several listeners on one page don't each start a load
    void load(email);
  };
  window.addEventListener("storage", onStorage);
  document.addEventListener("visibilitychange", onVisible);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
    document.removeEventListener("visibilitychange", onVisible);
  };
}

// items / prefs plus helpers. Call it from any screen that adds to or lists the watchlist.
export function useMonitor() {
  const { data: session, status } = useSession();
  const id = session?.user?.id || null;
  const googleEmail = session?.googleEmail || null;
  useEffect(() => {
    setMonitorUser(id, googleEmail);
  }, [id, googleEmail]);
  const state = useSyncExternalStore(subscribe, () => snapshot, () => EMPTY);
  const isMonitored = useCallback((level, entityId) => state.items.some((i) => i.key === monitorKey(level, entityId)), [state]);
  return {
    ready: status !== "loading" && !!id && state.loaded,
    error: state.error,
    items: state.items,
    prefs: state.prefs,
    isMonitored,
    add: addMonitorItem,
    remove: removeMonitorItem,
    setPrefs: setMonitorPrefs,
  };
}
