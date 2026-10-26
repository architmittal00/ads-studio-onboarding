'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { errorText } from './client-api';

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

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, loading, error, reload };
}
