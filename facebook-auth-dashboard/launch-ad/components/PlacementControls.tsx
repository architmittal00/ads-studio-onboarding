'use client';
import { ALL_FB_POSITIONS, ALL_IG_POSITIONS, FB_POSITIONS, IG_POSITIONS } from '@/launch-ad/lib/positions';
import type { FormState } from '@/launch-ad/lib/types';
import { CheckPills, Field, Segmented } from './ui';

type Adset = FormState['adset'];

/** Manual placements: which positions to use on Facebook and Instagram. All ticked lets Meta use every position. */
export function Positions({ a, set }: { a: Adset; set: (p: Partial<Adset>) => void }) {
  const fb = a.platforms.includes('facebook');
  const ig = a.platforms.includes('instagram');
  if (!fb && !ig) return null;
  const block = (label: string, options: typeof FB_POSITIONS, value: string[], all: string[], key: 'fbPositions' | 'igPositions') => (
    <Field
      label={label}
      hint={value.length === all.length
        ? 'All ticked: Meta uses every position, including in-stream video and others not listed. Untick to choose.'
        : value.length === 0 ? 'Pick at least one, or turn this platform off above.' : `${value.length} of ${all.length} ticked.`}
    >
      <CheckPills value={value} onChange={(v) => set({ [key]: v } as Partial<Adset>)} options={options} />
      {value.length !== all.length ? <button type="button" className="btn-link" style={{ marginTop: 6 }} onClick={() => set({ [key]: all } as Partial<Adset>)}>Tick all</button> : null}
    </Field>
  );
  return (
    <>
      {fb ? block('Facebook placements', FB_POSITIONS, a.fbPositions, ALL_FB_POSITIONS, 'fbPositions') : null}
      {ig ? block('Instagram placements', IG_POSITIONS, a.igPositions, ALL_IG_POSITIONS, 'igPositions') : null}
    </>
  );
}

const OS = [{ key: 'iOS', label: 'iOS' }, { key: 'Android', label: 'Android' }];

/** Where the ad shows: any device, mobile (optionally iOS or Android only) or desktop. */
export function Devices({ a, set }: { a: Adset; set: (p: Partial<Adset>) => void }) {
  return (
    <Field label="Devices" hint={a.devices === 'DESKTOP' ? 'Desktop only. Stories are mobile only.' : undefined}>
      <Segmented
        value={a.devices}
        onChange={(v) => set({ devices: v, os: v === 'MOBILE' ? a.os : [] })}
        options={[
          { key: 'ALL', label: 'All devices' }, { key: 'MOBILE', label: 'Mobile only' }, { key: 'DESKTOP', label: 'Desktop only' },
        ]}
      />
      {a.devices === 'MOBILE' ? (
        <div style={{ marginTop: 10 }}>
          <CheckPills value={a.os} onChange={(v) => set({ os: v as ('iOS' | 'Android')[] })} options={OS} />
          <div className="hint">{a.os.length ? `${a.os.join(' and ')} phones and tablets only.` : 'Leave both unticked for every mobile device, or pick iOS or Android.'}</div>
        </div>
      ) : null}
    </Field>
  );
}

/** One line for the review and the collapsed summary. */
export function placementSummary(a: Adset): string {
  const dev = a.devices === 'MOBILE' ? (a.os.length ? `${a.os.join(' & ')} only` : 'Mobile only') : a.devices === 'DESKTOP' ? 'Desktop only' : '';
  if (a.placement === 'ADVANTAGE') return ['Advantage+ placements', dev].filter(Boolean).join(' · ');
  const labels = (opts: typeof FB_POSITIONS, keys: string[]) => keys.map((k) => opts.find((o) => o.key === k)?.label || k).join(', ') || 'none';
  const names = a.platforms.map((p) => {
    if (p === 'facebook') return a.fbPositions.length < ALL_FB_POSITIONS.length ? `Facebook (${labels(FB_POSITIONS, a.fbPositions)})` : 'Facebook';
    if (p === 'instagram') return a.igPositions.length < ALL_IG_POSITIONS.length ? `Instagram (${labels(IG_POSITIONS, a.igPositions)})` : 'Instagram';
    return ({ messenger: 'Messenger', audience_network: 'Audience Network' } as Record<string, string>)[p] || p;
  });
  return [names.join(', ') || 'No placements', dev].filter(Boolean).join(' · ');
}
