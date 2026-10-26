import 'server-only';
import { AsyncLocalStorage } from 'async_hooks';
import { createHmac, randomUUID } from 'crypto';
import { GRAPH_URL } from './config';
import type { GraphCall, MetaError } from './types';

/** Collects the Graph calls made while handling one app request (see api/meta route). */
export const graphLog = new AsyncLocalStorage<GraphCall[]>();

const SECRET_KEYS = ['access_token', 'appsecret_proof', 'client_secret', 'fb_exchange_token', 'code'];
const MAX_RESPONSE_CHARS = 40_000;

function readable(params: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params)) {
    if (SECRET_KEYS.includes(k) || v === undefined || v === null) continue;
    if (k === 'bytes' && typeof v === 'string') { out[k] = `[image, ${Math.round((v.length * 3) / 4 / 1024)} KB]`; continue; }
    if (typeof v === 'string' && /^[[{]/.test(v)) {
      try { out[k] = JSON.parse(v); continue; } catch { /* keep string */ }
    }
    out[k] = v;
  }
  return out;
}

function record(entry: Omit<GraphCall, 'id' | 'response' | 'truncated'>, json: unknown) {
  const log = graphLog.getStore();
  if (!log) return;
  let response: unknown = json;
  let truncated = false;
  try {
    // Page tokens come back in some responses; strip them before logging.
    const text = JSON.stringify(json, (k, v) => (k === 'access_token' ? '[hidden]' : v));
    response = JSON.parse(text);
    if (text && text.length > MAX_RESPONSE_CHARS) { response = `${text.slice(0, MAX_RESPONSE_CHARS)}…`; truncated = true; }
  } catch { response = String(json); }
  log.push({ id: randomUUID(), ...entry, response, truncated });
}

export class GraphError extends Error {
  meta: MetaError;
  status: number;
  constructor(meta: MetaError, status = 400) {
    super(meta.message);
    this.meta = meta;
    this.status = status;
  }
}

type Params = Record<string, string | number | boolean | object | undefined | null>;

function encode(params: Params): URLSearchParams {
  const out = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    out.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  }
  return out;
}

function proof(token: string): string | undefined {
  const secret = process.env.FACEBOOK_APP_SECRET;
  if (!secret) return undefined;
  return createHmac('sha256', secret).update(token).digest('hex');
}

type FilePart = { field: string; data: Blob; name: string };

async function call<T>(method: 'GET' | 'POST' | 'DELETE', path: string, token: string, params: Params = {}, file?: FilePart): Promise<T> {
  const auth: Params = { access_token: token, appsecret_proof: proof(token) };
  const url = path.startsWith('http') ? new URL(path) : new URL(`${GRAPH_URL}/${path.replace(/^\//, '')}`);
  const started = Date.now();
  // For logging: what was asked for, minus secrets (paging URLs carry their params in the query string).
  const asked: Record<string, unknown> = { ...Object.fromEntries(url.searchParams.entries()) };
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) asked[k] = typeof v === 'object' ? JSON.stringify(v) : v;
  const logPath = url.pathname.replace(/^\/v\d+\.\d+\//, '');
  let res: Response;
  try {
    if (method === 'GET') {
      const qs = encode({ ...params, ...auth });
      qs.forEach((v, k) => url.searchParams.set(k, v));
      res = await fetch(url, { method, cache: 'no-store' });
    } else if (file) {
      // Binary upload (video chunks): multipart with the other params as fields.
      const fd = new FormData();
      encode({ ...params, ...auth }).forEach((v, k) => fd.set(k, v));
      fd.set(file.field, file.data, file.name);
      asked[file.field] = `<${file.data.size.toLocaleString('en-IN')} bytes>`;
      res = await fetch(url, { method, body: fd, cache: 'no-store' });
    } else {
      res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: encode({ ...params, ...auth }),
        cache: 'no-store',
      });
    }
  } catch (e) {
    // Network-level failure (timeout, DNS): log it, then surface a readable error.
    const message = `Couldn't reach Facebook: ${(e as Error).message}`;
    record({ at: started, method, path: logPath, params: readable(asked), status: 0, ms: Date.now() - started, ok: false }, { error: { message } });
    throw new GraphError({ message }, 502);
  }
  const text = await res.text();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let json: any;
  try { json = JSON.parse(text); } catch { json = { error: { message: text || res.statusText } }; }
  record({ at: started, method, path: logPath, params: readable(asked), status: res.status, ms: Date.now() - started, ok: res.ok && !json?.error }, json);
  if (!res.ok || json?.error) {
    const e = json?.error || {};
    throw new GraphError(
      {
        message: e.message || `Facebook returned ${res.status}`,
        title: e.error_user_title,
        userMessage: e.error_user_msg,
        code: e.code,
        subcode: e.error_subcode,
        fbtraceId: e.fbtrace_id,
      },
      e.code === 190 ? 401 : res.status >= 400 ? res.status : 400,
    );
  }
  return json as T;
}

export const graph = {
  get: <T>(path: string, token: string, params?: Params) => call<T>('GET', path, token, params),
  post: <T>(path: string, token: string, params?: Params) => call<T>('POST', path, token, params),
  /** POST with one binary file field (multipart). */
  postFile: <T>(path: string, token: string, params: Params, file: FilePart) => call<T>('POST', path, token, params, file),
  /** GET a list edge and follow `paging.next` up to `maxPages`. */
  async list<T>(path: string, token: string, params: Params = {}, maxPages = 5): Promise<T[]> {
    const out: T[] = [];
    let page = await call<{ data: T[]; paging?: { next?: string } }>('GET', path, token, params);
    out.push(...(page.data || []));
    let n = 1;
    while (page.paging?.next && n < maxPages) {
      page = await call<{ data: T[]; paging?: { next?: string } }>('GET', page.paging.next, token);
      out.push(...(page.data || []));
      n++;
    }
    return out;
  },
};

/** Token exchange calls that don't use a user token. */
export async function oauthGet<T>(path: string, params: Record<string, string>): Promise<T> {
  const url = new URL(`${GRAPH_URL}/${path}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url, { cache: 'no-store' });
  const json = await res.json();
  if (!res.ok || json.error) throw new GraphError({ message: json.error?.message || 'Token exchange failed', code: json.error?.code });
  return json as T;
}
