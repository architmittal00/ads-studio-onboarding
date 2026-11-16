import { neon } from "@neondatabase/serverless";

// Google <> Facebook identity mapping for the Google sign-in test flow. One row per (Google account, Facebook login) pair,
// written each time the two are connected in one session. Many Google users can map to one shared Facebook login.
// Every call soft-fails: a database problem must never block sign-in.
let client = null;
let tableReady = null;

function db() {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) return null;
  return (client ||= neon(url));
}

async function ensureTable(sql) {
  tableReady ||= sql`
    create table if not exists identity_links (
      google_sub text not null,
      google_email text not null,
      google_name text,
      fb_user_id text not null,
      fb_email text,
      fb_name text,
      first_linked_at timestamptz not null default now(),
      last_seen_at timestamptz not null default now(),
      sign_in_count integer not null default 1,
      primary key (google_sub, fb_user_id)
    )`;
  await tableReady;
}

export async function recordIdentityLink({ googleSub, googleEmail, googleName, fbUserId, fbEmail, fbName }) {
  const sql = db();
  if (!sql || !googleSub || !googleEmail || !fbUserId) return false;
  try {
    await ensureTable(sql);
    await sql`
      insert into identity_links (google_sub, google_email, google_name, fb_user_id, fb_email, fb_name)
      values (${googleSub}, ${googleEmail}, ${googleName || null}, ${String(fbUserId)}, ${fbEmail || null}, ${fbName || null})
      on conflict (google_sub, fb_user_id) do update set
        google_email = excluded.google_email,
        google_name = excluded.google_name,
        fb_email = excluded.fb_email,
        fb_name = excluded.fb_name,
        last_seen_at = now(),
        sign_in_count = identity_links.sign_in_count + 1`;
    return true;
  } catch (err) {
    tableReady = null;
    console.error("identity link write failed:", err?.message);
    return false;
  }
}

export async function listIdentityLinks() {
  const sql = db();
  if (!sql) return { configured: false, rows: [] };
  try {
    await ensureTable(sql);
    const rows = await sql`
      select google_email, google_name, fb_user_id, fb_email, fb_name, first_linked_at, last_seen_at, sign_in_count
      from identity_links order by last_seen_at desc limit 500`;
    return { configured: true, rows: JSON.parse(JSON.stringify(rows)) };
  } catch (err) {
    return { configured: true, rows: [], error: err?.message || "Query failed" };
  }
}
