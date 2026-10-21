import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { getLastAccountId, setLastAccountId, getLastIgAccountId, setLastIgAccountId } from "@/lib/clientStorage";
import { getCachedEntry, setCachedEntry } from "@/lib/clientCache";

// Exported so components/Sidebar.js can clear it on sign-out — see that
// file's own comment for why signing out needs to do that.
export const ACCOUNT_DATA_CACHE_KEY = "account-data";

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
  // Starts `true`, not `false`: every real page that reaches this provider
  // is already behind a session check (getServerSideProps redirects a
  // signed-out visitor before any client code runs), so accounts are always
  // either about to load or already cached — there's no legitimate "nothing
  // loading, zero accounts" state before the first load attempt even starts.
  // Defaulting to `false` here previously meant that, on first paint (and
  // for however long next-auth's own client-side session check took), a
  // page would see `accountsLoading: false` + `adAccounts: []` simultaneously
  // and render its real "no accounts found" empty state during an ordinary
  // loading window, not just when the account genuinely has none.
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [accountsError, setAccountsError] = useState(null);
  const [accountsFetchedAt, setAccountsFetchedAt] = useState(null);
  const [selectedAccountId, setSelectedAccountIdState] = useState("");
  const [selectedIgAccountId, setSelectedIgAccountIdState] = useState("");

  const load = useCallback((force) => {
    if (!force) {
      const cached = getCachedEntry(ACCOUNT_DATA_CACHE_KEY);
      if (cached) {
        setProfile(cached.data.profile);
        setPages(cached.data.pages || []);
        setAdAccounts(cached.data.adAccounts || []);
        setAccountsFetchedAt(cached.fetchedAt);
        setAccountsError(null);
        setAccountsLoading(false);
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
    // /api/fb/data call before they've even signed in. `status` starts
    // "loading" (next-auth still determining the session) — `accountsLoading`
    // deliberately stays at its initial `true` through that window too, so
    // nothing renders a premature empty state while the session itself is
    // still being resolved. Only a genuinely signed-out visitor (in practice
    // never seen here — every real page redirects server-side first) needs
    // this to explicitly flip back to `false`, since no load will ever fire.
    if (status === "unauthenticated") {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reacting to the session resolving to signed-out, not a derived-state anti-pattern
      setAccountsLoading(false);
      return;
    }
    if (status !== "authenticated") return;
    // Kicks off an async fetch (which itself sets loading/error/result
    // state) — intentional, not a derived-state anti-pattern.
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

  // Pages that actually have a linked Instagram Business Account — most
  // won't (a Page needs to have been explicitly connected to an IG Business
  // or Creator account), so this is routinely a small subset of `pages`, not
  // an error condition. Powers Partnership Ads' own account picker; every
  // other page in this app ignores it entirely.
  const igAccounts = useMemo(
    () =>
      pages
        .filter((p) => p.instagram_business_account)
        .map((p) => ({
          igUserId: p.instagram_business_account.id,
          username: p.instagram_business_account.username,
          profilePictureUrl: p.instagram_business_account.profile_picture_url,
          pageId: p.id,
          pageName: p.name,
        })),
    [pages]
  );

  // Seeds from the last IG account used on this device, same convention as
  // selectedAccountId above — a convenience default only.
  useEffect(() => {
    if (igAccounts.length === 0 || selectedIgAccountId) return;
    const lastId = getLastIgAccountId();
    const stillExists = igAccounts.some((a) => a.igUserId === lastId);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time seed from fetched data + a localStorage read, not a derived-state anti-pattern
    setSelectedIgAccountIdState(stillExists ? lastId : igAccounts[0].igUserId);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- selectedIgAccountId intentionally excluded, see guard above
  }, [igAccounts]);

  function setSelectedIgAccountId(id) {
    setSelectedIgAccountIdState(id);
    if (id) setLastIgAccountId(id);
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
    igAccounts,
    selectedIgAccountId,
    setSelectedIgAccountId,
    refreshAccounts: () => load(true),
  };

  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}

export function useAccounts() {
  const ctx = useContext(AccountContext);
  if (!ctx) throw new Error("useAccounts() must be used within an AccountProvider");
  return ctx;
}
