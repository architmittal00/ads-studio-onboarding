'use client';
import { addLogGroup } from './api-log';
import type { MetaError } from './types';
import { fetchWithTimeout } from '@/lib/fetchJson';

export class ApiError extends Error {
  meta: MetaError;
  constructor(meta: MetaError) { super(meta.message); this.meta = meta; }
}

async function handle<T>(res: Response, entry: { method: 'GET' | 'POST'; action: string; input: unknown; started: number }): Promise<T> {
  const raw = await res.text();
  // Non-JSON body (gateway / timeout page): say what came back instead of a bare status.
  const json = (() => { try { return JSON.parse(raw); } catch { const snippet = raw.replace(/\s+/g, ' ').trim().slice(0, 200); return { error: { message: `Request failed (${res.status})${snippet ? `: ${snippet}` : ''}` } }; } })();
  addLogGroup({
    at: entry.started,
    method: entry.method,
    action: entry.action,
    input: entry.input,
    status: res.status,
    ms: Date.now() - entry.started,
    ok: res.ok && !json.error && !(json.data && json.data.ok === false),
    output: json.error ? { error: json.error } : json.data,
    calls: Array.isArray(json.log) ? json.log : [],
  });
  if (res.status === 401) {
    window.location.href = '/';
    throw new ApiError({ message: 'Session expired' });
  }
  if (!res.ok || json.error) throw new ApiError(json.error || { message: `Request failed (${res.status})` });
  return json.data as T;
}

// Account-scoped lookup lists that several components ask for at once (pages, pixels,
// catalogs, product sets, campaigns, ad sets…). Remembered for a few minutes and shared
// while in flight, so switching tabs or opening a form again is instant. Cleared after any
// write, so a freshly created campaign / audience shows up straight away. Errors are never kept.
const CACHEABLE = new Set(['adaccounts', 'pages', 'pixels', 'catalogs', 'product-sets', 'products', 'set-health', 'saved-audiences', 'custom-audiences', 'campaigns', 'adsets']);
const READ_CACHE_MS = 3 * 60 * 1000;
const readCache = new Map<string, { at: number; promise: Promise<unknown> }>();
export function clearApiGetCache() { readCache.clear(); }

export function apiGet<T>(action: string, params: Record<string, string | undefined> = {}): Promise<T> {
  if (!CACHEABLE.has(action)) return fetchGet<T>(action, params);
  const key = `${action}?${JSON.stringify(Object.entries(params).filter(([, v]) => v).sort())}`;
  const hit = readCache.get(key);
  if (hit && Date.now() - hit.at < READ_CACHE_MS) return hit.promise as Promise<T>;
  const promise = fetchGet<T>(action, params).catch((e) => { if (readCache.get(key)?.promise === promise) readCache.delete(key); throw e; });
  readCache.set(key, { at: Date.now(), promise });
  return promise;
}

async function fetchGet<T>(action: string, params: Record<string, string | undefined> = {}): Promise<T> {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v) qs.set(k, v); });
  const started = Date.now();
  // Reads are safe to repeat: retry a dropped connection or 502/503 up to 3 times.
  const res = await fetchWithTimeout(`/api/launch-ad/meta/${action}?${qs.toString()}`, { cache: 'no-store' }, 120000);
  return handle<T>(res, { method: 'GET', action, input: Object.fromEntries(qs.entries()), started });
}

export async function apiPost<T>(action: string, body: unknown): Promise<T> {
  const started = Date.now();
  try {
    const res = await fetch(`/api/launch-ad/meta/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return await handle<T>(res, { method: 'POST', action, input: body, started });
  } finally {
    clearApiGetCache(); // a write may add campaigns / ad sets / audiences the lists should now show
  }
}

/** POST raw bytes (a video chunk) with its details in the query string. */
export async function apiPostBytes<T>(action: string, params: Record<string, string>, bytes: Blob): Promise<T> {
  const started = Date.now();
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`/api/launch-ad/meta/${action}?${qs}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: bytes });
  return handle<T>(res, { method: 'POST', action, input: { ...params, bytes: bytes.size }, started });
}

export function errorText(e: unknown): string {
  if (e instanceof ApiError) return e.meta.userMessage || e.meta.message;
  return (e as Error)?.message || 'Something went wrong';
}
