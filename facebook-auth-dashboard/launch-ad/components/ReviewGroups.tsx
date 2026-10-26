'use client';
import { Fragment, type ReactNode } from 'react';

export type ReviewRow = [string, ReactNode];
export type ReviewGroup = { title: string; rows: ReviewRow[] };

/** Review details in titled groups (Campaign, Ad set, Ad) instead of one long list. */
export default function ReviewGroups({ groups }: { groups: ReviewGroup[] }) {
  return (
    <>
      {groups.filter((g) => g.rows.length).map((g) => (
        <section key={g.title} className="review-group">
          <h4>{g.title}</h4>
          <dl className="kv">{g.rows.map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd>{v}</dd></Fragment>)}</dl>
        </section>
      ))}
    </>
  );
}
