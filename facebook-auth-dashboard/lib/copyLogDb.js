import { neon } from "@neondatabase/serverless";
import { randomUUID } from "crypto";

// Audit trail of cross-account copies (Copy Ads): one row per campaign / ad set / ad a person copied, with who did it,
// the source and destination ids (and ad accounts), and the outcome (success / failed / skipped, plus Meta's error or
// the warning shown). Copying an ad set or campaign writes a row for the ad set / campaign AND one per ad inside it;
// `batch_id` ties every row of one request together, `parent_dest_id` points an ad at its ad set (and an ad set at its
// campaign). Every call soft-fails: a database problem must never fail or slow a copy.
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
      create table if not exists copy_log (
        id bigserial primary key,
        batch_id text not null,
        created_at timestamptz not null default now(),
        google_email text,
        fb_user_id text,
        user_name text,
        request_kind text not null,
        level text not null,
        status text not null,
        name text,
        source_account_id text,
        source_entity_id text,
        dest_account_id text,
        dest_entity_id text,
        parent_source_id text,
        parent_dest_id text,
        requested_status text,
        activation text,
        warning text,
        error text,
        details jsonb
      )`;
    await sql`create index if not exists copy_log_created_idx on copy_log (created_at desc)`;
    await sql`create index if not exists copy_log_batch_idx on copy_log (batch_id)`;
    await sql`create index if not exists copy_log_user_idx on copy_log (google_email, created_at desc)`;
  })();
  await tableReady;
}

const text = (v) => (v == null || v === "" ? null : String(v));

// Turns a copy request's result into log rows. Pure, so it can be tested without a database.
//   kind: "ad" | "adset" | "campaign" — what the person chose to copy
//   steps: the route's result steps (campaign / adset / creative / ad / activation)
//   adsets: (adset and campaign copies) the requested ad sets [{ sourceAdsetId, items: [{ adId }] }], so ads under an ad
//     set that failed to create are still logged, as skipped
export function buildCopyRows({ kind, sourceAccountId, destAccountId, sourceCampaignId, destCampaignId, finalStatus, steps = [], adsets = [] }) {
  const rows = [];
  const base = { source_account_id: text(sourceAccountId), dest_account_id: text(destAccountId), requested_status: text(finalStatus) };
  const creativeByAd = new Map();
  for (const s of steps) if (s.type === "creative" && s.success && s.adId) creativeByAd.set(String(s.adId), s.id);

  const campaignStep = steps.find((s) => s.type === "campaign");
  const campaignDestId = text(campaignStep?.id) || text(destCampaignId);
  if (campaignStep) {
    rows.push({
      ...base,
      level: "campaign",
      status: campaignStep.success ? "success" : "failed",
      name: text(campaignStep.name),
      source_entity_id: text(sourceCampaignId),
      dest_entity_id: text(campaignStep.id),
      error: text(campaignStep.error),
    });
  }

  const adsetDestBySource = new Map();
  const adsetSteps = steps.filter((s) => s.type === "adset");
  for (const s of adsetSteps) {
    if (s.id) adsetDestBySource.set(String(s.sourceAdsetId), String(s.id));
    rows.push({
      ...base,
      level: "adset",
      status: s.success ? "success" : "failed",
      name: text(s.name),
      source_entity_id: text(s.sourceAdsetId),
      dest_entity_id: text(s.id),
      parent_source_id: text(sourceCampaignId),
      parent_dest_id: campaignDestId,
      warning: text(s.warning),
      error: text(s.error),
    });
  }

  const loggedAds = new Set();
  for (const s of steps) {
    if (s.type !== "ad") continue;
    const sourceAdset = text(s.sourceAdsetId);
    loggedAds.add(`${s.adId}|${sourceAdset || s.destAdsetId || ""}`);
    rows.push({
      ...base,
      level: "ad",
      status: s.success ? "success" : s.skipped ? "skipped" : "failed",
      name: text(s.name),
      source_entity_id: text(s.adId),
      dest_entity_id: text(s.id),
      parent_source_id: sourceAdset,
      parent_dest_id: text(s.destAdsetId) || (sourceAdset ? adsetDestBySource.get(sourceAdset) || null : null),
      warning: text(s.warning),
      error: text(s.error),
      details: creativeByAd.has(String(s.adId)) ? { creativeId: creativeByAd.get(String(s.adId)) } : null,
    });
  }

  // Ads that were never attempted because their ad set could not be created.
  for (const a of adsets) {
    if (adsetDestBySource.has(String(a.sourceAdsetId))) continue;
    if (!adsetSteps.some((s) => String(s.sourceAdsetId) === String(a.sourceAdsetId))) {
      rows.push({
        ...base,
        level: "adset",
        status: "skipped",
        name: text(a.adsetFields?.name),
        source_entity_id: text(a.sourceAdsetId),
        parent_source_id: text(sourceCampaignId),
        parent_dest_id: campaignDestId,
        error: campaignStep && !campaignStep.success ? "Not copied: the campaign could not be created." : "Not copied.",
      });
    }
    for (const item of a.items || []) {
      if (loggedAds.has(`${item.adId}|${a.sourceAdsetId}`)) continue;
      rows.push({
        ...base,
        level: "ad",
        status: "skipped",
        name: text(item.name),
        source_entity_id: text(item.adId),
        parent_source_id: text(a.sourceAdsetId),
        error: "Not copied: its ad set could not be created.",
      });
    }
  }

  const activation = steps.find((s) => s.type === "activation");
  const activationState = finalStatus !== "ACTIVE" ? "not_requested" : activation ? (activation.success ? "activated" : "failed") : "not_attempted";
  for (const r of rows) {
    r.activation = r.status === "success" ? activationState : null;
    if (r.status === "success" && activationState === "failed" && activation?.error) r.warning = [r.warning, activation.error].filter(Boolean).join(" ");
  }
  return rows;
}

// session: the NextAuth session of the person copying. Returns the batch id, or null when nothing was written.
export async function recordCopyBatch(session, params) {
  const sql = db();
  if (!sql) return null;
  try {
    const rows = buildCopyRows(params);
    if (rows.length === 0) return null;
    await ensureTable(sql);
    const batchId = randomUUID();
    const who = {
      google_email: text(session?.googleEmail),
      fb_user_id: text(session?.fbUserId || session?.user?.id),
      user_name: text(session?.user?.name),
    };
    await Promise.all(
      rows.map(
        (r) => sql`
          insert into copy_log (
            batch_id, google_email, fb_user_id, user_name, request_kind, level, status, name,
            source_account_id, source_entity_id, dest_account_id, dest_entity_id, parent_source_id, parent_dest_id,
            requested_status, activation, warning, error, details
          ) values (
            ${batchId}, ${who.google_email}, ${who.fb_user_id}, ${who.user_name}, ${params.kind}, ${r.level}, ${r.status}, ${r.name ?? null},
            ${r.source_account_id}, ${r.source_entity_id ?? null}, ${r.dest_account_id}, ${r.dest_entity_id ?? null}, ${r.parent_source_id ?? null}, ${r.parent_dest_id ?? null},
            ${r.requested_status}, ${r.activation ?? null}, ${r.warning ?? null}, ${r.error ?? null}, ${r.details ? JSON.stringify(r.details) : null}::jsonb
          )`
      )
    );
    return batchId;
  } catch (err) {
    tableReady = null;
    console.error("copy log write failed:", err?.message);
    return null;
  }
}
