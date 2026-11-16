// What is saved per person, and the one rule behind it: ONLY the view itself (which tabs are open, their account,
// metrics, filters, sorting, colour scales...). Never data: fetched rows, results and loading state are dropped here
// before anything reaches the database. Used by the API (to clean what is stored) and by the browser (to know which
// local key each kind lives under).
export const VIEW_KINDS = {
  // Custom Views: the open tabs, tab groups and which one is active.
  explore_views: { key: "fb-dashboard:explore-views", list: "views", max: 60 },
  // Custom Views: the formula metrics the person created.
  custom_metrics: { key: "fb-dashboard:explore-custom-metrics", list: null, max: 300 },
  // Recent Changes: the open tabs.
  recent_changes_tabs: { key: "fb-dashboard:recent-changes-tabs", list: "tabs", max: 60 },
  // Recommendations: the open tabs.
  recs_tabs: { key: "recs-tabs:v1", list: "tabs", max: 60 },
};

export const VIEW_KIND_NAMES = Object.keys(VIEW_KINDS);

// Keys that hold fetched data or transient state. Removed wherever they appear in a view.
const DATA_KEYS = new Set(["result", "resultFetchedAt", "rows", "progressMessage", "needsHydrate", "loading", "error"]);
const MAX_BYTES = 600 * 1024;

function strip(value, depth) {
  if (depth > 12) throw new Error("View is nested too deeply");
  if (Array.isArray(value)) {
    if (value.length > 2000) throw new Error("A list in the view is too long");
    return value.map((x) => strip(x, depth + 1));
  }
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) if (!DATA_KEYS.has(k)) out[k] = strip(v, depth + 1);
    return out;
  }
  if (typeof value === "string" && value.length > 20000) throw new Error("A text value in the view is too long");
  return value;
}

// Returns the cleaned view document, or throws an Error with a reason.
export function sanitizeViewDoc(kind, doc) {
  const spec = VIEW_KINDS[kind];
  if (!spec) throw new Error("Unknown view kind");
  const list = spec.list ? doc?.[spec.list] : doc;
  if (!Array.isArray(list)) throw new Error("Not a list of views");
  if (list.length > spec.max) throw new Error("Too many views");
  const clean = strip(doc, 0);
  if (JSON.stringify(clean).length > MAX_BYTES) throw new Error("View is too large");
  return clean;
}
