'use client';
import { Fragment } from 'react';
import { BID_STRATEGIES, objectiveLabel } from '@/launch-ad/lib/constants';
import type { AdAccount, AdsetLite } from '@/launch-ad/lib/types';
import { adsetBudget, audienceText, perf, perfText } from './DestinationTree';
import { budgetText, statusLabel } from './Pickers';

const date = (s?: string) => (s ? new Date(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '');

/** What an existing ad set spends and who it reaches: shown before adding an ad to it. */
export function adsetFacts(a: AdsetLite, account: AdAccount): [string, string][] {
  const c = a.campaign;
  const own = !!(a.daily_budget || a.lifetime_budget);
  const bidKey = a.bid_strategy || c?.bid_strategy;
  const n = a.ads?.summary?.total_count ?? 0;
  return [
    ['Campaign', `${c?.name || ''}${c?.objective ? ` · ${objectiveLabel(c.objective)}` : ''}`],
    ['Ad set', `${a.name} · ${statusLabel(a.effective_status || a.status)}`],
    ['Budget', own ? `${adsetBudget(a, account.currency)} (ad set budget)` : c ? `${budgetText(c, account.currency)} (campaign budget, shared by its ad sets)` : 'Campaign budget'],
    ['Bid strategy', BID_STRATEGIES.find((b) => b.key === bidKey)?.label || (bidKey ? statusLabel(bidKey) : 'Highest volume')],
    ['Schedule', a.start_time ? `${date(a.start_time)} – ${a.end_time ? date(a.end_time) : 'ongoing'}` : 'Ongoing'],
    ['Audience', audienceText(a.targeting) || 'As set on the ad set'],
    ['Last 7 days', perfText(perf(a.insights), account.currency).replace(' (7d)', '')],
    ['Ads', `${n} now, ${n + 1} after adding yours`],
  ];
}

export default function AdsetFacts({ adset, account }: { adset: AdsetLite; account: AdAccount }) {
  return <dl className="kv">{adsetFacts(adset, account).map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd>{v}</dd></Fragment>)}</dl>;
}
