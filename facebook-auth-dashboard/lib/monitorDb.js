import { neon } from "@neondatabase/serverless";

// The Monitor watchlist: one row per time a campaign / ad set / ad was put on a person's (Google email) list. Removing it
// doesn't delete the row, it sets is_active = false and removed_at; adding it again later starts a new row. So the table
// keeps what was added and when (added_at, name, source) and for how long, and the current list is simply is_active = true.
let client = null;
let tableReady = null;

function db() {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) return null;
  return (client ||= neon(url));
}

async function ensureTable(sql) {
  tableReady ||= (async () => {
    await sql`
      create table if not exists monitor_items (
        id bigserial primary key,
        google_email text not null,
        item_key text not null,
        level text not null,
        entity_id text not null,
        account_id text not null,
        name text,
        campaign_name text,
        adset_name text,
        source text,
        is_active boolean not null default true,
        added_at timestamptz not null default now(),
        removed_at timestamptz
      )`;
    await sql`create unique index if not exists monitor_items_one_active on monitor_items (google_email, item_key) where is_active`;
    await sql`create index if not exists monitor_items_owner on monitor_items (google_email, is_active)`;
    // One-time carry-over from the first version (an add/remove event log, table monitor_events): each add becomes a row,
    // ended by the first remove after it. Only while this table is empty; the old table is left as it is.
    const old = await sql`select to_regclass('monitor_events') as t`;
    if (old[0]?.t) {
      await sql`
        insert into monitor_items (google_email, item_key, level, entity_id, account_id, name, campaign_name, adset_name, source, is_active, added_at, removed_at)
        select a.google_email, a.item_key, a.level, a.entity_id, a.account_id, a.name, a.campaign_name, a.adset_name, a.source,
               r.at is null, a.at, r.at
        from monitor_events a
        left join lateral (
          select min(e.at) as at from monitor_events e
          where e.google_email = a.google_email and e.item_key = a.item_key and e.action = 'remove' and e.id > a.id
        ) r on true
        where a.action = 'add' and not exists (select 1 from monitor_items)
        order by a.id`;
    }
  })();
  await tableReady;
}

export const monitorConfigured = () => !!db();

async function run(fn) {
  const sql = db();
  if (!sql) return null;
  try {
    await ensureTable(sql);
    return await fn(sql);
  } catch (err) {
    tableReady = null;
    throw err;
  }
}

const toItem = (r) => ({
  key: r.item_key,
  level: r.level,
  entityId: r.entity_id,
  accountId: r.account_id,
  name: r.name,
  campaignName: r.campaign_name,
  adsetName: r.adset_name,
  source: r.source,
  addedAt: new Date(r.added_at).getTime(),
});

export const readMonitorItems = (email) =>
  run(async (sql) => {
    const rows = await sql`
      select item_key, level, entity_id, account_id, name, campaign_name, adset_name, source, added_at
      from monitor_items where google_email = ${email} and is_active order by added_at, id`;
    return rows.map(toItem);
  });

// Starts a new row unless the item is already active. Returns true when a row was written.
export const addMonitorItem = (email, item) =>
  run(async (sql) => {
    const rows = await sql`
      insert into monitor_items (google_email, item_key, level, entity_id, account_id, name, campaign_name, adset_name, source)
      values (${email}, ${item.key}, ${item.level}, ${item.entityId}, ${item.accountId}, ${item.name}, ${item.campaignName}, ${item.adsetName}, ${item.source})
      on conflict (google_email, item_key) where is_active do nothing
      returning id`;
    return rows.length > 0;
  });

export const removeMonitorItem = (email, key) =>
  run(async (sql) => {
    const rows = await sql`
      update monitor_items set is_active = false, removed_at = now()
      where google_email = ${email} and item_key = ${key} and is_active
      returning id`;
    return rows.length > 0;
  });

// One-time carry-over of what a person already had saved in their browser. Idempotent: an item with ANY row for this
// person (active or removed) is skipped, so running it again (or from a second browser) only adds what is genuinely new,
// keeping the time it was originally added.
export const importMonitorItems = (email, items) =>
  run(async (sql) => {
    if (items.length === 0) return 0;
    const col = (f) => items.map(f);
    const rows = await sql`
      insert into monitor_items (google_email, item_key, level, entity_id, account_id, name, campaign_name, adset_name, source, added_at)
      select ${email}, x.k, x.l, x.e, x.a, x.n, x.c, x.s, 'import', x.t::timestamptz
      from unnest(
        ${col((i) => i.key)}::text[], ${col((i) => i.level)}::text[], ${col((i) => i.entityId)}::text[], ${col((i) => i.accountId)}::text[],
        ${col((i) => i.name)}::text[], ${col((i) => i.campaignName)}::text[], ${col((i) => i.adsetName)}::text[], ${col((i) => i.addedAtIso)}::text[]
      ) as x(k, l, e, a, n, c, s, t)
      where not exists (select 1 from monitor_items m where m.google_email = ${email} and m.item_key = x.k)
      returning id`;
    return rows.length;
  });
