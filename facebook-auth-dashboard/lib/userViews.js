import { VIEW_KINDS, VIEW_KIND_NAMES } from "./userViewsKinds";

// Keeps a person's views (open tabs and their settings, never data) in step with the database, keyed by Google email.
// The browser's localStorage stays the working copy the pages read and write; this module mirrors it:
//   - every save is copied to the database a moment later (debounced), deletions included, because the whole view is replaced;
//   - once per browser session the database copy is pulled in, so a new browser or device shows the same tabs;
//   - the first time a person signs in, whatever views already sit in this browser are saved to the database (nothing changes
//     for them). Views left in the browser by a DIFFERENT person are never uploaded; they are dropped.
// Not signed in with Google (or the database is off): everything stays local exactly as before.
const OWNER_KEY = "fb-dashboard:views-owner";
const PENDING_PREFIX = "fb-dashboard:views-pending:";
const SESSION_FLAG = "fb-dashboard:views-hydrated:";
const SYNC_DELAY_MS = 2000;
const FETCH_TIMEOUT_MS = 4000;

let currentEmail = null;
let hydrated = false;
let hydrateFailed = false; // the database couldn't be reached: this session is local-only, pushes resume next time
const timers = {};
const lastSent = {};

const read = (key) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key, value) => {
  try {
    localStorage.setItem(key, value);
  } catch {}
};
const remove = (key) => {
  try {
    localStorage.removeItem(key);
  } catch {}
};

// Called every render with the signed-in Google email (null when there is none). Cheap and idempotent.
export function setViewsUser(email) {
  const next = email ? String(email).toLowerCase() : null;
  if (next === currentEmail) return;
  currentEmail = next;
  hydrated = false;
  hydrateFailed = false;
  for (const k of Object.keys(lastSent)) delete lastSent[k];
  if (next) {
    try {
      // Already pulled in this browser session (a reload or another page): the local copy is current.
      if (sessionStorage.getItem(SESSION_FLAG + next)) hydrated = true;
    } catch {}
  }
}

export const viewsHydrated = () => hydrated;

// The pages' one write path. Local always; the database copy follows once the person is known and hydration is done.
// Before hydration finishes nothing is written at all, so a page restoring its tabs can't overwrite them with defaults
// (if the database can't be reached it is written locally only, and sent next session).
export function saveView(kind, value) {
  const spec = VIEW_KINDS[kind];
  if (!spec) return;
  if (currentEmail && !hydrated && !hydrateFailed) return;
  write(spec.key, JSON.stringify(value));
  if (!currentEmail) return;
  write(OWNER_KEY, currentEmail);
  write(PENDING_PREFIX + kind, "1");
  clearTimeout(timers[kind]);
  timers[kind] = setTimeout(() => void pushKind(kind), SYNC_DELAY_MS);
}

export function readView(kind) {
  const spec = VIEW_KINDS[kind];
  if (!spec) return null;
  try {
    return JSON.parse(read(spec.key) || "null");
  } catch {
    return null;
  }
}

async function put(kind, raw, keepalive = false) {
  const res = await fetch("/api/user-views", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: `{"kind":${JSON.stringify(kind)},"doc":${raw}}`,
    keepalive,
  });
  return res.ok;
}

async function pushKind(kind) {
  if (!currentEmail || !hydrated) return;
  const spec = VIEW_KINDS[kind];
  const raw = read(spec.key);
  if (!raw || raw === lastSent[kind]) {
    remove(PENDING_PREFIX + kind);
    return;
  }
  try {
    if (await put(kind, raw)) {
      lastSent[kind] = raw;
      // Only clear the flag if nothing was saved meanwhile.
      if (read(spec.key) === raw) remove(PENDING_PREFIX + kind);
    }
  } catch {
    // Offline or the database is down: the flag stays, so the next session pushes it.
  }
}

// Send anything still waiting (page hidden / closed). Best effort: a request this small survives the page going away.
export function flushViews() {
  if (!currentEmail || !hydrated) return;
  for (const kind of VIEW_KIND_NAMES) {
    if (!read(PENDING_PREFIX + kind)) continue;
    clearTimeout(timers[kind]);
    const raw = read(VIEW_KINDS[kind].key);
    if (!raw) continue;
    put(kind, raw, raw.length < 60000).catch(() => {});
  }
}

async function fetchRemote() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch("/api/user-views", { signal: ctrl.signal });
    if (!res.ok) return null;
    return (await res.json()).views || {};
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Once per browser session. Resolves true when it replaced anything the pages may already have read from localStorage
// (so the caller reloads the page's state), false otherwise.
export async function hydrateViews(email) {
  const who = String(email).toLowerCase();
  setViewsUser(who);
  if (hydrated) return false;
  const remote = await fetchRemote();
  if (currentEmail !== who) return false;
  if (!remote) {
    hydrateFailed = true;
    return false;
  }
  const owner = read(OWNER_KEY);
  const mine = owner === who;
  let changed = false;
  for (const kind of VIEW_KIND_NAMES) {
    const key = VIEW_KINDS[kind].key;
    const localRaw = read(key);
    const pending = !!read(PENDING_PREFIX + kind);
    const server = remote[kind];
    if (server) {
      if (mine && pending && localRaw) {
        // This browser has newer, unsent changes: they win, and go up below.
        lastSent[kind] = null;
        await pushNowOrKeep(kind, localRaw);
      } else {
        const raw = JSON.stringify(server.doc);
        if (raw !== localRaw) changed = true;
        write(key, raw);
        lastSent[kind] = raw;
        remove(PENDING_PREFIX + kind);
      }
    } else if (localRaw && (mine || !owner)) {
      // First time this person has views in the database: save what this browser already shows.
      await pushNowOrKeep(kind, localRaw);
    } else if (localRaw) {
      // Views left behind by a different person: not this person's, not uploaded.
      remove(key);
      remove(PENDING_PREFIX + kind);
      changed = true;
    }
  }
  write(OWNER_KEY, who);
  // Nothing replaced: the page already shows the right views, saving may start. Something was replaced: the page is about
  // to start over from the new views, and the old one's last gasp (saving its stale state as it unmounts) must not reach
  // the database, so saving only starts once the caller says the new page is up (finishHydration).
  if (!changed) finishHydration();
  return changed;
}

export function finishHydration() {
  if (!currentEmail) return;
  hydrated = true;
  try {
    sessionStorage.setItem(SESSION_FLAG + currentEmail, "1");
  } catch {}
}

async function pushNowOrKeep(kind, raw) {
  try {
    if (await put(kind, raw)) {
      lastSent[kind] = raw;
      remove(PENDING_PREFIX + kind);
      return;
    }
  } catch {}
  write(PENDING_PREFIX + kind, "1");
}

// Sign-out: this browser no longer holds the person's views (they stay safe in the database).
export function clearLocalViews() {
  if (!currentEmail) return; // not signed in with Google: nothing here belongs to an account, keep it as before
  for (const kind of VIEW_KIND_NAMES) {
    remove(VIEW_KINDS[kind].key);
    remove(PENDING_PREFIX + kind);
    clearTimeout(timers[kind]);
  }
  remove(OWNER_KEY);
  try {
    for (const k of Object.keys(sessionStorage)) if (k.startsWith(SESSION_FLAG)) sessionStorage.removeItem(k);
  } catch {}
  currentEmail = null;
  hydrated = false;
  hydrateFailed = false;
}
