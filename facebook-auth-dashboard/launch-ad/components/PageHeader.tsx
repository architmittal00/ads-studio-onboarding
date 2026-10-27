'use client';
import type { ReactNode } from 'react';
import AccountSelect from '@/components/AccountSelect';
import DateRangeMenu from '@/components/DateRangeMenu';
import { RefreshIcon } from '@/components/icons';
import { computeRange } from '@/lib/dateRanges';
import type { AdAccount } from '@/launch-ad/lib/types';
import styles from '@/styles/Home.module.css';

// The shared JS components infer every prop as required; they are optional in practice.
/* eslint-disable @typescript-eslint/no-explicit-any */
const AccountSelectC = AccountSelect as any;
const DateRangeMenuC = DateRangeMenu as any;
const resolve = (preset: string, since: string, until: string): Range => ({ preset, ...((computeRange(preset, since, until) || { since: '', until: '' }) as { since: string; until: string }) });

// Header built from this app's own shared pieces, mirroring pages/partnership-ads.js
// exactly: .h1/.sub title block on the left, a .headerPillRow of labeled
// AccountSelect / DateRangeMenu / refresh button on the right.

export interface Range { preset: string; since: string; until: string }

export function presetRange(preset: string): Range {
  return resolve(preset, '', '');
}

export default function PageHeader({ title, sub, children }: { title: string; sub: string; children?: ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
      <div>
        <h1 className={styles.h1} style={{ margin: 0 }}>{title}</h1>
        <p className={styles.sub} style={{ marginTop: 6, marginBottom: 6 }}>{sub}</p>
      </div>
      <div className={styles.headerPillRow} style={{ alignItems: 'flex-end' }}>{children}</div>
    </div>
  );
}

export function LabeledPill({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <span className={styles.muted} style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.3 }}>{label}</span>
      {children}
    </div>
  );
}

/** Meta account_status codes; active (1) shows nothing. */
const ACCOUNT_STATUS: Record<number, string> = { 2: 'Disabled', 3: 'Unsettled', 7: 'Pending review', 8: 'Pending settlement', 9: 'In grace period', 100: 'Pending closure', 101: 'Closed' };

export function AdAccountPill({ accounts, value, onChange }: {
  accounts: { data?: AdAccount[]; loading: boolean; error: string };
  value: string;
  onChange: (id: string) => void;
}) {
  const options = (accounts.data || []).map((a) => ({
    id: a.id,
    name: [a.name || a.account_id, a.account_id, ACCOUNT_STATUS[a.account_status ?? 1]].filter(Boolean).join(' · '),
  }));
  return (
    <LabeledPill label="Ad Account">
      <AccountSelectC
        accounts={options}
        value={value}
        onChange={onChange}
        placeholder="Select an ad account…"
        inputClassName={styles.headerPillSelect}
        inputStyle={{ width: 260 }}
        loading={accounts.loading}
      />
    </LabeledPill>
  );
}

/** Notices for the account list itself (error / none found), shown under the header. */
export function AccountNotices({ accounts }: { accounts: { data?: AdAccount[]; loading: boolean; error: string } }) {
  if (accounts.error) return <div className={styles.error}>{accounts.error}</div>;
  if (!accounts.loading && accounts.data && !accounts.data.length) {
    return <div className={styles.error}>No ad accounts found for this Facebook login. Ask a business admin to give you access to one.</div>;
  }
  return null;
}

export function RangePill({ range, onChange, fullWidth }: { range: Range; onChange: (r: Range) => void; fullWidth?: boolean }) {
  return (
    <DateRangeMenuC
      rangePreset={range.preset}
      customSince={range.since}
      customUntil={range.until}
      maxRangeDays={365}
      compareToPrevious={false}
      compareCustomSince=""
      compareDisplay="change"
      compareDisabled
      compareDisabledReason="Not available here — this shows one window at a time."
      triggerClassName={styles.headerPillBtn}
      fullWidth={fullWidth}
      onApply={(patch: { rangePreset: string; customSince: string; customUntil: string }) =>
        onChange(resolve(patch.rangePreset, patch.customSince, patch.customUntil))
      }
    />
  );
}

export function RefreshPill({ onClick, loading }: { onClick: () => void; loading?: boolean }) {
  return (
    <button type="button" className={loading ? `${styles.headerPillIconBtn} spinning` : styles.headerPillIconBtn} onClick={onClick} disabled={loading} title="Reload" aria-label="Reload">
      <RefreshIcon size={14} />
    </button>
  );
}
