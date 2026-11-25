'use client';
import { ArrowLeft, Check, Search, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { CopyText } from '@/launch-ad/lib/ai-types';
import { apiGet } from '@/launch-ad/lib/client-api';
import { useAsync } from '@/launch-ad/lib/hooks';
import { Loading, TextInput } from './ui';

interface AdRow { id: string; name: string; status: string; thumbnail: string; message: string; headline: string; description: string }
const hasText = (a: AdRow) => !!(a.message || a.headline || a.description);
const statusText = (s: string) => (s || '').replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

/**
 * Pick one of this ad account's ads, look at its text, and import it into the ad being made. Nothing changes until the
 * person confirms on the preview.
 */
export default function ImportCopy({ accountId, into, replaces, onImport, onClose }: {
  accountId: string;
  /** Language the text will go into, e.g. "English" */
  into: string;
  /** The fields already have text that the import will replace */
  replaces: boolean;
  onImport: (text: CopyText, adName: string) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [chosen, setChosen] = useState<AdRow | null>(null);
  useEffect(() => { const t = setTimeout(() => setSearch(q.trim()), 350); return () => clearTimeout(t); }, [q]);
  const ads = useAsync<AdRow[]>(`ads-${accountId}-${search}`, () => apiGet('ads', { account: accountId, search }));

  return (
    <div className="imp">
      <div className="imp-head">
        <span className="strong">{chosen ? 'Check the text, then import it' : 'Import text from another ad'}</span>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close" title="Close"><X size={14} /></button>
      </div>

      {chosen ? (
        <>
          <div className="hint" style={{ margin: '0 0 8px' }}>From <b>{chosen.name}</b> · goes into the {into} text</div>
          <div className="ai-opt">
            {chosen.message ? <div className="ai-primary">{chosen.message}</div> : <div className="hint">No primary text</div>}
            <div className="ai-line"><span className="strong">Headline</span> · {chosen.headline || '–'}</div>
            <div className="ai-line"><span className="strong">Description</span> · {chosen.description || '–'}</div>
          </div>
          {replaces ? <div className="notice warn" style={{ marginTop: 10 }}>This replaces the text now in the fields. You can undo it right after.</div> : null}
          <div className="ai-actions" style={{ marginTop: 10 }}>
            <button type="button" className="btn-primary" onClick={() => onImport({ message: chosen.message, headline: chosen.headline, description: chosen.description }, chosen.name)}><Check size={14} /> Import this text</button>
            <button type="button" className="btn-ghost" onClick={() => setChosen(null)}><ArrowLeft size={14} /> Choose another ad</button>
          </div>
        </>
      ) : (
        <>
          <div className="imp-search">
            <Search size={14} />
            <TextInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search this account’s ads by name…" aria-label="Search ads" />
          </div>
          <div className="imp-list">
            {ads.loading ? <Loading /> : ads.error ? <div className="notice bad">{ads.error}</div> : !ads.data?.length ? (
              <div className="hint" style={{ padding: 8 }}>{search ? `No ads match “${search}”.` : 'No ads in this ad account yet.'}</div>
            ) : ads.data.map((a) => (
              <button key={a.id} type="button" className="imp-row" disabled={!hasText(a)} onClick={() => setChosen(a)} title={hasText(a) ? a.name : 'This ad has no text to import (for example it promotes an existing post)'}>
                <span className="imp-thumb" style={{ backgroundImage: a.thumbnail ? `url("${a.thumbnail}")` : undefined }} />
                <span className="imp-body">
                  <span className="imp-name">{a.name}</span>
                  <span className="imp-snip">{hasText(a) ? (a.message || a.headline) : 'No text to import'}</span>
                </span>
                <span className="badge grey">{statusText(a.status)}</span>
              </button>
            ))}
          </div>
          {ads.data && ads.data.length >= 50 ? <div className="hint" style={{ margin: '6px 0 0' }}>Showing 50 ads. Search by name to find others.</div> : null}
        </>
      )}
    </div>
  );
}
