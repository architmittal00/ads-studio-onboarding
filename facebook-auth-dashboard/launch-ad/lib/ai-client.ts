import { useEffect, useState } from 'react';
import type { AiStatus } from './ai-types';
import { apiGet } from './client-api';

let pending: Promise<AiStatus> | null = null;

/** Whether AI writing is set up on this server; asked once and shared by everything that needs it. */
export function useAiStatus(): AiStatus | undefined {
  const [status, setStatus] = useState<AiStatus | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    if (!pending) pending = apiGet<AiStatus>('ai-status').catch((e) => { pending = null; throw e; });
    pending.then((s) => { if (alive) setStatus(s); }).catch(() => undefined);
    return () => { alive = false; };
  }, []);
  return status;
}
