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
