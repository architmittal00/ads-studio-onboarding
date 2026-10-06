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
