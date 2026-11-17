import { neon } from "@neondatabase/serverless";

// The Monitor watchlist, one append-only log per person (Google email). Adding or removing never edits a row, it writes a
// new event, so the table keeps when and what was added (and removed). The current list is the latest event per item,
// kept when that event is an "add"; "Monitoring since" is that event's time.
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
      create table if not exists monitor_events (
        id bigserial primary key,
        google_email text not null,
        action text not null,
        item_key text not null,
        level text not null,
        entity_id text not null,
        account_id text not null,
        name text,
        campaign_name text,
        adset_name text,
        source text,
        at timestamptz not null default now()
      )`;
    await sql`create index if not exists monitor_events_owner_item on monitor_events (google_email, item_key, id desc)`;
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
  addedAt: new Date(r.at).getTime(),
});

export const readMonitorItems = (email) =>
  run(async (sql) => {
    const rows = await sql`
      select distinct on (item_key) item_key, action, level, entity_id, account_id, name, campaign_name, adset_name, source, at
      from monitor_events where google_email = ${email}
      order by item_key, id desc`;
    return rows.filter((r) => r.action === "add").map(toItem).sort((a, b) => a.addedAt - b.addedAt);
  });

// Writes an "add" unless the item is already on the list. Returns true when a row was written.
export const addMonitorItem = (email, item) =>
  run(async (sql) => {
    const rows = await sql`
      insert into monitor_events (google_email, action, item_key, level, entity_id, account_id, name, campaign_name, adset_name, source)
      select ${email}, 'add', ${item.key}, ${item.level}, ${item.entityId}, ${item.accountId}, ${item.name}, ${item.campaignName}, ${item.adsetName}, ${item.source}
      where coalesce((select action from monitor_events where google_email = ${email} and item_key = ${item.key} order by id desc limit 1), 'remove') <> 'add'
      returning id`;
    return rows.length > 0;
  });

export const removeMonitorItem = (email, key) =>
  run(async (sql) => {
    const rows = await sql`
      insert into monitor_events (google_email, action, item_key, level, entity_id, account_id, name, campaign_name, adset_name, source)
      select ${email}, 'remove', item_key, level, entity_id, account_id, name, campaign_name, adset_name, source
      from monitor_events
      where google_email = ${email} and item_key = ${key} and action = 'add'
        and id = (select max(id) from monitor_events where google_email = ${email} and item_key = ${key})
      returning id`;
    return rows.length > 0;
  });

// One-time carry-over of what a person already had saved in their browser. Idempotent: an item that has ANY event for this
// person is skipped, so running it again (or from a second browser) only adds what is genuinely new, keeping the time it
// was originally added.
export const importMonitorItems = (email, items) =>
  run(async (sql) => {
    if (items.length === 0) return 0;
    const col = (f) => items.map(f);
    const rows = await sql`
      insert into monitor_events (google_email, action, item_key, level, entity_id, account_id, name, campaign_name, adset_name, source, at)
      select ${email}, 'add', x.k, x.l, x.e, x.a, x.n, x.c, x.s, 'import', x.t::timestamptz
      from unnest(
        ${col((i) => i.key)}::text[], ${col((i) => i.level)}::text[], ${col((i) => i.entityId)}::text[], ${col((i) => i.accountId)}::text[],
        ${col((i) => i.name)}::text[], ${col((i) => i.campaignName)}::text[], ${col((i) => i.adsetName)}::text[], ${col((i) => i.addedAtIso)}::text[]
      ) as x(k, l, e, a, n, c, s, t)
      where not exists (select 1 from monitor_events m where m.google_email = ${email} and m.item_key = x.k)
      returning id`;
    return rows.length;
  });
