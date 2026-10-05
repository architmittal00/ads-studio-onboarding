const LAST_ACCOUNT_KEY = "fb-dashboard:last-account-id";

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
