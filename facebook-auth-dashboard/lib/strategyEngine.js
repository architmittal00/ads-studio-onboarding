// The 8 funnel-structure strategies, transcribed from the agency's playbook.
// Each campaign's `pct` is its share of the account's total daily budget;
// `pages/strategy.js` turns that into real currency amounts once the user
// enters a daily budget.
export const STRATEGIES = [
  {
    id: 1,
    experimentOpen: true,
    history: "has", // requires an existing retargeting pool
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
    campaigns: [{ name: "Campaign 1 — Bottom of Funnel", pct: 100, structure: "CBO · 1 ad set", note: "Advantage+ ad set" }],
  },
  {
    id: 5,
    experimentOpen: true,
    history: "has",
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
