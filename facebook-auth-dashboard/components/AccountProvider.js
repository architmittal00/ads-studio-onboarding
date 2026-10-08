import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { getLastAccountId, setLastAccountId } from "@/lib/clientStorage";
import { getCachedEntry, setCachedEntry } from "@/lib/clientCache";

const ACCOUNT_DATA_CACHE_KEY = "account-data";

const AccountContext = createContext(null);

// Single shared source of truth for "what Facebook data/accounts does this
// user have" — profile, Pages, and ad accounts, fetched once via
// /api/fb/data and cached (lib/clientCache.js, 30 min) instead of every page
// independently re-fetching it on mount, which is what pages/dashboard.js,
// pages/report.js, and pages/strategy.js each did before this. Mounted in
// pages/_app.js, above every page, so `selectedAccountId` also now carries
// over automatically when navigating between tabs within a session (the
// Provider isn't remounted by client-side route changes) — localStorage
// (via getLastAccountId/setLastAccountId) additionally gives cross-session
// continuity, same as before.
export function AccountProvider({ children }) {
  const { status } = useSession();

  const [profile, setProfile] = useState(null);
  const [pages, setPages] = useState([]);
  const [adAccounts, setAdAccounts] = useState([]);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [accountsError, setAccountsError] = useState(null);
  const [accountsFetchedAt, setAccountsFetchedAt] = useState(null);
  const [selectedAccountId, setSelectedAccountIdState] = useState("");

  const load = useCallback((force) => {
    if (!force) {
      const cached = getCachedEntry(ACCOUNT_DATA_CACHE_KEY);
      if (cached) {
        setProfile(cached.data.profile);
        setPages(cached.data.pages || []);
        setAdAccounts(cached.data.adAccounts || []);
        setAccountsFetchedAt(cached.fetchedAt);
        setAccountsError(null);
        return;
      }
    }

    setAccountsLoading(true);
    setAccountsError(null);
    fetch("/api/fb/data")
      .then((res) => res.json())
      .then((json) => {
        if (json.error) {
          setAccountsError(json.error);
          return;
        }
        setProfile(json.profile || null);
        setPages(json.pages || []);
        setAdAccounts(json.adAccounts || []);
        setAccountsFetchedAt(Date.now());
        setCachedEntry(ACCOUNT_DATA_CACHE_KEY, json);
      })
      .catch((err) => setAccountsError(err.message))
      .finally(() => setAccountsLoading(false));
  }, []);

  useEffect(() => {
    // The login page ("/") also renders through pages/_app.js, so without
    // this gate every visitor would trigger a doomed, 401-bound
    // /api/fb/data call before they've even signed in.
    if (status !== "authenticated") return;
    // Kicks off an async fetch (which itself sets loading/error/result
    // state) — intentional, not a derived-state anti-pattern.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fires once per authenticated session, `load` is stable
  }, [status]);

  // Seeds the selection from the last account used on this device, falling
  // back to the first ad account — centralizing logic that was previously
  // duplicated (slightly differently) across dashboard.js, report.js, and
  // strategy.js.
  useEffect(() => {
    if (adAccounts.length === 0 || selectedAccountId) return;
    const lastId = getLastAccountId();
    const stillExists = adAccounts.some((a) => a.id === lastId);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time seed from fetched data + a localStorage read, not a derived-state anti-pattern
    setSelectedAccountIdState(stillExists ? lastId : adAccounts[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- selectedAccountId intentionally excluded, see guard above
  }, [adAccounts]);

  function setSelectedAccountId(id) {
    setSelectedAccountIdState(id);
    if (id) setLastAccountId(id);
  }

  const value = {
    profile,
    pages,
    adAccounts,
    accountsLoading,
    accountsError,
    accountsFetchedAt,
    selectedAccountId,
    setSelectedAccountId,
    refreshAccounts: () => load(true),
  };

  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}

export function useAccounts() {
  const ctx = useContext(AccountContext);
  if (!ctx) throw new Error("useAccounts() must be used within an AccountProvider");
  return ctx;
}
