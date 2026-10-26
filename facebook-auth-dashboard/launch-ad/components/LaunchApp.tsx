'use client';
import { useEffect, useMemo, useState } from 'react';
import { apiGet } from '@/launch-ad/lib/client-api';
import { adFirstForm, clearAccountBound, repeatForm } from '@/launch-ad/lib/form';
import { useAsync } from '@/launch-ad/lib/hooks';
import type { AdAccount, FormState, LaunchResult } from '@/launch-ad/lib/types';
import PageHeader, { AccountNotices, AdAccountPill } from './PageHeader';
import styles from '@/styles/Home.module.css';
import AdFirstWorkspace from './AdFirstWorkspace';
import LegalLinks from './LegalLinks';
import ResultView from './ResultView';

type View = { kind: 'ad' } | { kind: 'done'; result: LaunchResult };

/** The Launch page: "Start with an Ad" (create the ad, choose where it runs, launch), then the result. */
export default function LaunchApp({ declined }: { declined: string[] }) {
  const accounts = useAsync<AdAccount[]>('accounts', () => apiGet('adaccounts'));
  const [accountId, setAccountId] = useState('');
  const [view, setView] = useState<View>({ kind: 'ad' });
  const [form, setForm] = useState<FormState>(() => adFirstForm());
  // The ad from the last launch, so it can be added to another ad set.
  const [lastAd, setLastAd] = useState<{ form: FormState; adsetName: string } | null>(null);
  const [repeatOf, setRepeatOf] = useState('');
  const [wsKey, setWsKey] = useState(0);
  // Shown after switching ad account mid-flow.
  const [switched, setSwitched] = useState('');

  // Facebook appends "#_=_" to the URL after login; remove it.
  useEffect(() => {
    if (window.location.hash === '#_=_') window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }, []);

  // Start on the first ad account.
  useEffect(() => {
    if (accounts.data?.length && !accountId) setAccountId(accounts.data[0].id);
  }, [accounts.data, accountId]);

  const account = useMemo(() => accounts.data?.find((a) => a.id === accountId), [accounts.data, accountId]);

  // A fresh ad.
  const startOver = () => {
    setLastAd(null); setRepeatOf(''); setSwitched('');
    setForm(adFirstForm());
    setWsKey((k) => k + 1);
    setView({ kind: 'ad' });
    window.scrollTo({ top: 0 });
  };

  // Switching ad account keeps you in the ad you're making. What belongs to the old account (catalog, product set,
  // dataset, saved audience, custom audiences, uploaded image or video) is cleared; the ad's name, Page, post, text
  // and format are kept.
  const changeAccount = (id: string) => {
    if (id === accountId) return;
    setAccountId(id);
    setLastAd(null); setRepeatOf('');
    if (view.kind === 'done') { startOver(); return; }
    setForm(clearAccountBound);
    setSwitched(accounts.data?.find((a) => a.id === id)?.name || 'the new ad account');
    window.scrollTo({ top: 0 });
  };

  const done = (result: LaunchResult) => {
    setLastAd(result.ok ? { form, adsetName: result.created.adset?.name || '' } : null);
    setView({ kind: 'done', result });
    window.scrollTo({ top: 0 });
  };
  // Same ad, fresh destination: keep the ad (and its catalog and product set), reset campaign and ad set settings.
  const repeatAd = () => {
    if (!lastAd) return;
    setForm(repeatForm(lastAd.form));
    setRepeatOf(lastAd.adsetName || 'the last ad set');
    setWsKey((k) => k + 1);
    setView({ kind: 'ad' });
    window.scrollTo({ top: 0 });
  };

  return (
    <div className={`content ${view.kind === 'ad' ? 'wide' : ''}`}>
      <PageHeader title="Start with an Ad" sub="Create the ad, choose where it runs, launch.">
        <AdAccountPill accounts={accounts} value={accountId} onChange={changeAccount} />
      </PageHeader>
      <AccountNotices accounts={accounts} />

      {declined.length ? (
        <div className="notice warn" style={{ marginBottom: 16 }}>
          You didn&apos;t allow <b>{declined.join(', ')}</b>. Some options won&apos;t load. <a href="/">Log in again</a> to grant them.
        </div>
      ) : null}

      {switched && account && view.kind === 'ad' ? (
        <div className="notice info switched" role="status">
          <span>Switched to <b>{switched}</b>. Catalog, product set, dataset (pixel), saved and custom audiences, and uploaded image or video were cleared because they belong to the previous ad account. Everything else in your ad is kept.</span>
          <button type="button" className="btn-link" onClick={() => setSwitched('')}>Dismiss</button>
        </div>
      ) : null}

      {!account ? null : view.kind === 'ad' ? (
        <AdFirstWorkspace key={`${account.id}-${wsKey}`} account={account} form={form} setForm={setForm} onDone={done} repeatOf={repeatOf || undefined} />
      ) : (
        <ResultView result={view.result} account={account} onAgain={startOver} onRepeat={lastAd && view.result.ok ? repeatAd : undefined} />
      )}

      <LegalLinks style={{ marginTop: 48 }} />
    </div>
  );
}
