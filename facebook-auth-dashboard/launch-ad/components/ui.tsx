'use client';
import { ChevronDown, X } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { apiGet } from '@/launch-ad/lib/client-api';
import Loader from '@/components/Loader';

export function Field({ label, hint, children }: { label?: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="field">
      {label ? <span className="label">{label}</span> : null}
      {children}
      {hint ? <div className="hint">{hint}</div> : null}
    </div>
  );
}

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`input ${props.className || ''}`} />;
}

export function Select<T extends string>({ value, onChange, options, placeholder, disabled, ariaLabel }: {
  value: T | '';
  onChange: (v: T) => void;
  options: { key: string; label: string }[];
  placeholder?: string;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  return (
    <div className="select-wrap">
      <select className="input" value={value} disabled={disabled} aria-label={ariaLabel} onChange={(e) => onChange(e.target.value as T)}>
        {placeholder !== undefined ? <option value="" disabled>{placeholder}</option> : null}
        {options.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
      </select>
      <ChevronDown className="chev" size={22} strokeWidth={2.2} />
    </div>
  );
}

export function Segmented<T extends string>({ value, onChange, options }: {
  value: T;
  onChange: (v: T) => void;
  options: { key: T; label: string; disabled?: boolean; title?: string }[];
}) {
  return (
    <div className="seg" role="group">
      {options.map((o) => (
        <button key={o.key} type="button" aria-pressed={value === o.key} disabled={o.disabled} title={o.title} onClick={() => onChange(o.key)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode }) {
  return (
    <label className="toggle">
      <button type="button" role="switch" aria-checked={checked} className="switch" onClick={() => onChange(!checked)} />
      <span>{label}</span>
    </label>
  );
}

export function CheckPills({ value, onChange, options }: { value: string[]; onChange: (v: string[]) => void; options: { key: string; label: string }[] }) {
  return (
    <div className="checks">
      {options.map((o) => {
        const on = value.includes(o.key);
        return (
          <label key={o.key} className={`check ${on ? 'on' : ''}`}>
            <input type="checkbox" checked={on} onChange={() => onChange(on ? value.filter((v) => v !== o.key) : [...value, o.key])} />
            {o.label}
          </label>
        );
      })}
    </div>
  );
}

export function Chip({ label, onRemove }: { label: string; onRemove?: () => void }) {
  return (
    <span className="chip">
      {label}
      {onRemove ? <button type="button" aria-label={`Remove ${label}`} onClick={onRemove}><X size={11} strokeWidth={2.6} /></button> : null}
    </span>
  );
}

/** Async search box (locations, languages, interests) that adds chips. */
export function TagSearch<T>({ type, placeholder, selected, onAdd, onRemove, getKey, getLabel, toItem, describe }: {
  type: 'adgeolocation' | 'adlocale' | 'adinterest';
  placeholder: string;
  selected: T[];
  onAdd: (item: T) => void;
  onRemove: (item: T) => void;
  getKey: (item: T) => string;
  getLabel: (item: T) => string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  toItem: (raw: any) => T;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  describe?: (raw: any) => string;
}) {
  const [q, setQ] = useState('');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [results, setResults] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!q.trim()) { setResults([]); return; }
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const data = await apiGet<any[]>('search', { type, q });
        setResults(data || []);
        setActive(0);
      } catch { setResults([]); }
      finally { setLoading(false); }
    }, 250);
    return () => clearTimeout(t);
  }, [q, type]);

  useEffect(() => {
    const close = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const pick = (raw: unknown) => {
    const item = toItem(raw);
    if (!selected.some((s) => getKey(s) === getKey(item))) onAdd(item);
    setQ('');
    setResults([]);
  };

  return (
    <div className="tag-search" ref={boxRef}>
      {selected.length ? (
        <div className="chips">
          {selected.map((s) => <Chip key={getKey(s)} label={getLabel(s)} onRemove={() => onRemove(s)} />)}
        </div>
      ) : null}
      <input
        className="input"
        placeholder={placeholder}
        value={q}
        aria-controls={id}
        onFocus={() => setOpen(true)}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)); }
          if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
          if (e.key === 'Enter' && results[active]) { e.preventDefault(); pick(results[active]); }
          if (e.key === 'Escape') setOpen(false);
        }}
      />
      {open && q.trim() ? (
        <div className="dropdown" id={id} role="listbox">
          {loading ? <div className="empty">Searching…</div> : null}
          {!loading && !results.length ? <div className="empty">No matches for “{q}”.</div> : null}
          {!loading && results.map((r, i) => (
            <button key={`${r.key ?? r.id}-${i}`} type="button" data-active={i === active} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(r)}>
              <span>{r.name}</span>
              {describe ? <span className="meta">{describe(r)}</span> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Dropdown with a search box: type to filter by label, extra text (e.g. an ID) or key. */
export function SearchSelect({ value, onChange, options, placeholder, searchPlaceholder, ariaLabel, noun = 'options' }: {
  value: string;
  onChange: (v: string) => void;
  options: { key: string; label: string; meta?: string }[];
  placeholder?: string;
  searchPlaceholder?: string;
  ariaLabel?: string;
  noun?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const id = useId();
  const LIMIT = 100;

  useEffect(() => {
    const close = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) { setOpen(false); setQ(''); } };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const selected = options.find((o) => o.key === value);
  const s = q.trim().toLowerCase();
  const matches = s ? options.filter((o) => `${o.label} ${o.meta || ''} ${o.key}`.toLowerCase().includes(s)) : options;
  const shown = matches.slice(0, LIMIT);

  const pick = (key: string) => {
    onChange(key);
    setOpen(false);
    setQ('');
    inputRef.current?.blur();
  };

  return (
    <div className="tag-search select-wrap" ref={boxRef}>
      <input
        ref={inputRef}
        className="input"
        role="combobox"
        aria-expanded={open}
        aria-controls={id}
        aria-label={ariaLabel}
        value={open ? q : selected ? `${selected.label}${selected.meta ? ` · ${selected.meta}` : ''}` : ''}
        placeholder={open ? (searchPlaceholder || 'Search…') : placeholder}
        onFocus={() => { setOpen(true); setQ(''); setActive(0); }}
        onChange={(e) => { setQ(e.target.value); setOpen(true); setActive(0); }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, shown.length - 1)); }
          if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
          if (e.key === 'Enter' && open && shown[active]) { e.preventDefault(); pick(shown[active].key); }
          if (e.key === 'Escape') { setOpen(false); setQ(''); inputRef.current?.blur(); }
        }}
      />
      <ChevronDown className="chev" size={22} strokeWidth={2.2} />
      {open ? (
        <div className="dropdown" id={id} role="listbox">
          {!shown.length ? <div className="empty">No {noun} match “{q}”.</div> : null}
          {shown.map((o, i) => (
            <button
              key={o.key}
              type="button"
              role="option"
              aria-selected={o.key === value}
              data-active={i === active}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(o.key)}
            >
              <span style={{ fontWeight: o.key === value ? 700 : 400 }}>{o.label}</span>
              {o.meta ? <span className="meta">{o.meta}</span> : null}
            </button>
          ))}
          {matches.length > LIMIT ? <div className="empty">Showing {LIMIT} of {matches.length.toLocaleString('en-IN')}. Keep typing to narrow down.</div> : null}
        </div>
      ) : null}
    </div>
  );
}

/** Every loading state reads the same: data comes from Meta. (`text` is accepted for older callers and ignored.) */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function Loading(_props: { text?: string }) {
  return <div className="loading"><Loader inline label="Fetching data from Meta…" /></div>;
}
