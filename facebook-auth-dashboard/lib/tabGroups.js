// Shared "Chrome-style tab groups" model — used identically by every
// multi-tab page in this app (pages/explore.js, pages/recent-changes.js). A
// group is just {id, name, color, collapsed}; membership lives on each
// page's own view objects via a `groupId` field, not here. Kept as plain,
// page-agnostic helpers rather than a shared component since each page's tab
// bar is still its own render code (same reasoning recent-changes.js's own
// tab bar already follows for the rest of its view-state machinery) — this
// module only factors out the genuinely identical, state-free pieces.

// A fixed palette, like Chrome's own tab groups, so two groups are always
// visually distinct without asking anyone to pick a hex value. `bg`/`border`
// are used for the group's chip and the tint across its member tabs; `dot`
// is the small swatch shown in the color picker and next to the group's
// name.
export const GROUP_COLORS = [
  { key: "grey", dot: "#9aa0a6", bg: "rgba(154, 160, 166, 0.18)", border: "#9aa0a6" },
  { key: "blue", dot: "#4c8bf5", bg: "rgba(76, 139, 245, 0.18)", border: "#4c8bf5" },
  { key: "red", dot: "#ea4335", bg: "rgba(234, 67, 53, 0.18)", border: "#ea4335" },
  { key: "yellow", dot: "#f4b400", bg: "rgba(244, 180, 0, 0.2)", border: "#f4b400" },
  { key: "green", dot: "#34a853", bg: "rgba(52, 168, 83, 0.18)", border: "#34a853" },
  { key: "pink", dot: "#e65fa1", bg: "rgba(230, 95, 161, 0.18)", border: "#e65fa1" },
  { key: "purple", dot: "#a142f4", bg: "rgba(161, 66, 244, 0.18)", border: "#a142f4" },
  { key: "cyan", dot: "#24c1e0", bg: "rgba(36, 193, 224, 0.18)", border: "#24c1e0" },
];

export function newGroupId() {
  return `g${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

export function groupColor(key) {
  return GROUP_COLORS.find((c) => c.key === key) || GROUP_COLORS[0];
}

// The first palette color not already used by an existing group — falls
// back to cycling through the palette once every color is taken, rather
// than ever leaving a new group without one.
export function pickNextGroupColor(existingGroups) {
  const used = new Set(existingGroups.map((g) => g.color));
  return (GROUP_COLORS.find((c) => !used.has(c.key)) || GROUP_COLORS[existingGroups.length % GROUP_COLORS.length]).key;
}

// Moves `viewId` to sit immediately after the last existing member of
// `groupId` in `viewsList` (or leaves it roughly where it was if `groupId`
// has no member yet) — keeps a group's tabs contiguous, the same guarantee
// Chrome enforces, so each page's tab-strip render can assume exactly one
// contiguous run per group id.
export function moveViewNextToGroup(viewsList, viewId, groupId) {
  const from = viewsList.findIndex((v) => v.id === viewId);
  if (from === -1) return viewsList;
  const view = viewsList[from];
  const withoutView = viewsList.filter((v) => v.id !== viewId);
  let insertAt = withoutView.findIndex((v) => v.groupId === groupId);
  if (insertAt === -1) {
    insertAt = Math.min(from, withoutView.length);
  } else {
    while (insertAt < withoutView.length && withoutView[insertAt].groupId === groupId) insertAt++;
  }
  const next = [...withoutView];
  next.splice(insertAt, 0, view);
  return next;
}
