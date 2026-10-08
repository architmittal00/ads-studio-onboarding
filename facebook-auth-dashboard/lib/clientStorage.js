const LAST_ACCOUNT_KEY = "fb-dashboard:last-account-id";
const DEFAULT_RANGE_KEY = "fb-dashboard:default-range-preset";
const VALID_DEFAULT_RANGES = ["today", "last_7d", "last_30d"];

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
