import { neon } from "@neondatabase/serverless";

// Audit trail of recommendation actions (Recommendations page, and the "!" quick-action window in Custom Views): one
// row per entity an action was attempted on — a pause, a budget change (old -> new), or an ad pushed into an ad set —
// with whether it went through on Meta and, if not, Meta's error. Written by the same routes that make the change, so
// the outcome is the real one. Every call soft-fails: a database problem must never fail or slow an action.
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
      create table if not exists recommendation_actions (
        id bigserial primary key,
        created_at timestamptz not null default now(),
        google_email text,
        fb_user_id text,
        user_name text,
        account_id text,
        entity_type text,
        entity_id text,
        entity_name text,
        action text not null,
        field text,
        old_value text,
        new_value text,
        change_pct numeric,
        success boolean not null,
        error text,
        rule_id text,
        rule_name text,
        custom_rule boolean,
        source text,
        screen text,
        bulk boolean,
        details jsonb
      )`;
    await sql`create index if not exists recommendation_actions_created_idx on recommendation_actions (created_at desc)`;
    await sql`create index if not exists recommendation_actions_entity_idx on recommendation_actions (entity_id, created_at desc)`;
    await sql`create index if not exists recommendation_actions_user_idx on recommendation_actions (google_email, created_at desc)`;
  })();
  await tableReady;
}

const str = (v, max = 300) => (v == null || v === "" ? null : String(v).slice(0, max));
const num = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

// What the client says about the recommendation behind a write (see lib/rules/trackApplied.js's recLogContext).
// Everything is optional and length-limited; nothing in it decides what is written to Meta.
export function cleanRec(rec) {
  if (!rec || typeof rec !== "object") return null;
  return {
    accountId: str(rec.accountId, 60),
    entityType: str(rec.entityType, 20),
    entityName: str(rec.entityName),
    ruleId: str(rec.ruleId, 80),
    ruleName: str(rec.ruleName),
    custom: typeof rec.custom === "boolean" ? rec.custom : null,
    source: str(rec.source, 40),
    screen: str(rec.screen, 60),
    bulk: typeof rec.bulk === "boolean" ? rec.bulk : null,
    oldBudget: num(rec.oldBudget),
    changePct: num(rec.changePct),
    oldStatus: rec.oldStatus === "PAUSED" ? "PAUSED" : rec.oldStatus === "ACTIVE" ? "ACTIVE" : null,
  };
}

// One row for a single-entity write from /api/fb/entity-action.
export function entityActionRow({ entityId, action, value, rec, error }) {
  const r = cleanRec(rec) || {};
  const base = { entityType: r.entityType, entityId, entityName: r.entityName, accountId: r.accountId, success: !error, error: str(error, 1000), rec: r };
  if (action === "pause") return { ...base, action: "PAUSE", field: "status", oldValue: r.oldStatus || "ACTIVE", newValue: "PAUSED" };
  if (action === "activate") return { ...base, action: "ACTIVATE", field: "status", oldValue: r.oldStatus || "PAUSED", newValue: "ACTIVE" };
  const increase = r.oldBudget != null && value < r.oldBudget ? false : true;
  const pct = r.changePct ?? (r.oldBudget ? Math.round(((value - r.oldBudget) / r.oldBudget) * 1000) / 10 : null);
  return {
    ...base,
    action: increase ? "BUDGET_INCREASE" : "BUDGET_DECREASE",
    field: action === "set_lifetime_budget" ? "lifetime_budget" : "daily_budget",
    oldValue: r.oldBudget != null ? String(r.oldBudget) : null,
    newValue: String(value),
    changePct: pct,
  };
}

// session: the NextAuth session of the person acting. rows: from entityActionRow, or built directly (pushed ads).
export async function recordRecActions(session, rows) {
  const sql = db();
  if (!sql || !rows?.length) return false;
  try {
    await ensureTable(sql);
    const google = str(session?.googleEmail);
    const fb = str(session?.fbUserId || session?.user?.id);
    const name = str(session?.user?.name);
    await Promise.all(
      rows.map((x) => {
        const r = x.rec || {};
        return sql`
          insert into recommendation_actions (
            google_email, fb_user_id, user_name, account_id, entity_type, entity_id, entity_name, action, field,
            old_value, new_value, change_pct, success, error, rule_id, rule_name, custom_rule, source, screen, bulk, details
          ) values (
            ${google}, ${fb}, ${name}, ${x.accountId ?? null}, ${x.entityType ?? null}, ${str(x.entityId, 60)}, ${x.entityName ?? null}, ${x.action}, ${x.field ?? null},
            ${x.oldValue ?? null}, ${x.newValue ?? null}, ${x.changePct ?? null}, ${!!x.success}, ${x.error ?? null}, ${r.ruleId ?? null}, ${r.ruleName ?? null}, ${r.custom ?? null}, ${r.source ?? null}, ${r.screen ?? null}, ${r.bulk ?? null},
            ${x.details ? JSON.stringify(x.details) : null}::jsonb
          )`;
      })
    );
    return true;
  } catch (err) {
    tableReady = null;
    console.error("recommendation action log write failed:", err?.message);
    return false;
  }
}
