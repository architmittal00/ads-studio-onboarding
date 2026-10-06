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
