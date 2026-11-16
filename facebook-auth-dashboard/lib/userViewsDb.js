import { neon } from "@neondatabase/serverless";

// A person's saved views, one document per (Google email, kind). Only the view itself (see lib/userViewsKinds.js), never
// data. Keyed by the Google email alone: not the Facebook id, not the Facebook email.
let client = null;
let tableReady = null;

function db() {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) return null;
  return (client ||= neon(url));
}

async function ensureTable(sql) {
  tableReady ||= sql`
    create table if not exists user_views (
      google_email text not null,
      kind text not null,
      doc jsonb not null,
      version integer not null default 1,
      updated_at timestamptz not null default now(),
      primary key (google_email, kind)
    )`;
  await tableReady;
}

export const userViewsConfigured = () => !!db();

export async function readUserViews(googleEmail) {
  const sql = db();
  if (!sql) return null;
  try {
    await ensureTable(sql);
    const rows = await sql`select kind, doc, version, updated_at from user_views where google_email = ${googleEmail}`;
    const out = {};
    for (const r of rows) out[r.kind] = { doc: r.doc, version: r.version, updatedAt: r.updated_at };
    return out;
  } catch (err) {
    tableReady = null;
    throw err;
  }
}

export async function writeUserView(googleEmail, kind, doc) {
  const sql = db();
  if (!sql) return null;
  try {
    await ensureTable(sql);
    const rows = await sql`
      insert into user_views (google_email, kind, doc) values (${googleEmail}, ${kind}, ${JSON.stringify(doc)}::jsonb)
      on conflict (google_email, kind) do update set doc = excluded.doc, version = user_views.version + 1, updated_at = now()
      returning version`;
    return rows[0]?.version ?? null;
  } catch (err) {
    tableReady = null;
    throw err;
  }
}
