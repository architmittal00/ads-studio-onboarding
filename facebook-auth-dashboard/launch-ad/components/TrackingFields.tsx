'use client';
import { URL_DYNAMIC_PARAMS, UTM_FIELDS, buildUrlTags } from '@/launch-ad/lib/constants';
import type { FormState } from '@/launch-ad/lib/types';
import { Field, TextInput } from './ui';

/** UTM fields and the resulting URL parameters. */
export default function TrackingFields({ form, setAd, hint }: { form: FormState; setAd: (p: Partial<FormState['ad']>) => void; hint: string }) {
  const ad = form.ad;
  const set = (k: string, v: string) => setAd({ urlTags: { ...ad.urlTags, [k]: v } });
  return (
    <>
      <div className="row field">
        {UTM_FIELDS.slice(0, 2).map((f) => <Field key={f.key} label={f.label}><TextInput value={ad.urlTags[f.key]} placeholder={f.placeholder} onChange={(e) => set(f.key, e.target.value)} /></Field>)}
      </div>
      <div className="row field">
        {UTM_FIELDS.slice(2, 4).map((f) => <Field key={f.key} label={f.label}><TextInput value={ad.urlTags[f.key]} placeholder={f.placeholder} onChange={(e) => set(f.key, e.target.value)} /></Field>)}
      </div>
      <Field label={UTM_FIELDS[4].label}>
        <TextInput value={ad.urlTags.term} placeholder={UTM_FIELDS[4].placeholder} onChange={(e) => set('term', e.target.value)} />
      </Field>
      <Field label="URL parameters" hint={<>{hint} Dynamic parameters Meta fills per ad: {URL_DYNAMIC_PARAMS.join(', ')}</>}>
        <TextInput readOnly value={buildUrlTags(ad.urlTags || {}) || 'No URL parameters'} aria-label="URL parameters" />
      </Field>
    </>
  );
}
