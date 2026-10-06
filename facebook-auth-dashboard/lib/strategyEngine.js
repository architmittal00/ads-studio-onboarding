// The 8 funnel-structure strategies, transcribed from the agency's playbook.
// Each campaign's `pct` is its share of the account's total daily budget;
// `pages/strategy.js` turns that into real currency amounts once the user
// enters a daily budget.
export const STRATEGIES = [
  {
    id: 1,
    experimentOpen: true,
    history: "has", // requires an existing retargeting pool
    rationale:
      "Builds a full funnel while putting the bulk of spend where your existing audience already converts — retargeting, buyer lookalikes, and Advantage+ compete for 80% of budget, so Meta's algorithm finds your best performer fast without starving prospecting entirely.",
    campaigns: [
      { name: "Campaign 1 — Top of Funnel", pct: 5, structure: "ASC (CBO) · 1 ad set", note: "Optimized for site visits" },
      { name: "Campaign 2 — Middle of Funnel", pct: 15, structure: "ASC (CBO) · 1 ad set", note: "Optimized for Add to Cart" },
      {
        name: "Campaign 3 — Bottom of Funnel",
        pct: 80,
        structure: "ASC (CBO) · 3 ad sets in one campaign",
        adsets: [
          "Retargeting: your website visitors & engagers",
          "Lookalike of your website buyers",
          "Advantage+ ad set",
        ],
      },
    ],
  },
  {
    id: 2,
    experimentOpen: true,
    history: "fresh",
    rationale:
      "Still tests the full funnel, but keeps Bottom-of-Funnel simple — one Advantage+ ad set, since there's no retargeting pool yet to split further into retargeting/lookalike/Advantage+.",
    campaigns: [
      { name: "Campaign 1 — Top of Funnel", pct: 5, structure: "ASC (CBO) · 1 ad set", note: "Optimized for site visits" },
      { name: "Campaign 2 — Middle of Funnel", pct: 15, structure: "ASC (CBO) · 1 ad set", note: "Optimized for Add to Cart" },
      { name: "Campaign 3 — Bottom of Funnel", pct: 80, structure: "ASC (CBO) · 1 ad set", note: "Advantage+ ad set" },
    ],
  },
  {
    id: 3,
    experimentOpen: false,
    history: "has",
    rationale:
      "Skips prospecting entirely and puts 100% of budget against people who already know you — retargeting, buyer lookalikes, and Advantage+ — the fastest path to ROAS when you're not looking to experiment and already have an audience to work with.",
    campaigns: [
      {
        name: "Campaign 1 — Bottom of Funnel",
        pct: 100,
        structure: "ASC (CBO) · 3 ad sets in one campaign",
        adsets: [
          "Retargeting: your website visitors & engagers",
          "Lookalike of your website buyers",
          "Advantage+ ad set",
        ],
      },
    ],
  },
  {
    id: 4,
    experimentOpen: false,
    history: "fresh",
    rationale:
      "The simplest possible structure: one Advantage+ ad set gets the full budget. Right for a fresh account that isn't ready to experiment and has no retargeting pool to lean on yet — nothing to fragment budget across.",
    campaigns: [{ name: "Campaign 1 — Bottom of Funnel", pct: 100, structure: "CBO · 1 ad set", note: "Advantage+ ad set" }],
  },
  {
    id: 5,
    experimentOpen: true,
    history: "has",
    rationale:
      "Same full-funnel idea as Strategy 1, but shifts more budget to prospecting (10% Top, 25% Middle) to grow the audience faster — a better fit if the goal is building pipeline, not just harvesting the demand you already have.",
    campaigns: [
      { name: "Campaign 1 — Top of Funnel", pct: 10, structure: "ASC (CBO) · 1 ad set", note: "Optimized for site visits" },
      { name: "Campaign 2 — Middle of Funnel", pct: 25, structure: "ASC (CBO) · 1 ad set", note: "Optimized for Add to Cart" },
      {
        name: "Campaign 3 — Bottom of Funnel",
        pct: 65,
        structure: "ASC (CBO) · 3 ad sets in one campaign",
        adsets: [
          "Retargeting: your website visitors & engagers",
          "Lookalike of your website buyers",
          "Advantage+ ad set",
        ],
      },
    ],
  },
  {
    id: 6,
    experimentOpen: true,
    history: "fresh",
    rationale:
      "Same idea as Strategy 2 with more prospecting weight (10% Top, 25% Middle) — useful if you want the funnel to build awareness and cart activity faster, even without history to retarget yet.",
    campaigns: [
      { name: "Campaign 1 — Top of Funnel", pct: 10, structure: "ASC (CBO) · 1 ad set", note: "Optimized for site visits" },
      { name: "Campaign 2 — Middle of Funnel", pct: 25, structure: "ASC (CBO) · 1 ad set", note: "Optimized for Add to Cart" },
      { name: "Campaign 3 — Bottom of Funnel", pct: 65, structure: "ASC (CBO) · 1 ad set", note: "Advantage+ ad set" },
    ],
  },
  {
    id: 7,
    experimentOpen: false,
    history: "any", // no specific idea in mind — works whether or not they have a pool
    rationale:
      "A safe, always-on structure when there's no particular audience or product angle to test — splitting budget across two product categories (both Advantage+) lets performance naturally shift toward whichever one converts.",
    campaigns: [
      {
        name: "Campaign 1 — All Bottom of Funnel",
        pct: 100,
        structure: "ASC (ABO) · 2 ad sets",
        adsets: ["60% of budget — Hero Products ad set (Advantage+)", "40% of budget — Grooming Products ad set (Advantage+)"],
      },
    ],
  },
  {
    id: 8,
    experimentOpen: false,
    history: "any",
    rationale:
      "An alternative to Strategy 7 built on interests instead of product categories — three interest-based ad sets compete for one CBO budget, letting Meta shift spend to whichever interest performs, with no product catalog split needed.",
    campaigns: [
      {
        name: "Campaign 1 — All Bottom of Funnel",
        pct: 100,
        structure: "Interest-based (CBO) · 3 ad sets",
        adsets: ["Interest 1", "Interest 2", "Interest 3"],
      },
    ],
  },
];

// Picks every strategy whose stated conditions match the two inputs this
// tool collects (experimentOpen, hasHistory), ranked — not narrowed to one.
// Strategy 1/5 and 2/6 share identical stated conditions and differ only in
// how aggressive the TOF/MOF split is; both are shown, lower-TOF (the
// account's original numbering) first, as "Recommended" then "Also
// consider" rather than this tool silently picking one for the user.
//
// The agency's 8 strategies don't cleanly cover "not open to experiment"
// with a single orthogonal axis — 3/4 are conditioned on history, 7/8 are
// conditioned on "no specific idea in mind" (an axis this tool doesn't ask
// about separately). Rather than add a third question, when
// experimentOpen is false this folds "no specific idea" into the existing
// history answer: a history-backed account sees 3 ranked above 7/8 (it
// directly uses the retargeting pool they already have); a fresh account
// sees 4 ranked above 7/8 (3 is excluded outright — it hard-requires a
// retargeting pool that doesn't exist yet). 7/8 stay available either way
// as the "don't have a specific angle" alternatives.
export function recommendStrategies({ experimentOpen, hasHistory }) {
  const eligible = STRATEGIES.filter((s) => {
    if (s.experimentOpen !== experimentOpen) return false;
    if (s.history === "any") return true;
    return hasHistory ? s.history === "has" : s.history === "fresh";
  });

  // Keep the agency's own numbering as the tie-break order (1 before 5, 2
  // before 6, 3/4 before 7/8) — it already reads as "primary, then
  // alternative".
  return eligible.sort((a, b) => a.id - b.id);
}

// For a strategy that did NOT come back from recommendStrategies(), explains
// which of the two inputs it's conditioned on doesn't match — so "show all
// strategies" can tell the user why each one isn't the current pick instead
// of just omitting it.
export function explainMismatch(strategy, { experimentOpen, hasHistory }) {
  if (strategy.experimentOpen !== experimentOpen) {
    return experimentOpen
      ? "This is a Bottom-of-Funnel-only structure, but you said the owner is open to experimenting with a full funnel."
      : "This runs a full Top/Middle/Bottom-of-Funnel structure, but you said the owner wants to stay focused on Bottom-of-Funnel only.";
  }
  if (strategy.history === "has" && !hasHistory) {
    return "Requires an existing retargeting pool (past website visitors/purchasers) to retarget and build a lookalike from — you marked this account as fresh, with no prior data.";
  }
  if (strategy.history === "fresh" && hasHistory) {
    return "Built for a fresh account with no retargeting pool. Since this account does have history, the strategies that put it to use (retargeting + lookalike) are a better fit.";
  }
  return null;
}

// Rounds a computed per-campaign/ad-set budget amount to a clean number —
// nearest 100 for a total daily budget under 10,000 (in the account's
// currency units), nearest 500 at or above that, so recommendations read as
// "₹15,900/day" rather than "₹15,873.42/day".
export function roundBudgetAmount(amount, totalDailyBudget) {
  const unit = totalDailyBudget < 10000 ? 100 : 500;
  return Math.round(amount / unit) * unit;
}
