'use client';
import { ChevronDown, ChevronRight, Copy, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { clearLog, setLogOpen, useApiLog, type LogGroup } from '@/launch-ad/lib/api-log';
import type { GraphCall } from '@/launch-ad/lib/types';
import { Segmented } from './ui';

const time = (t: number) => new Date(t).toLocaleTimeString('en-IN', { hour12: false });
const pretty = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v, null, 2));

function CopyButton({ value }: { value: unknown }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn-link"
      onClick={async () => {
        try { await navigator.clipboard.writeText(pretty(value)); setDone(true); setTimeout(() => setDone(false), 1200); } catch { /* ignore */ }
      }}
    >
      <Copy size={11} style={{ verticalAlign: -1 }} /> {done ? 'Copied' : 'Copy'}
    </button>
  );
}

function Block({ title, value }: { title: string; value: unknown }) {
  const empty = value === undefined || value === null || (typeof value === 'object' && !Object.keys(value as object).length);
  return (
    <div className="log-block">
      <div className="log-block-head"><span>{title}</span>{empty ? null : <CopyButton value={value} />}</div>
      <pre className="code">{empty ? '—' : pretty(value)}</pre>
    </div>
  );
}

function Status({ ok, status }: { ok: boolean; status: number }) {
  return <span className={`status ${ok ? 'ok' : 'bad'}`}>{status}</span>;
}

function CallRow({ call }: { call: GraphCall }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="log-call">
      <button type="button" className="log-line" onClick={() => setOpen(!open)} aria-expanded={open}>
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <Status ok={call.ok} status={call.status} />
        <span className="method">{call.method}</span>
        <span className="path">{call.path}</span>
        <span className="ms">{call.ms} ms</span>
      </button>
      {open ? (
        <div className="log-detail">
          <Block title="Request" value={call.params} />
          <Block title={call.truncated ? 'Response (truncated)' : 'Response'} value={call.response} />
        </div>
      ) : null}
    </div>
  );
}

function GroupRow({ g }: { g: LogGroup }) {
  const [open, setOpen] = useState(!g.ok);
  const [showApp, setShowApp] = useState(false);
  return (
    <div className={`log-group ${g.ok ? '' : 'failed'}`}>
      <button type="button" className="log-line top" onClick={() => setOpen(!open)} aria-expanded={open}>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <Status ok={g.ok} status={g.status} />
        <span className="method">{g.method}</span>
        <span className="path strong">{g.action}</span>
        <span className="ms">{time(g.at)} · {g.calls.length} {g.calls.length === 1 ? 'call' : 'calls'} · {g.ms} ms</span>
      </button>
      {open ? (
        <div className="log-body">
          {g.calls.length ? g.calls.map((c) => <CallRow key={c.id} call={c} />) : <div className="hint" style={{ margin: '4px 0 6px 22px' }}>No Graph API calls (answered by the app).</div>}
          <button type="button" className="btn-link" style={{ margin: '8px 0 0 22px' }} onClick={() => setShowApp(!showApp)}>
            {showApp ? 'Hide' : 'Show'} what the app sent and returned
          </button>
          {showApp ? (
            <div className="log-detail">
              <Block title={`App request: ${g.method} /api/launch-ad/meta/${g.action}`} value={g.input} />
              <Block title="App response" value={g.output} />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export default function ApiLogPanel() {
  const { groups, open } = useApiLog();
  const [filter, setFilter] = useState<'ALL' | 'ERRORS'>('ALL');
  const [q, setQ] = useState('');

  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setLogOpen(false); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [open]);

  const shown = useMemo(() => groups.filter((g) => {
    if (filter === 'ERRORS' && g.ok && g.calls.every((c) => c.ok)) return false;
    if (!q) return true;
    const s = q.toLowerCase();
    return g.action.toLowerCase().includes(s) || g.calls.some((c) => c.path.toLowerCase().includes(s));
  }), [groups, filter, q]);

  if (!open) return null;
  const calls = groups.reduce((n, g) => n + g.calls.length, 0);
  const errors = groups.filter((g) => !g.ok || g.calls.some((c) => !c.ok)).length;

  return (
    <aside className="drawer" aria-label="API log">
      <div className="drawer-head">
        <div>
          <h2 className="section-title" style={{ margin: 0 }}>API log</h2>
          <p className="hint" style={{ margin: '4px 0 0' }}>Graph API calls made from this tab: {calls} {calls === 1 ? 'call' : 'calls'}, {errors} with errors. Tokens are never shown.</p>
        </div>
        <button type="button" className="nav-btn" aria-label="Close API log" onClick={() => setLogOpen(false)}><X size={18} /></button>
      </div>
      <div className="drawer-tools">
        <Segmented value={filter} onChange={setFilter} options={[{ key: 'ALL', label: 'All' }, { key: 'ERRORS', label: 'Errors' }]} />
        <input className="input" style={{ flex: 1, height: 30 }} placeholder="Filter by endpoint, e.g. adsets" value={q} onChange={(e) => setQ(e.target.value)} />
        <button type="button" className="btn-ghost" onClick={clearLog} disabled={!groups.length}><Trash2 size={13} /> Clear</button>
      </div>
      <div className="drawer-list">
        {!shown.length ? (
          <div className="note" style={{ padding: '18px 4px' }}>{groups.length ? 'Nothing matches this filter.' : 'No calls yet. Use the launcher and every Meta API request shows up here.'}</div>
        ) : shown.map((g) => <GroupRow key={g.id} g={g} />)}
      </div>
    </aside>
  );
}
