# Project Status — Facebook Auth Dashboard

> **Maintenance rule (read this first): keep this file current.** Whoever (human or Claude) finishes a meaningful chunk of work on this repo — a shipped PR, a new finding, a change of plan — must update the **"Most recent work"** and **"What's next"** sections below before ending the session. This file is what lets anyone (any device, any fresh Claude session) pick the project up cold. Stale status here is worse than no status at all, so don't skip the update.
>
> Last updated: **2026-10-15**, by Claude, right after merging PR #193.

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

Latest commit as of this writing: **`63bc06b`** — "Investigate tab: row actions, status, launched-ads filter, fixes" (PR #193, merged 2026-10-15).

No open PRs. Everything described below is merged and live.

### Feature inventory (high level — see README.md for depth)

| Route | Feature | Status |
|---|---|---|
| `/` | Facebook OAuth login (NextAuth) | Stable |
| `/report` | **Audit Report** — account handover report: overview + trend drill-down, top campaigns, revenue pareto by creative/age-gender/platform/product/state, account structure tree, budget utilization & creative-count recommendations, pixel health | Stable, mature |
| `/strategy` | **Figure Out Strategy** — recommends one of 8 funnel-shaped campaign strategies from `lib/strategyEngine.js`, with a data-driven "does this account have history" signal | Stable, mature |
| `/launch` | **Launch** — direct, self-serve campaign/ad-set creation (new ad set → new or existing campaign, or duplicate an existing ad set), Indian-D2C defaults throughout, live Meta search-backed location/language/interest pickers | **Shipped** (PR #124–126 and others) — see §6, this was a full plan that is now fully implemented, not pending |
| `/recent-changes` | **Recent Changes** — single page (see §5, PR #191: the two previously-separate Recent Changes pages were consolidated into one, the old flat-change-list implementation deleted entirely). Multi-tab (own account/24h-72h-7d window/search/status-filter per tab) with a right-side collapsible Accounts/Time Window panel, six tracked actions rolled up to Campaign/Ad Set (ad activity + an ad set's own budget change → the ad set; an ad set paused + a campaign's own budget/pause → the campaign), landing view lists affected entities with a name/campaign search filter, an Active/Inactive status filter, and a performance-since-last-change quick signal (Spend/Purchases/ROAS, one day before vs. one day after, fetched progressively after the list renders); opening one groups its changes by day with per-day action-type filter tabs + ad thumbnails for "Investigate" (before/after-grouped 6-window comparison with a "launched this day" ad filter, status badges, and per-ad row actions — View Details/Pause-Activate/Duplicate, reusing Explore's own components) | **Shipped** (PR #171, #175, #177, #179, #183, #185, #187, #189, #191, #193) — see §5; #185's timeout fix needs live re-check, §7 item 1 |
| `/explore` | **Custom Views (Explore)** — build-your-own report: pick account(s)/level/breakdown/metrics/date-range, multi-tab views + tab groups, drill-down (Campaign→AdSet→Ad), charting with axis customization, custom ratio metrics, name/ID filters, result filters (value or %-change), Total row, CSV export, a Meta-Ads-Manager-style date range/compare picker, row actions (pause/activate/change budget/duplicate — the last via its own in-page popup, not a navigation) | **Most actively developed area right now** — see §5 for the latest round |
| `/dashboard` | Raw Data — raw profile/Pages/Ad Accounts payload + manual ROAS check | Stable, simple |
| `/logs` | API Logs — recent Graph API call log (method/path/status/duration) | Stable, simple |

---

## 5. Most recent work (2026-10-15)

### PR #193 — Investigate tab: row actions, status, launched-ads filter, fixes

A screenshot-driven round with eight distinct asks on the Investigate tab (`components/EntityChangesDrawer.js` / `EntityDrillDown.js` / `WindowComparisonTable.js`):

1. **Removed "Last 3 Days"/"Last 7 Days"** from `WindowComparisonTable` entirely (client + server `buildWindows`) — no longer needed, down to 6 windows.
2. **Fixed a real inconsistency**: `EntityDrillDown`'s "Highest Spend"/"Highest Performer" ranking still used the pre-PR-#187 "stop at yesterday, fall back to Last 30 Days" window, while the per-row comparison table had already moved to "always through today." Now they match; the now-unreachable 30-day fallback is gone.
3. **Fixed the duplicate entity name** in the drawer header (shown in "Back to X's changes" *and* the heading right below) — back button is now a plain "Back" in the top row, heading is its own block below.
4. **"Launched this day" ad filter** in `EntityDrillDown` — scoped to the ad ids actually launched as part of the day under investigation.
5. **Status (Active/Paused/...) display** everywhere relevant — landing rows, drawer header, ad/ad-set rows. New shared `humanizeStatus()` in `lib/insightsMetrics.js` (`pages/explore.js` now imports it instead of its own copy). Landing/header status comes from a new batched `effective_status` lookup in `pages/api/fb/recent-changes.js` (same `fetchParents()` helper, not a bulk Insights call); the ad-row status needed **zero backend change** — `explore-insights.js` already injects `status` onto every adset/ad-level row.
6. **Row actions (View Details, Pause/Activate, Duplicate)** on ad/ad-set rows — reuses Explore's `RowActions`/`EntityDetailDrawer` components verbatim; the rows `EntityDrillDown` already fetches already carry every field those components need.
7. **Active/Inactive filter facet** on the landing page, next to search.
8. **Verified, not changed**: best/worst conditional-formatting already applies generically to every comparable metric and already excludes scale-dependent totals — confirmed via mocked preview, no gap found.

Verified end-to-end via the mocked-preview-harness convention, including the full row-action flow (open menu → Pause → confirm → optimistic status update in place → View Details opens the nested detail drawer without closing the parent → Duplicate modal opens). `.drawerPanel` width reduced 1300px → 1150px to match the now-6-column table. `npm run lint && npm run build` clean.

### Earlier rounds (compressed)

- **PR #191**: Consolidated the two separate Recent Changes pages into one at `/recent-changes` — deleted the old flat-change-list page, its own data endpoint, and the now-orphaned `InvestigateDrawer.js`/`FilterDropdown.js`; moved the entity-grouped `/new-recent-changes` implementation into the freed `/recent-changes` name (route, page file, API file). Added a name/campaign search filter (replacing the removed Campaigns dropdown) and performance-since-last-change badges (reusing `lib/recentChangesImpact.js` + `pages/api/fb/recent-changes/impact.js` exactly as the old page did, fetched progressively client-side after the list renders — zero extra Graph calls at list-load time, so it can't reintroduce PR #185's timeout).

- **PR #189**: `WindowComparisonTable.js` was dividing every additive metric (Spend, Purchases) by the window's own day-count before display instead of showing the real aggregated total — fixed by removing the division entirely, matching how every other aggregation in this app works (sum, never average). Also boxed off `EntityChangesDrawer`'s "Changes that day" list in its own `styles.card`, matching the landing page's per-day group styling.
- **PR #187**: "Since Change" now always runs through today (previously stopped at yesterday for an older change) — always flagged `partial`. New "7 Days Post Change" window (`sevenDaysAfter`), same `changeDay+1` to `changeDay+N` shape as the existing "3 Days Post Change." Both post-change windows now show a real, growing partial total capped at today instead of hiding until fully elapsed. `.drawerPanel` widened 1040px → 1300px for the new 8th column.

- **PR #185**: Fixed a real `FUNCTION_INVOCATION_TIMEOUT` on `/new-recent-changes`'s landing fetch: `pages/api/fb/new-recent-changes.js`'s Activity Log call passed no `limit`, so Facebook used its own small default page size, and `graphGetAllPages` walks pagination strictly sequentially — a busy account's 7-day window needed enough round-trips to exceed the 60s `maxDuration`. Fixed with `limit: 500` (same convention as `campaigns-list.js` etc.) — **unverified against a real slow account**, see §7. Also widened the page (`maxWidth` 1000→1400) and restructured each landing-page card so the entity name/parent campaign stack on their own lines instead of competing inline.

- **PR #183**: Fixed the real investigate Graph error (§7 item 4, now resolved): `pages/api/fb/recent-changes/investigate.js` passed each window's *entire* object — including this endpoint's own `overlapsChange`/`partial` bookkeeping flags — straight through as the Graph API's `time_range` param, instead of just `{since, until}`; Facebook rejects any extra key in that param outright (`(#100) Invalid keys "overlapsChange" were found in param "time_range"`, confirmed from the user's own error-cell tooltip text). Fixed by destructuring only `{since, until}`. Also reordered `WindowComparisonTable`'s columns to Last 7 Days → Last 3 Days → Since Change → 3 Days Post Change → 1/3/7 Days Before, and widened `.drawerPanel` (760px → `min(1040px, 96vw)`) so the 7-column table fits without its own horizontal scrollbar.

- **PR #181**: Fixed a *different*, now-superseded-in-understanding bug — `pages/api/fb/recent-changes/investigate.js` had no `vercel.json` `maxDuration` override, so a slow (not per-window-erroring, but outright timed-out) request returned Vercel's own HTML error page instead of JSON, crashing every client's `res.json()` with a cryptic parse error (`"Unexpected token 'A'..."`). Added the missing override, plus a new `lib/fetchJson.js#parseJsonResponse` (reads the body as text, parses manually, surfaces a real message) applied everywhere this endpoint — and the main New Recent Changes query — is called from the client.

- **PR #179**: Follow-up UX pass on `/new-recent-changes` (tabs restyled as proper folder tabs; landing-page layout rebuilt to mirror `/recent-changes`' own right-side collapsible panel + empty state exactly; Investigate CTA recolored to the primary purple; ad thumbnails added to ad-level changes, clickable to the shared `CreativeLightbox`; repeated per-row action badges hidden once a day's filter narrows to one type; `WindowComparisonTable` regrouped into "Before the Change"/"After the Change" with a divider; a failed window now renders a visible "Error" cell instead of disappearing — see §7 item 4). Also fixed a real, independent bug: `EntityDrillDown.js`'s "View Ads" fetch did a plain `res.json()` against `/api/fb/explore-insights`, which has streamed NDJSON unconditionally since PR #163 — this also fixed the same crash in the original `/recent-changes` page's own Investigate drill-down, which shares this component.

- **PR #177**: Multi-tab support for `/new-recent-changes` (own account/time-window/campaign-filter per tab); a new 24-Hour time window; a "filter out campaigns" picker (required attaching `campaignId`/`campaignName` to every Ad Set entity server-side); and, in the *shared* `pages/api/fb/recent-changes/investigate.js`, two window fixes later refined further by PR #179 above: a partial "Since Change" total through today instead of "not enough data" for a very recent change, and a new fixed "3 Days Post Change" window. Drawer got color-coded action badges and a bounded/scrolling per-day change list with action-type filter tabs.

- **PR #173 + #175**: Fixed "ad-level changes don't show up under their Ad Set" — two real bugs: (1) the Activity Log reports `object_type` using Meta's **legacy three-tier names** (`CAMPAIGN_GROUP`=Campaign, `CAMPAIGN`=Ad Set, `ADGROUP`=Ad), which the original mapping didn't recognize, silently dropping real Ad and Campaign activity; (2) a run-status change's `event_type`/`translated_event_type` text is generic at every level ("Ad status updated") and never says "paused"/"activated" — the real direction only lives in `extra_data.new_value`. Verified by replaying the user's own real debug output + a raw `curl` of `/activities` through a standalone copy of the fixed logic. **Flagged at the time but never fixed**: the *original* `pages/api/fb/recent-changes.js`'s own `isCampaignOrAdSet` had the identical `CAMPAIGN_GROUP`-dropping gap — moot now, since PR #191 deleted that entire file; the single remaining `pages/api/fb/recent-changes.js` (the file this PR fixed) is the one actually in production.
- **PR #171**: New `/new-recent-changes` page (nav entry added) — deliberately narrower/differently-designed sibling of the original `/recent-changes` (untouched). Six tracked actions rolled up one level (ad activity + an ad set's own budget change → the ad set; an ad set being paused + a campaign's own budget/pause → the campaign). Landing view lists affected entities (not a raw change list); opening one (`components/EntityChangesDrawer.js`) groups its changes by calendar day, and "Investigate" reuses `WindowComparisonTable`/`EntityDrillDown`/`investigate.js` entirely as-is, including the full Campaign→AdSet→Ad drill-down. Caught and fixed a real crash during mocked-harness testing: closing the drawer mid-investigation then immediately opening a different entity threw, because an effect read `entity.entityId` without guarding against the one-render window where `entity` is already `null` but a sibling reset effect's state update hasn't landed yet.
- **PR #169**: Explore's "View Details" row action (first entry on every row, every level) opens a read-only side drawer — Campaign shows Objective; Ad Set shows Locations/Interests/Age/Gender/Language/Placement; Ad shows Primary Text/Headlines/Descriptions/CTA/live preview. New `lib/entityDetails.js` resolves raw ids to display labels server-side (country codes via `Intl.DisplayNames`, Facebook's numeric locale ids via the existing `adlocale` targeting-search endpoint).
- **PR #167**: Explore's date range cap raised 90 → 365 days (+ a "Last 365 Days" preset); Ad-level queries no longer block their response on Facebook's per-ad creative lookup — metrics render immediately, thumbnails fill in afterward via a new `/api/fb/ad-thumbnails` endpoint. **Also reported but not resolved:** "no weekly/monthly/daily data at account level" — traced end to end, couldn't reproduce against current code in a mocked harness; still needs the reporter to describe the actual live-account symptom, see §7.
- **PR #165**: localStorage had far more `fb-dashboard:cache:*` entries than the open-tab count implied, some days old — `getCachedEntry` only ever treated an expired entry as a read-time miss, never deleted it, and two cache families (`InvestigateDrawer.js`/`EntityDrillDown.js`) had no cap at all. Fixed with active expiry + caps, plus a `sweepAllKnownCaches()` run once per app load from `pages/_app.js` to self-heal every existing user's already-accumulated bloat (50+ users already on the app, no way to reach each one individually).
- **PR #163**: six-item Explore feedback batch — CPP removed from the metric catalog (commented out in `lib/insightsMetrics.js` with restore instructions); Ad-level + Day/Week/Month-on-month grouping's async-job poll timeout raised 15s → 45s for that one heavy shape (`graphGetInsights` now takes an optional per-call `timeoutMs`) — **still not verified against a live large ad account**, see §7; custom ratio metric numerator/denominator became a searchable `MetricSelect` combo box; a contextual loader via NDJSON streaming (`explore-insights.js`, same convention as `launch-campaign.js`); column-drag-to-reorder fixed for drilled-into child rows (`childColOrder`, mirroring `childFrozenKey`); Budget added as a Campaign/Ad Set-level metric.
- **PR #161**: `DateRangeMenu`'s popover was confined to its sticky wrapper's stacking context (`z-index: 4`), losing to the tab strip's own sticky wrapper (`z-index: 5`) regardless of the popover's own `z-index: 50` — most visible when it flipped above its trigger. Fixed via `createPortal` to `document.body`.
- **PR #159**: Date range "Update" wasn't re-running the query (only patched the view's spec); compare's "Custom start date" used a native `<input type="date">`, re-themed to match the main calendar; "Compare to previous period" became a toggle switch; `DuplicateEntityModal` stopped defaulting the destination to wherever the source already lives — every duplicate path now requires an explicit pick.
- **PR #157 / #154–155**: Explore's "Duplicate" row action moved from navigating to `/launch` into an in-place `DuplicateEntityModal` popup (`pages/launch.js`'s now-dead `?duplicateAdId=`/`?duplicateAdsetId=` hand-off removed; its own standalone "Duplicate an Ad Set" entry card is unchanged). A collapsed tab group used to still show its active member tab (fixed to hide every member when collapsed, matching Chrome), the same grouping feature was ported to Recent Changes, and date range + "Compare to previous period" moved out of Explore's collapsible Query panel into the `DateRangeMenu` control.
- **PR #152**: Explore's RowActions gained `Duplicate` on ad/ad-set rows. Duplicating an ad points the new ad at the same creative by id (so a partnership/branded-content ad duplicates correctly for free); duplicating an ad set carries over all of its own ads the same way. Both always create paused.
- **PR #148–150**: "Monthly" time-grouping, a "% Change / Absolute value" comparison toggle, a real Level+"Group by time" pivot table (per-entity aggregation had to move server-side — several metrics' `aggregate()` functions read Facebook's *raw* field names that never reach the client); per-tab persistence of the results table's own sort/search/column-order/frozen-column state; the original Chrome-style tab groups feature.
- **PR #140–146**: column-order reconciliation on re-query, frozen-column/sticky-header z-index and chart `connectNulls` fixes, clickable campaign/ad-set names for expand/collapse, and the Total row rebuilt as a genuinely separate always-visible table.

**Testing-environment gotchas** (still relevant): neither a programmatic `el.scrollTop = n` on `document.body` nor a `resize_window` viewport change reliably fires a native `scroll`/`resize` DOM event in the Browser-tool pane — a CDP-automation quirk, not this app; scroll a plain (non-`body`) element instead. An automated `key: "Enter"` sent in the same batch right after a `type` action can race ahead of React's controlled-input state update — retry with the Enter/blur as its own separate tool call before assuming a commit-on-Enter handler is actually broken. A page gated by `getServerSideProps` (every real route in this app) can't be reached via normal client-side navigation from inside a mocked preview — test each gated page's flow via its *own* dedicated preview wrapper instead of clicking through from one preview into another page. The Browser tool's `left_click` on a ref sometimes auto-scrolls the target into view first, and if that scroll lands on something outside a popover with a capture-phase "close on scroll" listener, the popover closes before the click itself registers — reads exactly like "clicking this button silently does nothing," but verifying via `javascript_tool`'s direct `element.click()` (no scrolling involved) confirms whether the app logic itself is actually fine before assuming it's broken. **New (PR #165):** `read_console_messages` in the Browser pane returns a persistent, never-cleared buffer across reloads/navigations within one tab — an old log line from three reloads ago reappearing is not proof anything just ran again; verify via fresh, uniquely-identifiable state instead (a direct value check, a brand-new never-before-logged string) before trusting console output as "this just happened." Separately, a `pages/_app.js`-level `useEffect` (anything meant to run once per app load, e.g. a startup cache sweep) was observed firing inconsistently under `next dev` + Turbopack's Fast Refresh in this sandboxed test environment — a real navigation/reload sometimes didn't trigger it at all, with no error, while editing the file and letting Fast Refresh hot-swap the module did. A production build (`npm run build && npx next start`) ran it deterministically on every single load. For anything hooked to app-mount timing specifically, verify against a production build, not `next dev`, before concluding the app code itself is broken.

All rounds verified via a disposable mocked preview harness (deleted before commit — see the convention note below); `npm run lint` and `npm run build` clean for all.

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

**Three open items, nothing else queued:**
1. **PR #185's `/recent-changes` timeout fix needs a live re-check** — I diagnosed and fixed the missing `limit` param from code reading alone (couldn't reproduce the original 504 in a mocked harness, no account with that much activity volume available in testing). Please re-run "Last 7 Days" on the account from the original report and confirm it completes without `FUNCTION_INVOCATION_TIMEOUT`.
2. PR #163's Ad-level + time-grouping fix (raising the async-job poll timeout to 45s for that one heavy shape) couldn't be exercised from a mocked preview — needs a real check against a live, large ad account (many active ads, 90-day daily grouping) to confirm the longer timeout actually resolves the failure rather than just delaying it.
3. The "no weekly/monthly/daily data at account level" report (see §5, PR #167) couldn't be reproduced against current `origin/main` code via a mocked preview — needs the reporter to describe the actual symptom (error message text, blank table, missing column, etc.) against a live account so this can be properly diagnosed. Don't re-guess at a fix without that information first.

(The old `/recent-changes` page's `CAMPAIGN_GROUP`-dropping bug flagged here previously is no longer an open item — see the PR #173+#175 entry above: the affected file was deleted outright in PR #191's consolidation, so there's nothing left to fix. The `investigate` "after" columns Graph error flagged here even earlier is **resolved** — see PR #183: `time_range` was being sent with extra, Facebook-rejected keys.)

Everything else in §5 is fully shipped and verified as of 2026-10-15.

When new work comes in:
1. Read this whole file first, then skim `README.md` for the relevant feature area.
2. `git fetch origin` and work from a fresh worktree off `origin/main` (§2, §3) — don't trust the primary checkout's working tree.
3. Check `gh pr list --state open` in case something was left mid-flight by another session/device since this file was last updated.
4. After shipping, **come back and update this file**: move what you just did into §5 (replacing or appending to the "most recent work" narrative — keep roughly the last 1-2 rounds of detail, it's fine to compress or drop older entries once they're thoroughly reflected in merged PRs and README.md), and reset this section to reflect the real next state (either "nothing queued" again, or whatever's left).
