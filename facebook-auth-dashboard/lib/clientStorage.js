const LAST_ACCOUNT_KEY = "fb-dashboard:last-account-id";
const DEFAULT_RANGE_KEY = "fb-dashboard:default-range-preset";
const VALID_DEFAULT_RANGES = ["today", "last_7d", "last_30d"];
// Same literal key string is duplicated in pages/_document.js's inline
// bootstrap script (which runs before any module, including this one, can
// load) — keep the two in sync if this ever changes.
const THEME_KEY = "fb-dashboard:theme";
const VALID_THEMES = ["light", "dark"];

export function getLastAccountId() {
  try {
    return localStorage.getItem(LAST_ACCOUNT_KEY);
  } catch {
    return null;
  }
}

export function setLastAccountId(id) {
  try {
    localStorage.setItem(LAST_ACCOUNT_KEY, id);
  } catch {
    // Private browsing / blocked storage — silently ignore, nothing to persist to.
  }
}

const LAST_IG_ACCOUNT_KEY = "fb-dashboard:last-ig-account-id";

// Which Instagram Business Account (Partnership Ads) was last selected on
// this device — a convenience default only, same "last used, not load-
// bearing" status as getLastAccountId above, never the source of truth for
// which IG account a given ad account is actually paired with.
export function getLastIgAccountId() {
  try {
    return localStorage.getItem(LAST_IG_ACCOUNT_KEY);
  } catch {
    return null;
  }
}

export function setLastIgAccountId(id) {
  try {
    localStorage.setItem(LAST_IG_ACCOUNT_KEY, id);
  } catch {
    // Private browsing / blocked storage — silently ignore, nothing to persist to.
  }
}

// The date range the report opens to by default on this device — a user
// preference, not tied to whatever range they happened to leave it on last
// (that's a different thing: the report always lands here first, every
// visit). "custom" isn't offered as a default since it needs explicit dates.
export function getDefaultRangePreset() {
  try {
    const value = localStorage.getItem(DEFAULT_RANGE_KEY);
    return VALID_DEFAULT_RANGES.includes(value) ? value : null;
  } catch {
    return null;
  }
}

export function setDefaultRangePreset(preset) {
  try {
    localStorage.setItem(DEFAULT_RANGE_KEY, preset);
  } catch {
    // Private browsing / blocked storage — silently ignore, nothing to persist to.
  }
}

const PIXEL_MAP_KEY = "fb-dashboard:pixel-mapping";

// Which pixel to optimize for when launching a strategy on a given ad
// account — asked once per account, remembered here, changeable anytime.
// Per-browser like everything else in this file: not shared across machines
// or teammates using the same Facebook login.
function readPixelMap() {
  try {
    return JSON.parse(localStorage.getItem(PIXEL_MAP_KEY) || "{}");
  } catch {
    return {};
  }
}

export function getPixelMapping(accountId) {
  return readPixelMap()[accountId] || null;
}

export function setPixelMapping(accountId, pixelId) {
  try {
    const map = readPixelMap();
    map[accountId] = pixelId;
    localStorage.setItem(PIXEL_MAP_KEY, JSON.stringify(map));
  } catch {
    // Private browsing / blocked storage — silently ignore, nothing to persist to.
  }
}

const SIDEBAR_COLLAPSED_KEY = "fb-dashboard:sidebar-collapsed";

// Icon-only (collapsed) vs icon+label (expanded) app sidebar — a per-device
// UI preference, same pattern as everything else here. `null` means "never
// set on this device", letting the component fall back to its own default
// (collapsed, matching the icon-rail sidebar used across the team's other
// internal tools) rather than assuming a stored "false".
export function getSidebarCollapsed() {
  try {
    const value = localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
    return value == null ? null : value === "1";
  } catch {
    return null;
  }
}

export function setSidebarCollapsed(collapsed) {
  try {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? "1" : "0");
  } catch {
    // Private browsing / blocked storage — silently ignore, nothing to persist to.
  }
}

const EXPLORE_QUERY_PANEL_COLLAPSED_KEY = "fb-dashboard:explore-query-panel-collapsed";

// Collapsed (result front and center) vs expanded (query form visible
// side-by-side) state of Explore's query/filters panel — same per-device
// preference pattern as the app sidebar above. `null` means "never set on
// this device"; the page itself decides the default (collapsed) rather than
// assuming a stored "false".
export function getExploreQueryPanelCollapsed() {
  try {
    const value = localStorage.getItem(EXPLORE_QUERY_PANEL_COLLAPSED_KEY);
    return value == null ? null : value === "1";
  } catch {
    return null;
  }
}

export function setExploreQueryPanelCollapsed(collapsed) {
  try {
    localStorage.setItem(EXPLORE_QUERY_PANEL_COLLAPSED_KEY, collapsed ? "1" : "0");
  } catch {
    // Private browsing / blocked storage — silently ignore, nothing to persist to.
  }
}

const COPY_ADS_QUERY_PANEL_COLLAPSED_KEY = "fb-dashboard:copy-ads-query-panel-collapsed";

// Same per-device collapsed/expanded preference as Explore's own query
// panel above, just a separate key — Copy Ads' panel (source account, date
// range, metrics) is a different page with its own independent preference.
export function getCopyAdsQueryPanelCollapsed() {
  try {
    const value = localStorage.getItem(COPY_ADS_QUERY_PANEL_COLLAPSED_KEY);
    return value == null ? null : value === "1";
  } catch {
    return null;
  }
}

export function setCopyAdsQueryPanelCollapsed(collapsed) {
  try {
    localStorage.setItem(COPY_ADS_QUERY_PANEL_COLLAPSED_KEY, collapsed ? "1" : "0");
  } catch {
    // Private browsing / blocked storage — silently ignore, nothing to persist to.
  }
}

const EXPLORE_VIEWS_KEY = "fb-dashboard:explore-views";

// The Explore page's open tabs — each tab's query spec (never its fetched
// result, which is ephemeral and re-derived from lib/clientCache.js's own
// 30-min cache on restore) plus which one was active, so reopening the page
// shows the same tabs instead of a single blank one.
export function getExploreViews() {
  try {
    const parsed = JSON.parse(localStorage.getItem(EXPLORE_VIEWS_KEY) || "null");
    return parsed && Array.isArray(parsed.views) ? parsed : null;
  } catch {
    return null;
  }
}

export function setExploreViews(data) {
  try {
    localStorage.setItem(EXPLORE_VIEWS_KEY, JSON.stringify(data));
  } catch {
    // Private browsing / blocked storage / quota exceeded — silently ignore.
  }
}

const RECENT_CHANGES_TABS_KEY = "fb-dashboard:recent-changes-tabs";

// Recent Changes' own open tabs — each tab's own account/time-window/search
// spec (never its fetched result, which is ephemeral and re-derived from
// lib/clientCache.js's own cache on restore), plus which one is active. One
// account per tab, not a multi-account list, matching this page's own
// narrower single-account design.
export function getRecentChangesTabs() {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_CHANGES_TABS_KEY) || "null");
    return parsed && Array.isArray(parsed.tabs) ? parsed : null;
  } catch {
    return null;
  }
}

export function setRecentChangesTabs(data) {
  try {
    localStorage.setItem(RECENT_CHANGES_TABS_KEY, JSON.stringify(data));
  } catch {
    // Private browsing / blocked storage / quota exceeded — silently ignore.
  }
}

const RECENT_CHANGES_QUERY_PANEL_COLLAPSED_KEY = "fb-dashboard:recent-changes-query-panel-collapsed";

// Collapsed (results front and center) vs expanded (accounts/time-window
// panel visible alongside the results) state of Recent Changes' side panel —
// same per-device preference pattern as Explore's own query-panel collapse.
// `null` means "never set on this device"; the page itself decides the
// default (collapsed) rather than assuming a stored "false".
export function getRecentChangesQueryPanelCollapsed() {
  try {
    const value = localStorage.getItem(RECENT_CHANGES_QUERY_PANEL_COLLAPSED_KEY);
    return value == null ? null : value === "1";
  } catch {
    return null;
  }
}

export function setRecentChangesQueryPanelCollapsed(collapsed) {
  try {
    localStorage.setItem(RECENT_CHANGES_QUERY_PANEL_COLLAPSED_KEY, collapsed ? "1" : "0");
  } catch {
    // Private browsing / blocked storage — silently ignore, nothing to persist to.
  }
}

const CUSTOM_METRICS_KEY = "fb-dashboard:explore-custom-metrics";

// User-defined ratio metrics for Explore (numerator metric ÷ denominator
// metric, both existing catalog keys, plus a label) — shared across every
// open view/tab, not per-view, since these are "what this user has defined"
// rather than part of any one query.
export function getCustomMetrics() {
  try {
    const parsed = JSON.parse(localStorage.getItem(CUSTOM_METRICS_KEY) || "null");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function setCustomMetrics(metrics) {
  try {
    localStorage.setItem(CUSTOM_METRICS_KEY, JSON.stringify(metrics));
  } catch {
    // Private browsing / blocked storage / quota exceeded — silently ignore.
  }
}

// Explicit light/dark override, set via the Sidebar's theme toggle. `null`
// means "no override" — the app follows the device's OS-level preference
// instead (pages/_document.js's bootstrap script and pages/_app.js's
// useSyncThemeWithOs both fall back to that exact same rule).
export function getThemePreference() {
  try {
    const value = localStorage.getItem(THEME_KEY);
    return VALID_THEMES.includes(value) ? value : null;
  } catch {
    return null;
  }
}

export function setThemePreference(theme) {
  try {
    if (theme === null) localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Private browsing / blocked storage — silently ignore, nothing to persist to.
  }
}

const PARTNERSHIP_REQUEST_LOG_KEY = "fb-dashboard:partnership-request-log";
const PARTNERSHIP_REQUEST_LOG_MAX_PER_ACCOUNT = 200;

// Branded-content permission is account-level per creator, not per post —
// Meta's own `branded_content_ad_permissions` list (see
// pages/api/fb/partnership/permissions.js) only ever returns
// {creator_ig_id, creator_username, permission_status}, nothing about which
// specific piece of content prompted a request. "My Requests" wants to show
// that context anyway (what post you were actually looking at when you
// clicked "Request Permission"), so it's kept here, locally, purely as
// decoration — the live permissions list from Graph is always the actual
// source of truth for status; a missing/stale log entry just means that one
// row loses its content thumbnail/caption context, not its status.
function readRequestLog() {
  try {
    return JSON.parse(localStorage.getItem(PARTNERSHIP_REQUEST_LOG_KEY) || "{}");
  } catch {
    return {};
  }
}

export function getPermissionRequestLog(igUserId) {
  return readRequestLog()[igUserId] || [];
}

// `entry`: {creatorIgId, creatorUsername, contentId, brandName, mediaType, requestedAt}.
// Newest first, capped per IG account so a heavy user's log can't grow
// localStorage without bound — same reasoning as lib/clientCache.js's own
// per-prefix entry caps.
export function addPermissionRequestLogEntry(igUserId, entry) {
  try {
    const all = readRequestLog();
    const existing = all[igUserId] || [];
    all[igUserId] = [entry, ...existing].slice(0, PARTNERSHIP_REQUEST_LOG_MAX_PER_ACCOUNT);
    localStorage.setItem(PARTNERSHIP_REQUEST_LOG_KEY, JSON.stringify(all));
  } catch {
    // Private browsing / blocked storage / quota exceeded — silently ignore.
  }
}

const PARTNERSHIP_QUEUE_KEY = "fb-dashboard:partnership-queue";

// The pre-launch queue — items added from Explore Ads ("Add to Queue") or
// the Partnership Code tab, each carrying everything pages/api/fb/partnership/launch.js
// needs: {id, source: "explore"|"code", contentId?, adCode?, name, mediaType,
// permalink?, primaryText, headline, description, cta, redirectionLink}.
// Per-account, same keying convention as getPixelMapping — there is no
// server-side queue (see the saved plan's persistence decision), so this is
// the actual source of truth for "what's queued," not just a cache of it.
function readQueueMap() {
  try {
    return JSON.parse(localStorage.getItem(PARTNERSHIP_QUEUE_KEY) || "{}");
  } catch {
    return {};
  }
}

export function getPartnershipQueue(accountId) {
  return readQueueMap()[accountId] || [];
}

export function setPartnershipQueue(accountId, items) {
  try {
    const all = readQueueMap();
    all[accountId] = items;
    localStorage.setItem(PARTNERSHIP_QUEUE_KEY, JSON.stringify(all));
  } catch {
    // Private browsing / blocked storage / quota exceeded — silently ignore.
  }
}

export function addToPartnershipQueue(accountId, newItems) {
  const existing = getPartnershipQueue(accountId);
  const existingIds = new Set(existing.map((i) => i.id));
  const deduped = newItems.filter((i) => !existingIds.has(i.id));
  setPartnershipQueue(accountId, [...existing, ...deduped]);
  return deduped.length;
}

const PARTNERSHIP_SETTINGS_KEY = "fb-dashboard:partnership-settings";

// The launch wizard's Step 1 ("Pre-filled Settings" in the mockup) — Pixel
// ID, UTM parameter, Facebook Page, Instagram Page, remembered per ad
// account. Unlike the mockup's own hardcoded placeholder values, this is the
// real "General Settings" the mockup's own copy claims it is — edits here
// are what persists, nothing is actually fake-prefilled.
function readPartnershipSettingsMap() {
  try {
    return JSON.parse(localStorage.getItem(PARTNERSHIP_SETTINGS_KEY) || "{}");
  } catch {
    return {};
  }
}

export function getPartnershipSettings(accountId) {
  return readPartnershipSettingsMap()[accountId] || null;
}

export function setPartnershipSettings(accountId, settings) {
  try {
    const all = readPartnershipSettingsMap();
    all[accountId] = settings;
    localStorage.setItem(PARTNERSHIP_SETTINGS_KEY, JSON.stringify(all));
  } catch {
    // Private browsing / blocked storage / quota exceeded — silently ignore.
  }
}
