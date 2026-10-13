# Project Status — Facebook Auth Dashboard

> **Maintenance rule (read this first): keep this file current.** Whoever (human or Claude) finishes a meaningful chunk of work on this repo — a shipped PR, a new finding, a change of plan — must update the **"Most recent work"** and **"What's next"** sections below before ending the session. This file is what lets anyone (any device, any fresh Claude session) pick the project up cold. Stale status here is worse than no status at all, so don't skip the update.
>
> Last updated: **2026-10-13**, by Claude, right after merging PR #144.

---

## 1. What this is

A Next.js (Pages Router) internal tool for Indian D2C Facebook/Meta Ads media buying. Lets a user log in with Facebook and: audit an ad account, get a recommended campaign strategy, launch campaigns/ad sets directly, investigate recent account changes, and build arbitrary custom report views ("Explore").

- **Repo:** `architmittal00/ads-studio-onboarding` (GitHub)
- **App subdirectory:** `facebook-auth-dashboard/` (this file's directory) — the git root one level up (`/Users/architmittal/Documents/Studio Onboarding Archit`) also contains unrelated personal/other-project files (dark-theme, Admin design, scene-detector, etc.) that have nothing to do with this app.
- **Deployed:** https://ads-studio-onboarding.vercel.app (Vercel, auto-deploys from `main`)
- **Architecture / how-it-works reference:** [`README.md`](./README.md) in this same directory — it's long and kept detailed and up to date per-feature. **Read it** for how any given feature actually works, Graph API caveats, caching layers, env vars, etc. This status file is deliberately *not* a duplicate of that — it's the "where are we, what's next" layer on top.

---

## 2. How to work on this repo (read before touching code)

1. **Always fetch before trusting local git state.** See §3 below — the primary checkout can be badly stale. Run `git fetch origin` and diff against `origin/main`, don't trust a local branch pointer.
2. **Never commit directly to `main`.** Every change ships via a feature branch + PR, created from a **fresh worktree off a freshly-fetched `origin/main`** — not from whatever the primary checkout's working directory currently has lying around in it. Pattern used throughout this project's history:
   ```bash
   cd "/Users/architmittal/Documents/Studio Onboarding Archit/facebook-auth-dashboard"
   git fetch origin
   git worktree add .worktrees/<short-name> -b <branch-name> origin/main
   cd .worktrees/<short-name>/facebook-auth-dashboard
   # make the change, npm install, npm run lint, npm run build
   git add <specific files>   # never blanket `git add -A` in this repo
   git commit -m "..."
   git push -u origin <branch-name>
   gh pr create --title "..." --body "..."
   gh pr merge <N> --squash --delete-branch
   cd "/Users/architmittal/Documents/Studio Onboarding Archit/facebook-auth-dashboard"
   git worktree remove .worktrees/<short-name> --force
   ```
3. **Standing authorization:** the user (archit.mittal@pickrr.com) has explicitly and repeatedly authorized pushing and merging to GitHub without asking for confirmation each time. Still use feature branches + PRs (never push straight to `main`), but don't pause to ask before merging.
4. **Always `npm run lint && npm run build`** in the worktree before shipping. Both must be clean.
5. **Browser-verify before shipping**, using the disposable mocked-preview-harness convention (see §5) — don't ship UI changes on lint/build passing alone.
6. **One commit per logically-complete PR**, squash-merged. Keep PRs scoped (a batch of related small fixes in one PR is fine and is the established pattern here — see PR #135, #140 for examples of 5-7 related items shipped together).

---

## 3. ⚠️ Known trap: the primary checkout is unreliable

`/Users/architmittal/Documents/Studio Onboarding Archit/facebook-auth-dashboard` (no `.worktrees/*` suffix — the directory this file lives in) is **not a reliable source of truth**. Its checked-out branch has, more than once, been found to be 50-180+ commits behind `origin/main` while its *working tree* still had a pile of large uncommitted `M`/`??` changes sitting in it — not real local work, just stale drift from old sessions that used this checkout for live dev-server preview testing without ever committing/pulling here.

**Concretely, as of 2026-10-13:** this checkout is on branch `feat/mof-retargeting-engagers`, whose tip commit (`d19df7d`) was merged into `main` ~140 commits ago — the branch itself is long obsolete. The working tree nonetheless has dozens of files showing as modified/untracked (`pages/explore.js`, `pages/launch.js`, `components/SortableTable.js`, etc.) purely because they mirror already-shipped `origin/main` content sitting uncommitted on disk. **Do not `git add`/commit from this checkout directly, and do not assume its `git diff` represents real pending work.**

**How to work safely here:**
- Before concluding anything is "uncommitted work that needs shipping," run `git fetch origin` then diff the specific file against the real blob: `diff <(git show origin/main:facebook-auth-dashboard/<path>) <path>`. If they match, it's just stale drift — ignore it.
- When something *does* turn out to be real new work sitting in this checkout (rare, but happened with the Explore "Part 3" batch — see §5), extract it by diffing against `origin/main`, confirm the diff is scoped to what you expect, then copy just those files into a fresh worktree branched off `origin/main` and ship from there. Full worked example: PR #140 (this session) and PR #77 (earlier).
- This checkout is also what `preview_start`'s dev server convention points at in `.claude/launch.json` (port 3000) — if you need to browser-test a worktree's code instead, run `npm run dev` manually on a different port inside the worktree and open it via `preview_start` with an explicit `url` (see §5).
- **Possible future cleanup** (not yet done, needs user confirmation since it's a bit destructive): this checkout could be reset to track `main` properly (`git checkout main && git pull`) and have its stale working-tree cruft reconciled or discarded. Nobody has done this yet — raise it with the user before doing it, since there could in principle be real uncommitted work buried in there that hasn't been triaged.

---

## 4. Current state of `origin/main`

Latest commit as of this writing: **`8c31133`** — "Explore: replace the two separate custom-date-range inputs with one inline calendar picker" (PR #144, merged 2026-10-13).

No open PRs. Everything described below is merged and live.

### Feature inventory (high level — see README.md for depth)

| Route | Feature | Status |
|---|---|---|
| `/` | Facebook OAuth login (NextAuth) | Stable |
| `/report` | **Audit Report** — account handover report: overview + trend drill-down, top campaigns, revenue pareto by creative/age-gender/platform/product/state, account structure tree, budget utilization & creative-count recommendations, pixel health | Stable, mature |
| `/strategy` | **Figure Out Strategy** — recommends one of 8 funnel-shaped campaign strategies from `lib/strategyEngine.js`, with a data-driven "does this account have history" signal | Stable, mature |
| `/launch` | **Launch** — direct, self-serve campaign/ad-set creation (new ad set → new or existing campaign, or duplicate an existing ad set), Indian-D2C defaults throughout, live Meta search-backed location/language/interest pickers | **Shipped** (PR #124–126 and others) — see §6, this was a full plan that is now fully implemented, not pending |
| `/recent-changes` | **Recent Changes** — detects recent account-level changes (budget, targeting, creative, status) and their before/after performance impact, with an Investigate drill-down (campaign → ad set → ad, RCA tables) | Stable, mature, many rounds of polish (PRs #110–123) |
| `/explore` | **Custom Views (Explore)** — build-your-own report: pick account(s)/level/breakdown/metrics/date-range, multi-tab views, drill-down (Campaign→AdSet→Ad), charting with axis customization, custom ratio metrics, name/ID filters, result filters (value or %-change), Total row, CSV export | **Most actively developed area right now** — see §5 for the latest round |
| `/dashboard` | Raw Data — raw profile/Pages/Ad Accounts payload + manual ROAS check | Stable, simple |
| `/logs` | API Logs — recent Graph API call log (method/path/status/duration) | Stable, simple |

---

## 5. Most recent work (this session, 2026-10-13)

### PR #144 — single inline calendar for the custom date range

The "Custom" date range option used two independent native `<input type="date">` fields. The user explicitly asked for one unified picker instead of two separate fields — added `components/DateRangePicker.js`: a click-through calendar popover (click a start day, then an end day; hovering between them previews the range; live day count; Apply/Cancel). Shows two months side by side so a range crossing a month boundary doesn't need manual navigation.

Positioned `fixed` from the trigger's own `getBoundingClientRect()` (same convention as `RowActions`' action menu) rather than CSS-anchored `absolute`, since the trigger lives inside Explore's internally-scrolling query panel. **Found and fixed a real overflow bug during testing**: a naive left-anchor placed the ~520px-wide popover off the right edge of the screen, since the trigger sits in a narrow 380px right-hand column — now clamped into the viewport on both axes (flips above the trigger when there's no room below, shifts left when there's no room to the right).

This supersedes PR #142's item 5 ("already existed, no change needed") — it's now an actual unified picker, not two fields.

### PR #142 — chart filtering visibility, stuck query-panel height, always-on search, Last Month preset

Shipped against another batch of 5 user-reported Explore issues:

1. **"Applying filters don't work in charts"** — root-caused to `connectNulls` on the time-series `<Line>` in `components/ExploreChart.js`: a row excluded by the "Filter results" panel just got smoothed over into an invisible gap instead of a visible break, so filtering a chart could look like it did nothing even though the underlying data array genuinely shrank (verified directly: dot/row counts dropped, the line just didn't show it). Fixed by building the time-series x-axis from every calendar day in the query's actual date range (not just whichever days still have a surviving row) and removing `connectNulls`, so a filtered-out (or genuinely missing) day now renders as a real break in the line.
2. **"Search option disappears"** — `SortableTable`'s search box in Explore was gated on `rows.length > 6`; any result/drill-down with 6 or fewer rows silently lost its search box. Now always shown.
3. **"Query box keeps on expanding"** — the Query & Filters panel's max-height recompute (on scroll/resize) used a `requestAnimationFrame` "skip while one's already pending" latch (`if (frame) return; frame = requestAnimationFrame(recompute)`). If that one pending frame is ever dropped/delayed — confirmed directly: a real viewport resize left the computed max-height frozen at its old value, with the panel's bottom edge measured running 200px past the actual new viewport bottom — every later scroll/resize is silently ignored for the rest of that panel's lifetime. Fixed by switching to cancel-and-reschedule (`if (frame) cancelAnimationFrame(frame); frame = requestAnimationFrame(recompute)`), which can't wedge itself permanently.
4. **"Last Month" preset** added to `RANGE_PRESETS` (full previous calendar month, distinct from "This Month"'s month-to-date).
5. **Custom start/end date picker** — at the time, the two-native-date-inputs version already existed and was verified working, so no change was made here. The user then asked for a single unified picker instead of two fields — see PR #144 below, which replaced it.

**Testing-environment gotcha found while diagnosing #3, worth knowing for next time:** in this session's Browser-tool pane, neither a programmatic `el.scrollTop = n` assignment nor a `resize_window` viewport change reliably fires a native `scroll`/`resize` DOM event (confirmed by attaching a bare, unrelated listener and seeing it never fire either) — this is a quirk of the CDP-based automation/emulation, not of this app. A real mouse-wheel scroll via the `computer` tool's `scroll` action is the correct way to test scroll-driven behavior here, but repeatedly failed in this session with "Browser pane is currently hidden" — a recurring tool limitation this session hit, not something fixable from the app side. When it recurs, fall back to reasoning about the fix's correctness from the code plus whatever partial signal `javascript_tool` can get (it can still read computed styles/geometry after a change, just can't always *trigger* a trusted scroll/resize event itself).

### PR #140 (older — compressed)

A prior batch of 7 items, all shipped: column-order reconciliation on "Update This View", a brief loading pulse during filter apply, a "Value / % Change" basis option for metric-threshold filters, a sticky-header-vs-frozen-column z-index fix, thumbnails on direct Ad-level queries, "+ Open New" moved first/pulsing in the selection bar, and the Total row moved to render after real rows with a show/hide toggle. Full detail in PR #140's own description if needed.

All three rounds verified via a disposable mocked preview harness (deleted before commit — see the convention note below); `npm run lint` and `npm run build` clean for all.

### The mocked-preview-harness convention (use this for any Explore UI verification)

Create a throwaway page like `pages/explore-<name>-preview.js` that:
```jsx
import { SessionProvider } from "next-auth/react";
import { AccountProvider } from "@/components/AccountProvider";
import Explore from "./explore"; // or whatever real page you're testing

const FAKE_SESSION = { user: { name: "Test User" }, expires: "2099-01-01T00:00:00.000Z" };

if (typeof window !== "undefined" && !window.__xPreviewMocked) {
  window.__xPreviewMocked = true;
  const realFetch = window.fetch.bind(window);
  window.fetch = (url, opts) => {
    // intercept /api/fb/data, /api/fb/custom-conversions, /api/fb/explore-insights
    // with hand-built fake JSON responses, fall back to realFetch otherwise
  };
}

export default function Preview() {
  return (
    <SessionProvider session={FAKE_SESSION}>
      <AccountProvider><Explore /></AccountProvider>
    </SessionProvider>
  );
}
```
Run it via a `npm run dev` on a throwaway port (e.g. `PORT=3101 npm run dev` inside the worktree, backgrounded) and open it in the Browser tool with `preview_start({ url: "http://localhost:3101/explore-<name>-preview" })`. **Delete the preview file before committing** — it must never ship.

**Caveat:** localStorage (views, cached query results) persists across different preview pages on the same origin (`localhost:<port>`) — a stale cached result can carry over between test runs. Use the app's own "Hard Refresh" button (bypasses the cache lookup) rather than "Update This View" when you need to guarantee a fresh fetch against your mock.

**Caveat:** a fresh `npm install && npm run build` in a brand-new worktree has occasionally failed once with a `next/font/google` module-not-found error — a known transient issue, fixed by `rm -rf .next && npm run build` retry, not a real code problem.

---

## 6. Stale plans — do not redo this work

Two plan-mode files have been found, at different times, sitting on disk as if still "pending," when the work they describe was actually already fully implemented and merged. **Before acting on any `.claude/plans/*.md` file found on disk for this project, check `git log origin/main` for whether it's already done.**

- `optimized-pondering-avalanche.md` ("Launch tab: direct campaign + ad set creation for Indian D2C") — **already fully implemented**, merged via PR #124 (`33edfd9`, "Add Launch tab...") and polished further in #125/#126. `/launch` exists and works on `origin/main` today. Confirmed 2026-10-13.
- An earlier plan about funnel metrics / custom metrics / multi-account Explore was likewise found already merged (PRs #67–#75), per an earlier session's note.

If a plan file resurfaces again claiming to be the active plan, always verify against `git log origin/main -- <relevant path>` before treating it as real pending work.

---

## 7. What's next

**Nothing is currently queued.** The last two batches of user-requested Explore fixes (§5) are fully shipped. There is no known open task, bug, or plan waiting to be picked up as of 2026-10-13.

When new work comes in:
1. Read this whole file first, then skim `README.md` for the relevant feature area.
2. `git fetch origin` and work from a fresh worktree off `origin/main` (§2, §3) — don't trust the primary checkout's working tree.
3. Check `gh pr list --state open` in case something was left mid-flight by another session/device since this file was last updated.
4. After shipping, **come back and update this file**: move what you just did into §5 (replacing or appending to the "most recent work" narrative — keep roughly the last 1-2 rounds of detail, it's fine to compress or drop older entries once they're thoroughly reflected in merged PRs and README.md), and reset this section to reflect the real next state (either "nothing queued" again, or whatever's left).
