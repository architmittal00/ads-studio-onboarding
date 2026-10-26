'use client';
import type { AdAccount } from '@/launch-ad/lib/types';
import { Loading, SearchSelect } from './ui';

/** Meta account_status codes; active (1) shows nothing. */
const ACCOUNT_STATUS: Record<number, string> = { 2: 'Disabled', 3: 'Unsettled', 7: 'Pending review', 8: 'Pending settlement', 9: 'In grace period', 100: 'Pending closure', 101: 'Closed' };

export default function AccountPicker({ accounts, value, onChange }: {
  accounts: { data?: AdAccount[]; loading: boolean; error: string };
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="account-pick">
      <span className="label">Ad account</span>
      {accounts.loading ? <Loading /> : accounts.error ? (
        <div className="notice bad">{accounts.error}</div>
      ) : accounts.data && !accounts.data.length ? (
        <div className="notice warn">No ad accounts found for this Facebook login. Ask a business admin to give you access to one.</div>
      ) : (
        <SearchSelect
          value={value}
          onChange={onChange}
          ariaLabel="Ad account"
          noun="ad accounts"
          placeholder="Select an ad account..."
          searchPlaceholder={`Search ${(accounts.data || []).length.toLocaleString('en-IN')} ad accounts by name or ID`}
          options={(accounts.data || []).map((a) => ({ key: a.id, label: a.name || a.account_id, meta: [a.account_id, ACCOUNT_STATUS[a.account_status ?? 1]].filter(Boolean).join(' · ') }))}
        />
      )}
    </div>
  );
}
