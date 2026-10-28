'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { errorText, apiGet, clearApiGetCache } from './client-api';
import { useAccounts } from '@/components/AccountProvider';
import type { AdAccount } from './types';

/** Run an async loader when `key` changes. A null key skips loading. */
export function useAsync<T>(key: string | null, loader: () => Promise<T>) {
  const [data, setData] = useState<T | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');
  const loaderRef = useRef(loader);
  loaderRef.current = loader;
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!key) { setData(undefined); setError(''); setLoading(false); return; }
    let alive = true;
    setLoading(true);
    setError('');
    loaderRef.current()
      .then((d) => { if (alive) setData(d); })
      .catch((e) => { if (alive) { setError(errorText(e)); setData(undefined); } })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [key, tick]);

  // A manual reload means "fetch it again" — never answer it from the read cache.
  const reload = useCallback(() => { clearApiGetCache(); setTick((t) => t + 1); }, []);
  return { data, loading, error, reload };
}

/**
 * The user's ad accounts for the Launch / Catalog Ads screens. The app already loads them
 * once for every page (AccountProvider), so use that — no second Facebook round trip before
 * anything else on the screen can start. Falls back to this app's own endpoint only if the
 * shared list came back empty.
 */
export function useLaunchAccounts() {
  const shared = useAccounts();
  const hasShared = shared.adAccounts.length > 0;
  const fallback = useAsync<AdAccount[]>(!hasShared && !shared.accountsLoading ? 'accounts' : null, () => apiGet<AdAccount[]>('adaccounts'));
  const mapped = useMemo<AdAccount[] | undefined>(
    () => (hasShared ? shared.adAccounts.map((a: any) => ({ ...a, account_id: a.account_id || String(a.id).replace(/^act_/, '') })) : undefined),
    [hasShared, shared.adAccounts],
  );
  return {
    data: mapped ?? fallback.data,
    loading: hasShared ? false : shared.accountsLoading || fallback.loading,
    error: hasShared ? '' : fallback.error || '',
    reload: fallback.reload,
  };
}
