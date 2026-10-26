'use client';
import { Calendar, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

export interface Range { preset: string; since: string; until: string }

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const parse = (s: string) => new Date(`${s}T00:00:00`);

// Like Meta's presets: "Last N days" ends yesterday.
export const PRESETS: { key: string; label: string; range: () => [Date, Date] }[] = [
  { key: 'today', label: 'Today', range: () => [new Date(), new Date()] },
  { key: 'yesterday', label: 'Yesterday', range: () => [addDays(new Date(), -1), addDays(new Date(), -1)] },
  { key: 'last_3d', label: 'Last 3 Days', range: () => [addDays(new Date(), -3), addDays(new Date(), -1)] },
  { key: 'last_7d', label: 'Last 7 Days', range: () => [addDays(new Date(), -7), addDays(new Date(), -1)] },
  { key: 'last_14d', label: 'Last 14 Days', range: () => [addDays(new Date(), -14), addDays(new Date(), -1)] },
  { key: 'last_30d', label: 'Last 30 Days', range: () => [addDays(new Date(), -30), addDays(new Date(), -1)] },
  { key: 'last_90d', label: 'Last 90 Days', range: () => [addDays(new Date(), -90), addDays(new Date(), -1)] },
  { key: 'last_365d', label: 'Last 365 Days', range: () => [addDays(new Date(), -365), addDays(new Date(), -1)] },
  { key: 'this_month', label: 'This Month', range: () => { const n = new Date(); return [new Date(n.getFullYear(), n.getMonth(), 1), n]; } },
  { key: 'last_month', label: 'Last Month', range: () => { const n = new Date(); return [new Date(n.getFullYear(), n.getMonth() - 1, 1), new Date(n.getFullYear(), n.getMonth(), 0)]; } },
];

export function presetRange(key: string): Range {
  const p = PRESETS.find((x) => x.key === key) || PRESETS[3];
  const [a, b] = p.range();
  return { preset: p.key, since: iso(a), until: iso(b) };
}

const show = (s: string) => parse(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
export const rangeText = (r: Range) => `${PRESETS.find((p) => p.key === r.preset)?.label || 'Custom'}: ${show(r.since)} \u2013 ${show(r.until)}`;
const dayCount = (a: string, b: string) => Math.round((parse(b).getTime() - parse(a).getTime()) / 86_400_000) + 1;
const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

/** One month: six weeks of days, with the neighbouring months' days shown dimmed. */
function Month({ year, month, since, until, hover, today, onPick, onHover }: {
  year: number; month: number; since: string; until: string; hover: string; today: string;
  onPick: (d: string) => void; onHover: (d: string) => void;
}) {
  const first = new Date(year, month, 1);
  const start = addDays(first, -first.getDay());
  const end = until || (since && hover && hover >= since ? hover : '');
  const cells = Array.from({ length: 42 }, (_, i) => addDays(start, i));
  return (
    <div className="dr-month">
      <div className="dr-month-title">{first.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</div>
      <div className="dr-grid">
        {WEEKDAYS.map((w) => <span key={w} className="dr-wd">{w}</span>)}
        {cells.map((d) => {
          const s = iso(d);
          const outside = d.getMonth() !== month;
          const future = s > today;
          const edge = s === since || s === end;
          const inRange = !!since && !!end && s > since && s < end;
          return (
            <button
              key={s}
              type="button"
              disabled={future}
              className={['dr-day', outside ? 'out' : '', inRange ? 'in' : '', edge ? 'edge' : '', s === today ? 'today' : ''].filter(Boolean).join(' ')}
              onClick={() => onPick(s)}
              onMouseEnter={() => onHover(s)}
              aria-label={d.toDateString()}
              aria-pressed={edge}
            >{d.getDate()}</button>
          );
        })}
      </div>
    </div>
  );
}

/** Date range picker matching Ads Dashboard: presets on the left, a two-month calendar on the right. */
export default function DateRange({ value, onChange }: { value: Range; onChange: (r: Range) => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Range>(value);
  const [hover, setHover] = useState('');
  // Left month shown; the right month is the one after it.
  const [view, setView] = useState(() => { const u = parse(value.until); return new Date(u.getFullYear(), u.getMonth() - 1, 1); });
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    setDraft(value);
    const u = parse(value.until); setView(new Date(u.getFullYear(), u.getMonth() - 1, 1));
  }, [open, value]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close); window.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); window.removeEventListener('keydown', esc); };
  }, [open]);

  const today = iso(new Date());
  const valid = !!draft.since && !!draft.until && draft.since <= draft.until;
  // First click starts a new range; the second click ends it (either order).
  const pick = (d: string) => {
    if (!draft.since || draft.until) { setDraft({ preset: 'custom', since: d, until: '' }); return; }
    setDraft(d < draft.since ? { preset: 'custom', since: d, until: draft.since } : { preset: 'custom', since: draft.since, until: d });
  };
  const choosePreset = (key: string) => {
    const r = presetRange(key); setDraft(r);
    const u = parse(r.until); setView(new Date(u.getFullYear(), u.getMonth() - 1, 1));
  };
  const right = new Date(view.getFullYear(), view.getMonth() + 1, 1);
  const canNext = iso(new Date(right.getFullYear(), right.getMonth() + 1, 1)) <= today;

  return (
    <div className="daterange" ref={box}>
      <button type="button" className="dr-button" onClick={() => setOpen(!open)} aria-expanded={open}>
        <Calendar size={14} /> <span>{rangeText(value)}</span> <ChevronDown size={14} />
      </button>
      {open ? (
        <div className="dr-pop" role="dialog" aria-label="Date range">
          <div className="dr-presets" role="radiogroup">
            {PRESETS.map((p) => (
              <label key={p.key} className={draft.preset === p.key ? 'on' : ''}>
                <input type="radio" name="dr" checked={draft.preset === p.key} onChange={() => choosePreset(p.key)} /> {p.label}
              </label>
            ))}
            <label className={draft.preset === 'custom' ? 'on' : ''}>
              <input type="radio" name="dr" checked={draft.preset === 'custom'} onChange={() => setDraft({ ...draft, preset: 'custom' })} /> Custom
            </label>
          </div>
          <div className="dr-cal" onMouseLeave={() => setHover('')}>
            <div className="dr-cal-head">
              <button type="button" className="icon-btn bordered" aria-label="Previous month" onClick={() => setView(new Date(view.getFullYear(), view.getMonth() - 1, 1))}><ChevronLeft size={15} /></button>
              <span className="hint" style={{ margin: 0 }}>
                {valid ? `${show(draft.since)} \u2013 ${show(draft.until)} \u00b7 ${dayCount(draft.since, draft.until)} ${dayCount(draft.since, draft.until) === 1 ? 'day' : 'days'}` : draft.since ? `${show(draft.since)} \u2013 pick an end date` : 'Pick a start date'}
              </span>
              <button type="button" className="icon-btn bordered" aria-label="Next month" disabled={!canNext} onClick={() => setView(right)}><ChevronRight size={15} /></button>
            </div>
            <div className="dr-months">
              <Month year={view.getFullYear()} month={view.getMonth()} since={draft.since} until={draft.until} hover={hover} today={today} onPick={pick} onHover={setHover} />
              <Month year={right.getFullYear()} month={right.getMonth()} since={draft.since} until={draft.until} hover={hover} today={today} onPick={pick} onHover={setHover} />
            </div>
            <div className="dr-compare">
              <div>
                <div className="strong" style={{ fontSize: 13 }}>Compare to previous period</div>
                <div className="hint" style={{ margin: 0 }}>Not available here: each tab shows one window at a time, not a comparison view.</div>
              </div>
              <span className="toggle-off" aria-hidden />
            </div>
            <div className="dr-foot">
              <span className="hint" style={{ margin: 0 }}>Dates are in your local timezone; Meta reports in the ad account&apos;s timezone.</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
                <button type="button" className="btn-primary" disabled={!valid} onClick={() => { onChange(draft); setOpen(false); }}>Update</button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
