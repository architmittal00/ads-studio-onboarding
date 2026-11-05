import { graphGet, graphGetAllPages, graphPost } from "./facebookGraph";
import { toMinorUnits } from "./campaignLaunch";
import { BID_STRATEGIES } from "./adsetEdit";

// Everything the campaign "View details" drawer shows and lets you change. Meta only lets a live campaign
// change: name, status, its own (CBO) budget amount, bid strategy (CBO), spend cap and stop time. Objective,
// buying type and special ad categories are fixed once created, so they are shown read-only.

export const CAMPAIGN_FIELDS =
  "name,status,effective_status,account_id,objective,buying_type,daily_budget,lifetime_budget,budget_remaining,bid_strategy,spend_cap," +
  "special_ad_categories,special_ad_category_country,smart_promotion_type,start_time,stop_time,created_time,updated_time,issues_info";

// Meta's documented value for "no spend cap".
const NO_SPEND_CAP = "922337203685478";

const major = (minor) => (minor == null || minor === "" ? null : Number(minor) / 100);

export function campaignFormFrom(c) {
  const cap = c.spend_cap && String(c.spend_cap) !== NO_SPEND_CAP && Number(c.spend_cap) > 0 ? major(c.spend_cap) : null;
  return {
    name: c.name || "",
    status: c.status === "ACTIVE" ? "ACTIVE" : "PAUSED",
    budget: major(c.daily_budget ?? c.lifetime_budget),
    bidStrategy: c.bid_strategy || "LOWEST_COST_WITHOUT_CAP",
    spendCap: cap,
    stopTime: c.stop_time || null,
  };
}

export function campaignInfoFrom(c) {
  const rows = [];
  const add = (label, value) => {
    if (value !== null && value !== undefined && value !== "" && !(Array.isArray(value) && value.length === 0)) rows.push({ label, value: Array.isArray(value) ? value.join(", ") : String(value) });
  };
  add("Buying type", c.buying_type);
  add("Special ad categories", (c.special_ad_categories || []).filter((x) => x !== "NONE"));
  add("Special ad category countries", c.special_ad_category_country);
  add("Advantage+ campaign type", c.smart_promotion_type);
  add("Budget remaining", c.budget_remaining && Number(c.budget_remaining) > 0 ? major(c.budget_remaining) : null);
  add("Created", c.created_time);
  add("Last updated", c.updated_time);
  if (c.issues_info?.length) add("Issues", c.issues_info.map((i) => i.error_summary || i.error_message));
  return rows;
}

export async function fetchCampaignFull(id, token) {
  const c = await graphGet(`/${id}`, token, { fields: CAMPAIGN_FIELDS });
  return {
    campaign: c,
    form: campaignFormFrom(c),
    info: campaignInfoFrom(c),
    budgetType: c.daily_budget ? "daily" : c.lifetime_budget ? "lifetime" : null,
    startTime: c.start_time || null,
    accountId: c.account_id ? `act_${c.account_id}` : null,
    bidStrategies: BID_STRATEGIES,
  };
}

// `edits` holds only what changed. Returns the labels of what was saved.
export async function updateCampaign(token, id, edits) {
  const current = await graphGet(`/${id}`, token, { fields: "daily_budget,lifetime_budget" });
  const payload = {};
  const changed = [];
  if ("name" in edits) {
    const name = String(edits.name || "").trim();
    if (!name) throw new Error("The campaign needs a name.");
    payload.name = name;
    changed.push("name");
  }
  if ("status" in edits) {
    if (!["ACTIVE", "PAUSED"].includes(edits.status)) throw new Error("Status must be Active or Paused.");
    payload.status = edits.status;
    changed.push("status");
  }
  if ("budget" in edits) {
    const amount = Number(edits.budget);
    if (!(amount > 0)) throw new Error("Budget must be more than 0.");
    if (current.daily_budget) payload.daily_budget = toMinorUnits(amount);
    else if (current.lifetime_budget) payload.lifetime_budget = toMinorUnits(amount);
    else throw new Error("This campaign has no budget of its own: its budgets are set on the ad sets.");
    changed.push("budget");
  }
  if ("bidStrategy" in edits) {
    if (!BID_STRATEGIES.some((b) => b.value === edits.bidStrategy)) throw new Error("Unknown bid strategy.");
    payload.bid_strategy = edits.bidStrategy;
    changed.push("bid strategy");
  }
  if ("spendCap" in edits) {
    if (edits.spendCap == null || edits.spendCap === "") payload.spend_cap = NO_SPEND_CAP;
    else {
      const cap = Number(edits.spendCap);
      if (!(cap > 0)) throw new Error("Spend cap must be more than 0.");
      payload.spend_cap = toMinorUnits(cap);
    }
    changed.push("spend cap");
  }
  if ("stopTime" in edits && edits.stopTime) {
    payload.stop_time = edits.stopTime;
    changed.push("stop time");
  }
  if (!Object.keys(payload).length) return { changed: [] };
  await graphPost(`/${id}`, token, payload);
  return { changed };
}

// ── Switching between a campaign budget (CBO) and ad set budgets (ABO) ──────────────────────────────────────
// Campaign budget -> ad set budgets is documented by Meta: one update of the campaign with `adset_budgets`
// listing a budget for EVERY ad set removes the campaign budget (not possible above 70 ad sets). The other
// way, setting a budget on the campaign, is not described in Meta's docs; it is sent as a plain campaign
// budget update and Meta's own refusal (if any) is passed through untouched. Both are a single request, so
// they either apply or change nothing.

const LIVE_ADSET_STATUSES = ["ACTIVE", "PAUSED", "CAMPAIGN_PAUSED", "ADSET_PAUSED", "IN_PROCESS", "WITH_ISSUES", "PENDING_REVIEW", "DISAPPROVED", "PENDING_BILLING_INFO"];

// Every ad set still in the campaign (archived and deleted ones are not part of it), budgets in whole currency.
export async function fetchCampaignAdsets(campaignId, token) {
  const { data } = await graphGetAllPages(`/${campaignId}/adsets`, token, {
    fields: "id,name,effective_status,daily_budget,lifetime_budget",
    filtering: [{ field: "effective_status", operator: "IN", value: LIVE_ADSET_STATUSES }],
    limit: 500,
  });
  return (data || []).map((a) => ({
    id: a.id,
    name: a.name,
    status: a.effective_status,
    dailyBudget: major(a.daily_budget),
    lifetimeBudget: major(a.lifetime_budget),
  }));
}

// to: "adset"  -> budgets: [{ adsetId, amount }] for every ad set, in the campaign's current budget type.
// to: "campaign" -> budget (amount) and budgetType ("daily" | "lifetime").
export async function switchBudgetMode(token, campaignId, { to, budgets, budget, budgetType }) {
  const current = await graphGet(`/${campaignId}`, token, { fields: "daily_budget,lifetime_budget" });
  const currentType = current.daily_budget ? "daily" : current.lifetime_budget ? "lifetime" : null;

  if (to === "adset") {
    if (!currentType) throw new Error("This campaign already uses ad set budgets.");
    const adsets = await fetchCampaignAdsets(campaignId, token);
    if (adsets.length === 0) throw new Error("This campaign has no ad sets to give a budget to.");
    if (adsets.length > 70) throw new Error("Meta doesn't allow turning off the campaign budget on a campaign with more than 70 ad sets.");
    const byId = new Map((budgets || []).map((b) => [String(b.adsetId), Number(b.amount)]));
    const key = `${currentType}_budget`;
    const list = adsets.map((a) => {
      const amount = byId.get(String(a.id));
      if (!(amount > 0)) throw new Error(`Give "${a.name}" a budget more than 0 (Meta needs one for every ad set).`);
      return { adset_id: a.id, [key]: toMinorUnits(amount) };
    });
    await graphPost(`/${campaignId}`, token, { adset_budgets: list });
    return { changed: ["budget mode"], to: "adset", count: list.length };
  }

  if (to === "campaign") {
    if (currentType) throw new Error("This campaign already has its own budget.");
    if (!["daily", "lifetime"].includes(budgetType)) throw new Error("Choose a daily or a lifetime budget.");
    const amount = Number(budget);
    if (!(amount > 0)) throw new Error("The campaign budget must be more than 0.");
    await graphPost(`/${campaignId}`, token, { [`${budgetType}_budget`]: toMinorUnits(amount) });
    return { changed: ["budget mode"], to: "campaign" };
  }

  throw new Error("Unknown budget mode.");
}
