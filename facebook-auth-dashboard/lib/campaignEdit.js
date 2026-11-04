import { graphGet, graphPost } from "./facebookGraph";
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
