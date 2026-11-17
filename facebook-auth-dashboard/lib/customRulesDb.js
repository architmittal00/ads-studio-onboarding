import { neon } from "@neondatabase/serverless";

// A person's own recommendation rules (lib/rules/customRule.js), one row per rule, keyed by Google email. The original
// sentence is kept next to the checked spec and the data it needs, so the table shows what was asked and what it became.
// Deleting is soft (deleted_at) so there is a record of what existed.
export const MAX_RULES_PER_PERSON = 20;
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
      create table if not exists custom_rules (
        id bigserial primary key,
        google_email text not null,
        name text not null,
        original_text text not null,
        spec jsonb not null,
        requires jsonb not null default '[]'::jsonb,
        all_accounts boolean not null default false,
        account_ids jsonb not null default '[]'::jsonb,
        enabled boolean not null default true,
        model text,
        prompt_version integer,
        spec_version integer not null default 1,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        deleted_at timestamptz
      )`;
    await sql`create index if not exists custom_rules_owner on custom_rules (google_email) where deleted_at is null`;
  })();
  await tableReady;
}

export const customRulesConfigured = () => !!db();

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

const toRule = (r) => ({
  id: Number(r.id),
  name: r.name,
  originalText: r.original_text,
  spec: r.spec,
  requires: r.requires,
  allAccounts: r.all_accounts,
  accountIds: r.account_ids,
  enabled: r.enabled,
  model: r.model,
  createdAt: new Date(r.created_at).getTime(),
  updatedAt: new Date(r.updated_at).getTime(),
});

export const listRules = (email) =>
  run(async (sql) => (await sql`select * from custom_rules where google_email = ${email} and deleted_at is null order by created_at, id`).map(toRule));

// The person's switched-on rules that apply to this ad account.
export const activeRulesForAccount = (email, accountId) =>
  run(async (sql) => {
    const rows = await sql`
      select * from custom_rules
      where google_email = ${email} and deleted_at is null and enabled
        and (all_accounts or account_ids @> ${JSON.stringify([accountId])}::jsonb)
      order by created_at, id`;
    return rows.map(toRule);
  });

export const createRule = (email, rule) =>
  run(async (sql) => {
    const [{ n }] = await sql`select count(*)::int as n from custom_rules where google_email = ${email} and deleted_at is null`;
    if (n >= MAX_RULES_PER_PERSON) return { full: true };
    const rows = await sql`
      insert into custom_rules (google_email, name, original_text, spec, requires, all_accounts, account_ids, model, prompt_version, spec_version)
      values (${email}, ${rule.name}, ${rule.originalText}, ${JSON.stringify(rule.spec)}::jsonb, ${JSON.stringify(rule.requires)}::jsonb,
              ${rule.allAccounts}, ${JSON.stringify(rule.accountIds)}::jsonb, ${rule.model}, ${rule.promptVersion}, ${rule.spec.version})
      returning *`;
    return { rule: toRule(rows[0]) };
  });

// Only the person's own, not-deleted rule. Changes the switch, name and accounts (the rule itself is never edited: write a new one).
export const updateRule = (email, id, patch) =>
  run(async (sql) => {
    const rows = await sql`
      update custom_rules set
        enabled = coalesce(${patch.enabled ?? null}::boolean, enabled),
        name = coalesce(${patch.name ?? null}::text, name),
        all_accounts = coalesce(${patch.allAccounts ?? null}::boolean, all_accounts),
        account_ids = coalesce(${patch.accountIds ? JSON.stringify(patch.accountIds) : null}::jsonb, account_ids),
        updated_at = now()
      where id = ${id} and google_email = ${email} and deleted_at is null
      returning *`;
    return rows[0] ? toRule(rows[0]) : null;
  });

export const deleteRule = (email, id) =>
  run(async (sql) => {
    const rows = await sql`update custom_rules set deleted_at = now(), enabled = false, updated_at = now() where id = ${id} and google_email = ${email} and deleted_at is null returning id`;
    return rows.length > 0;
  });
