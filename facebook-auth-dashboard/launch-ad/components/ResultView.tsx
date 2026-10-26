'use client';
import { CheckCircle2, ExternalLink } from 'lucide-react';
import type { AdAccount, LaunchResult } from '@/launch-ad/lib/types';

export default function ResultView({ result, account, onAgain, onRepeat }: { result: LaunchResult; account: AdAccount; onAgain: () => void; /** Same ad into another ad set */ onRepeat?: () => void }) {
  const act = account.account_id || account.id.replace('act_', '');
  const base = 'https://adsmanager.facebook.com/adsmanager/manage';
  const c = result.created;
  const firstAd = c.ads.find((a) => a.id);
  // Edit view, so the new ad (or ad set / campaign) opens ready to review.
  const editAd = firstAd ? `${base}/ads/edit?act=${act}&selected_ad_ids=${firstAd.id}` : '';
  const editAdset = c.adset ? `${base}/adsets/edit?act=${act}&selected_adset_ids=${c.adset.id}` : '';
  const editCampaign = c.campaign ? `${base}/campaigns/edit?act=${act}&selected_campaign_ids=${c.campaign.id}` : '';
  const link = editAd || editAdset || editCampaign || `${base}/campaigns?act=${act}`;

  return (
    <div style={{ marginTop: 30 }}>
      <div className="card">
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', color: 'var(--ok)' }}>
          <CheckCircle2 size={20} />
          <h2 className="section-title" style={{ margin: 0, color: 'var(--ink)' }}>{result.activated ? 'Launched' : 'Launched paused'}</h2>
        </div>
        <p className="note" style={{ marginTop: 10 }}>
          {result.activated ? 'Your ads start delivering once Meta approves them.' : 'Everything is paused. Turn it on in Ads Manager when you are ready.'}
        </p>
        <dl className="kv">
          {c.campaign ? <><dt>Campaign</dt><dd>{c.campaign.name} · {c.campaign.id}</dd></> : null}
          {c.adset ? <><dt>Ad set</dt><dd>{c.adset.name} · {c.adset.id}</dd></> : null}
          {c.ads.length ? <><dt>{c.ads.length === 1 ? 'Ad' : `Ads (${c.ads.length})`}</dt><dd>{c.ads.map((a) => a.name).join(', ')}</dd></> : null}
        </dl>
        <div className="launch-bar">
          <a className="btn-primary" href={link} target="_blank" rel="noreferrer" style={{ textDecoration: 'none', display: 'inline-flex', gap: 6, alignItems: 'center' }}>
            Review {firstAd ? 'ad' : c.adset ? 'ad set' : 'campaign'} in Ads Manager <ExternalLink size={13} />
          </a>
          {onRepeat ? <button type="button" className="btn-ghost" onClick={onRepeat}>Add this ad to another ad set</button> : null}
          <button type="button" className="btn-ghost" onClick={onAgain}>{onRepeat ? 'Start a new ad' : 'Launch another'}</button>
        </div>
        <div className="hint" style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 12 }}>
          <span>Edit in Ads Manager:</span>
          {editCampaign ? <a href={editCampaign} target="_blank" rel="noreferrer">Campaign</a> : null}
          {editAdset ? <a href={editAdset} target="_blank" rel="noreferrer">Ad set</a> : null}
          {editAd ? <a href={editAd} target="_blank" rel="noreferrer">Ad</a> : null}
        </div>
      </div>
    </div>
  );
}
