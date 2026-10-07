// The 8 funnel-structure strategies, transcribed from the agency's playbook.
// Each campaign's `pct` is its share of the account's total daily budget;
// `pages/strategy.js` turns that into real currency amounts once the user
// enters a daily budget. `funnel` and each ad set's `type` are the
// machine-readable side of the same data the display already uses them for
// (see components/StrategyCard in pages/strategy.js) — `lib/campaignLaunch.js`
// reads these directly to build real campaign/ad set payloads:
//   funnel: "TOF" | "MOF" | "BOF"              — drives objective/optimization goal
//   adset.type: "advantage" | "retargeting" | "lookalike" | "interest"
//               — "retargeting" always means BOTH website visitors and Page/
//               ad engagers (unioned as two custom_audiences entries by
//               lib/campaignLaunch.js), not visitors alone — MOF uses this
//               for its single ad set in every strategy that has an MOF
//               campaign, since MOF retargets the pool TOF itself builds up
//               over the campaign's life rather than requiring pre-existing
//               history (which is why it's used even in the "fresh account"
//               strategies 2/6, not gated behind the history check).
//   adset.pct: only set for ABO ad sets (budget split within one campaign);
//              omitted for CBO ad sets, which inherit the campaign budget.
export const STRATEGIES = [
  {
    id: 1,
    experimentOpen: true,
    history: "has", // requires an existing retargeting pool
    rationale:
      "Builds a full funnel while putting the bulk of spend where your existing audience already converts — retargeting, buyer lookalikes, and Advantage+ compete for 80% of budget, so Meta's algorithm finds your best performer fast without starving prospecting entirely.",
    campaigns: [
      {
        name: "Campaign 1 — Top of Funnel",
        pct: 5,
        funnel: "TOF",
        structure: "ASC (CBO) · 1 ad set",
        adsets: [{ label: "Optimized for site visits", type: "advantage" }],
      },
      {
        name: "Campaign 2 — Middle of Funnel",
        pct: 15,
        funnel: "MOF",
        structure: "ASC (CBO) · 1 ad set",
        adsets: [{ label: "Retargeting: your website visitors & ad engagers", type: "retargeting" }],
      },
      {
        name: "Campaign 3 — Bottom of Funnel",
        pct: 80,
        funnel: "BOF",
        structure: "ASC (CBO) · 3 ad sets in one campaign",
        adsets: [
          { label: "Retargeting: your website visitors & engagers", type: "retargeting" },
          { label: "Lookalike of your website buyers", type: "lookalike" },
          { label: "Advantage+ ad set", type: "advantage" },
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
      {
        name: "Campaign 1 — Top of Funnel",
        pct: 5,
        funnel: "TOF",
        structure: "ASC (CBO) · 1 ad set",
        adsets: [{ label: "Optimized for site visits", type: "advantage" }],
      },
      {
        name: "Campaign 2 — Middle of Funnel",
        pct: 15,
        funnel: "MOF",
        structure: "ASC (CBO) · 1 ad set",
        adsets: [{ label: "Retargeting: your website visitors & ad engagers", type: "retargeting" }],
      },
      {
        name: "Campaign 3 — Bottom of Funnel",
        pct: 80,
        funnel: "BOF",
        structure: "ASC (CBO) · 1 ad set",
        adsets: [{ label: "Advantage+ ad set", type: "advantage" }],
      },
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
        funnel: "BOF",
        structure: "ASC (CBO) · 3 ad sets in one campaign",
        adsets: [
          { label: "Retargeting: your website visitors & engagers", type: "retargeting" },
          { label: "Lookalike of your website buyers", type: "lookalike" },
          { label: "Advantage+ ad set", type: "advantage" },
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
    campaigns: [
      {
        name: "Campaign 1 — Bottom of Funnel",
        pct: 100,
        funnel: "BOF",
        structure: "CBO · 1 ad set",
        adsets: [{ label: "Advantage+ ad set", type: "advantage" }],
      },
    ],
  },
  {
    id: 5,
    experimentOpen: true,
    history: "has",
    rationale:
      "Same full-funnel idea as Strategy 1, but shifts more budget to prospecting (10% Top, 25% Middle) to grow the audience faster — a better fit if the goal is building pipeline, not just harvesting the demand you already have.",
    campaigns: [
      {
        name: "Campaign 1 — Top of Funnel",
        pct: 10,
        funnel: "TOF",
        structure: "ASC (CBO) · 1 ad set",
        adsets: [{ label: "Optimized for site visits", type: "advantage" }],
      },
      {
        name: "Campaign 2 — Middle of Funnel",
        pct: 25,
        funnel: "MOF",
        structure: "ASC (CBO) · 1 ad set",
        adsets: [{ label: "Retargeting: your website visitors & ad engagers", type: "retargeting" }],
      },
      {
        name: "Campaign 3 — Bottom of Funnel",
        pct: 65,
        funnel: "BOF",
        structure: "ASC (CBO) · 3 ad sets in one campaign",
        adsets: [
          { label: "Retargeting: your website visitors & engagers", type: "retargeting" },
          { label: "Lookalike of your website buyers", type: "lookalike" },
          { label: "Advantage+ ad set", type: "advantage" },
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
      {
        name: "Campaign 1 — Top of Funnel",
        pct: 10,
        funnel: "TOF",
        structure: "ASC (CBO) · 1 ad set",
        adsets: [{ label: "Optimized for site visits", type: "advantage" }],
      },
      {
        name: "Campaign 2 — Middle of Funnel",
        pct: 25,
        funnel: "MOF",
        structure: "ASC (CBO) · 1 ad set",
        adsets: [{ label: "Retargeting: your website visitors & ad engagers", type: "retargeting" }],
      },
      {
        name: "Campaign 3 — Bottom of Funnel",
        pct: 65,
        funnel: "BOF",
        structure: "ASC (CBO) · 1 ad set",
        adsets: [{ label: "Advantage+ ad set", type: "advantage" }],
      },
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
        funnel: "BOF",
        structure: "ASC (ABO) · 2 ad sets",
        // No catalog/product-set targeting yet (deliberately deferred) — both
        // are plain Advantage+-audience ad sets, differentiated only by name
        // and ABO budget split, standing in for a real product-set split later.
        adsets: [
          { label: "Hero Products ad set (Advantage+)", type: "advantage", pct: 60, nameTag: "Hero" },
          { label: "Grooming Products ad set (Advantage+)", type: "advantage", pct: 40, nameTag: "Grooming" },
        ],
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
        funnel: "BOF",
        structure: "Interest-based (CBO) · 3 ad sets",
        // Each ad set's real interest is chosen by the user at launch time
        // (components/InterestPicker.js — a live Meta-search picker,
        // optionally pre-filled with AI-generated suggestions) rather than
        // stored here. `interestQuery` stays null; launch-strategy.js
        // requires a client-supplied `interestChoices` entry per ad set
        // for this strategy instead of resolving one from a static string.
        adsets: [
          { label: "Interest 1", type: "interest", interestQuery: null },
          { label: "Interest 2", type: "interest", interestQuery: null },
          { label: "Interest 3", type: "interest", interestQuery: null },
        ],
      },
    ],
  },
];

// How many of this strategy's ad sets need a user-chosen Meta interest
// (currently only Strategy 8, but derived from the data rather than a
// hardcoded strategy id so any future interest-based strategy picks this up
// automatically). Shared between pages/strategy.js (owns the choices, now
// made directly on the recommendation card) and components/LaunchPanel.js
// (reads them back at launch time).
export function countInterestAdsets(strategy) {
  return strategy.campaigns.reduce((sum, c) => sum + c.adsets.filter((a) => a.type === "interest").length, 0);
}

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
