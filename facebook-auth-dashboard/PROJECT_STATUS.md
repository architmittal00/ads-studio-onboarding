# Project Status — Facebook Auth Dashboard

> **Maintenance rule (read this first): keep this file current.** Whoever (human or Claude) finishes a meaningful chunk of work on this repo — a shipped PR, a new finding, a change of plan — must update the **"Most recent work"** and **"What's next"** sections below before ending the session. This file is what lets anyone (any device, any fresh Claude session) pick the project up cold. Stale status here is worse than no status at all, so don't skip the update.
>
> Last updated: **2026-10-16**, by Claude, right after merging PR #199.

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
- **This cuts both ways**, confirmed again during PR #197: a `find`/`grep` run from this checkout can *also* report a file as **missing** when it actually exists on `origin/main` (not just the already-documented "shows as modified when it's actually unchanged" direction) — `components/DateRangeMenu.js` genuinely exists and is a fully-built dual-calendar date-range picker, but checking for it from this checkout (instead of the actual worktree) turned up nothing, very nearly leading to rebuilding a component that was already there. Always run existence checks (`ls`, `find`, `grep`) from inside the actual worktree you're working in, or against `origin/main` directly via `git cat-file -e origin/main:<path>` — never from this checkout, in either direction.

---

## 4. Current state of `origin/main`

Latest commit as of this writing: **`0bc8ab1`** — "Fix double act_ prefix on ad account ids in Partnership Ads Graph calls" (PR #199, merged 2026-10-16).

No open PRs. Everything described below is merged and live.

### Feature inventory (high level — see README.md for depth)

| Route | Feature | Status |
|---|---|---|
| `/` | Facebook OAuth login (NextAuth) | Stable |
| `/report` | **Audit Report** — account handover report: overview + trend drill-down, top campaigns, revenue pareto by creative/age-gender/platform/product/state, account structure tree, budget utilization & creative-count recommendations, pixel health | Stable, mature |
| `/strategy` | **Figure Out Strategy** — recommends one of 8 funnel-shaped campaign strategies from `lib/strategyEngine.js`, with a data-driven "does this account have history" signal | Stable, mature |
| `/launch` | **Launch** — direct, self-serve campaign/ad-set creation (new ad set → new or existing campaign, or duplicate an existing ad set), Indian-D2C defaults throughout, live Meta search-backed location/language/interest pickers | **Shipped** (PR #124–126 and others) — see §6, this was a full plan that is now fully implemented, not pending |
| `/recent-changes` | **Recent Changes** — single page (see §5, PR #191: the two previously-separate Recent Changes pages were consolidated into one, the old flat-change-list implementation deleted entirely). Multi-tab (own account/24h-72h-7d window/search/status-filter per tab) with a right-side collapsible Accounts/Time Window panel, six tracked actions rolled up to Campaign/Ad Set (ad activity + an ad set's own budget change → the ad set; an ad set paused + a campaign's own budget/pause → the campaign), landing view lists affected entities sorted by last-change day then ROAS impact (worst movers first), with a name/campaign search filter, an Active/Inactive status filter, copy-ID buttons, and a performance-since-last-change quick signal (Spend/Purchases/ROAS, scaling N days before vs. N days since based on how long ago the change happened, fetched progressively after the list renders, all fetches timeout-guarded); opening one (fixed, non-scrolling header; 805px wide) groups its changes by day with per-day action-type filter tabs + ad thumbnails for "Investigate" (before/after-grouped 6-window comparison, correct best/worst highlighting across every comparable column including partial "after" windows, a "Changed This Day" ad filter + per-row Launched/Paused badges, status badges, copy-ID buttons, and per-ad row actions — View Details/Pause-Activate/Duplicate, reusing Explore's own components) | **Shipped** (PR #171, #175, #177, #179, #183, #185, #187, #189, #191, #193, #195) — see §5; #185's timeout fix needs live re-check, §7 item 1 |
| `/explore` | **Custom Views (Explore)** — build-your-own report: pick account(s)/level/breakdown/metrics/date-range, multi-tab views + tab groups, drill-down (Campaign→AdSet→Ad), charting with axis customization, custom ratio metrics, name/ID filters, result filters (value or %-change), Total row, CSV export, a Meta-Ads-Manager-style date range/compare picker, row actions (pause/activate/change budget/duplicate — the last via its own in-page popup, not a navigation) | **Most actively developed area right now** — see §5 for the latest round |
| `/dashboard` | Raw Data — raw profile/Pages/Ad Accounts payload + manual ROAS check | Stable, simple |
| `/logs` | API Logs — recent Graph API call log (method/path/status/duration) | Stable, simple |
| `/partnership-ads` | **Partnership Ads** — new, in progress (see §5, PR #197). Replicates a static mockup (`dark-theme/partnership-ads.html` + `ready-to-launch.html`) with real Meta API calls: browse a Business's partner-eligible Instagram content (Content Discovery API), request branded-content permission from creators, launch real ads from it. 6 sub-nav tabs sharing one Ad Account + Instagram Business Account selection; **Overview** (live Partnership vs. Normal Ads comparison) and **Explore Ads** (the masonry content-discovery grid) are built; My Partnership Ads/Creator Hub/My Requests/Partnership Code are "coming in a follow-up update" placeholders | **In progress** — foundation shipped (PR #197), see §7 for what's next and the real-account checks still needed |

---

## 5. Most recent work (2026-10-16)

### PR #197 — Partnership Ads foundation: IG account linkage, Explore Ads grid, Overview

A brand-new feature, not a round of fixes on an existing one: **Partnership Ads** (branded content ads) — replicating a static mockup (`dark-theme/partnership-ads.html`, 2798 lines, plus its downstream launch screen `ready-to-launch.html`, 933 lines) with real Meta Marketing API calls, at the user's explicit "everything at once" scope. Full plan saved at `.claude/plans/optimized-pondering-avalanche.md` — this PR is the first of several; see §7 for what's next.

**Follow-up fix, PR #199**: the very first real-account test hit `Object with ID 'act_act_<number>' does not exist` — every new Graph call below built its path as `/act_${accountId}/...`, but `accountId` already carries its own `act_` prefix throughout this app (same convention as `pages/api/fb/adsets-list.js`'s `/${accountId}/adsets`). Fixed across `lib/partnershipAds.js`, `lib/partnershipDetection.js`, and both `pages/api/fb/partnership/*` routes that hit an ad-account-scoped endpoint, with the convention now spelled out in `lib/partnershipAds.js`'s own file header so it doesn't get reintroduced as later PRs add more endpoints (the launch flow in particular will add several more `act_`-scoped calls).

What shipped this round:
1. **Instagram Business Account linkage** — `pages/api/fb/data.js` now fetches each Page's `instagram_business_account{id,username,profile_picture_url}` and each ad account's owning `business{id,name}` (the Content Discovery API below is keyed by Business id, not ad account id). `AccountProvider` derives `igAccounts` from Pages that actually have one linked (most won't — a normal, handled state, not an error) and exposes `selectedIgAccountId`/`setSelectedIgAccountId` the same way `selectedAccountId` already works, with a `getLastIgAccountId`/`setLastIgAccountId` convenience default in `lib/clientStorage.js`.
2. **New OAuth scope** (`instagram_basic`) added to `pages/api/auth/[...nextauth].js` — a best-effort guess, since neither the Content Discovery API nor the Branded Content Ad Permissions API documents an exact minimum scope anywhere in the reference material this was built from. Users need to sign out/in once to pick it up.
3. **`lib/partnershipAds.js`** — every Partnership Ads Graph call this app makes, modeled on Meta's own reference implementation (`Facebook Curls/partnership_ads_booster.py`, a raw-`requests` Python script, not the `facebook_business` SDK) rather than guessed: Content Discovery (`listPermissions`, `requestPermission`, `discoverContent`, `lookupContent`), and the ad-creation chain (`registerVideoSource`, `createBrandedCreative`, `createAd`) for a later PR.
4. **`lib/partnershipDetection.js`** — finds which of an ad account's *existing* ads are partnership ads by reading back `facebook_branded_content`/`instagram_branded_content`/`branded_content` on each ad's creative — the same fields the (not-yet-shipped) creation call writes. This is a live Graph check, not a locally-tracked "ads we created" log, specifically so ads created manually in Ads Manager show up too once "My Partnership Ads" ships — **unverified against a real account yet**, flagged in the plan and in §7.
5. **New `/partnership-ads` page** — 6 sub-nav tabs (Overview, My Partnership Ads, Creator Hub, Explore Ads, My Requests, Partnership Code) sharing one Ad Account + Instagram Business Account selection above them. **Overview** (new `pages/api/fb/partnership/overview.js`) shows a live last-30-days Partnership vs. Normal Ads comparison (two rollup cards + 6 %-delta cards), computed via account-level Insights calls filtered by `ad.id IN/NOT_IN` the detected partnership-ad id list — correctly deduplicated Reach/Frequency, not a naive per-ad sum. **Explore Ads** (new `pages/api/fb/partnership/content.js`, `components/partnership/ExploreTab.js`/`PartnerCard.js`/`ExpandedCardModal.js`) is the masonry content-discovery grid — CSS-columns layout (new, no existing masonry precedent in this app), Media/Usage/Eligibility/Sort filters (native `<select>`, no bespoke dropdown component), search, the **existing** `components/DateRangeMenu.js` reused as-is for the date range (a dual-calendar picker that already existed in this repo — initially missed in research, since a stale primary-checkout check wrongly suggested it didn't exist; verifying against the actual worktree found it), and a read-only expanded-card detail modal. The other 4 tabs are "coming in a follow-up update" placeholders — permission requests, the launch flow, My Partnership Ads, and Creator Hub ship in later PRs.
6. **Known limitation, not a bug**: the Content Discovery API returns no media URL at all — only a public `permalink` (confirmed against the reference implementation, which never requests a media-url field). Cards show a placeholder media block (with a play/photo icon) plus a "View post ↗" link to the real content, rather than faking a thumbnail that would just 404.

Caught and fixed a real bug during verification: `PartnerCard` was a `<button>` containing a nested `<button>` ("Details") and `<a>` ("View post") — invalid HTML, the exact same class of bug fixed in PR #195's `EntityRow` just one round earlier in this project. Converted to `div[role="button"]` with Enter/Space keyboard support, same fix pattern.

Verified via the mocked-preview-harness convention: account/IG-account auto-seeding, Overview's comparison + delta cards, Explore's filters/search/"Load more" pagination, and the expanded-card modal's badge states (Recommended/Launch Ready/Permission Requested/Need Permission). `npm run lint && npm run build` clean.

### PR #195 — Investigate tab round 2: scaling impact window, copy IDs, sort, paused-ad badges, layout fixes

A second screenshot-driven round, nine more asks on the same Investigate/Recent-Changes flow:

1. **Fixed a real "loading forever" risk**: neither the landing page's quick-signal fetch nor the Investigate drill-down's own fetches had a client-side timeout — a connection that never responded had no upper bound. New `fetchWithTimeout` (AbortController-based) in `lib/fetchJson.js`, applied to every fetch in this feature.
2. **Impact window now scales with elapsed time** instead of a fixed 1-day-before/1-day-after: `lib/recentChangesImpact.js`'s `impactWindowFor` compares N days before vs. N days since, N being how many days have actually passed since the change (2 days elapsed → 2-day windows both sides), labeled on each row ("2d before vs 2d since"). Only a same-day change is still "too recent."
3. **Copy-ID buttons** — promoted `pages/explore.js`'s own local `CopyIdButton` to a shared `components/CopyIdButton.js`; added to landing rows, the entity drawer header, and every ad/ad-set row in the drill-down.
4. **Landing-page sort**: entities now sort by last-change day (most recent first), then by ROAS impact ascending within the same day (worst movers first).
5. **Paused ads were invisible next to launched ones**: `EntityDrillDown` only ever tracked "launched" ads. Generalized to a combined "Changed This Day" filter plus a Launched/Paused badge per row, independent of the filter — zero backend change needed (the launched/paused ad ids come from changes already fetched).
6. **Drawer width** reduced to 70% (1150px → 805px).
7. **Fixed the Active/Inactive filter rendering dead-center** on the landing page — an artifact of `justify-content: space-between` with exactly 3 flex children (search box, filter, Hard Refresh). Now sits beside the search box; Hard Refresh pushed right via `margin-left: auto`.
8. **Fixed a real conditional-formatting bug** (this is the actual gap PR #193 looked for and didn't find): `WindowComparisonTable`'s best/worst highlighting excluded every `partial` window from consideration — and every "after" window (Since Change, N Days Post Change) is partial until fully elapsed, so in practice only "before" columns could ever be crowned best/worst. Partial windows are valid for rate metrics (ROAS, CPR, …) since a ratio isn't biased by a shorter sample the way an additive sum is; only windows that literally overlap the change are still excluded now.
9. **Drawer header no longer scrolls away** — split into a fixed header and an independently-scrolling body.

Caught and fixed a real bug introduced along the way during verification: the landing row's new copy-ID button nested a `<button>` inside the row's own `<button>` (invalid HTML, a real React hydration error) — converted the row to a `div[role="button"]` with Enter/Space keyboard support instead of a plain `<button>`.

Verified end-to-end via the mocked-preview-harness convention: window-scaling labels at 1d/2d, the compound day+ROAS sort order, the Launched/Paused badges and filter, the drawer's 805px width and sticky header (confirmed via direct DOM measurement — header stayed at `top: 0` after scrolling the body), and `WindowComparisonTable` highlighting an "after" column (Since Change) green for the first time. `npm run lint && npm run build` clean.

### Earlier rounds (compressed)

- **PR #193**: Removed the now-redundant "Last 3 Days"/"Last 7 Days" windows (down to 6); fixed `EntityDrillDown`'s "Highest Spend"/"Highest Performer" ranking still using a pre-PR-#187 window (now matches the per-row comparison table); fixed a duplicate entity name in the drawer header; added a "launched this day" ad filter (superseded by PR #195's "Changed This Day," above); added status badges everywhere relevant (new shared `humanizeStatus()` in `lib/insightsMetrics.js`); added row actions (View Details/Pause-Activate/Duplicate) on ad/ad-set rows reusing Explore's own components; added the Active/Inactive filter facet. `.drawerPanel` width reduced 1300px → 1150px (later reduced again to 805px by PR #195).

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

**Partnership Ads (PR #197) — the active feature, several PRs still queued:**
1. **Next PRs, in order** (per the saved plan at `.claude/plans/optimized-pondering-avalanche.md`): (a) permission request flows (single + bulk) + My Requests tab; (b) Partnership Code (single + CSV) + the launch queue + the 3-step launch wizard + real ad creation (`pages/api/fb/partnership/launch.js` — the first PR in this whole app to create real `ad`/`adcreative` objects, not just campaigns/ad sets); (c) My Partnership Ads + Creator Hub.
2. **Live-account verification needed before PR 1's own foundation is fully trusted** — none of this could be checked against a real account from here: (a) sign out/in to pick up the new `instagram_basic` scope, confirm the Instagram Business Account picker actually finds a linked account; (b) confirm the Explore Ads grid loads real content now that PR #199 fixed the `act_act_<number>` 400 the very first live test hit — still depends on the Business having the Content Discovery API's `pa_content_discovery_api` gatekeeper flag enabled (the user says they already use Partnership Ads manually, so likely fine, but unconfirmed against this exact endpoint); (c) once "My Partnership Ads" ships, confirm `facebook_branded_content`/`instagram_branded_content`/`branded_content` actually read back non-null on an ad's creative — `lib/partnershipDetection.js`'s whole mechanism depends on this and the reference material only ever writes these fields, never reads them back.
3. **PR #185's `/recent-changes` timeout fix needs a live re-check** — I diagnosed and fixed the missing `limit` param from code reading alone (couldn't reproduce the original 504 in a mocked harness, no account with that much activity volume available in testing). Please re-run "Last 7 Days" on the account from the original report and confirm it completes without `FUNCTION_INVOCATION_TIMEOUT`.
4. PR #163's Ad-level + time-grouping fix (raising the async-job poll timeout to 45s for that one heavy shape) couldn't be exercised from a mocked preview — needs a real check against a live, large ad account (many active ads, 90-day daily grouping) to confirm the longer timeout actually resolves the failure rather than just delaying it.
5. The "no weekly/monthly/daily data at account level" report (see §5, PR #167) couldn't be reproduced against current `origin/main` code via a mocked preview — needs the reporter to describe the actual symptom (error message text, blank table, missing column, etc.) against a live account so this can be properly diagnosed. Don't re-guess at a fix without that information first.
6. **PR #195's scaled impact window and Launched/Paused badges need a live spot-check** — the day-count math (N days before vs. N days since) and the badge-to-change matching were only verified against hand-built mock data; please confirm the numbers and badges look right for a few real changes 1-7 days old on an actual account.

(The old `/recent-changes` page's `CAMPAIGN_GROUP`-dropping bug flagged here previously is no longer an open item — see the PR #173+#175 entry above: the affected file was deleted outright in PR #191's consolidation, so there's nothing left to fix. The `investigate` "after" columns Graph error flagged here even earlier is **resolved** — see PR #183: `time_range` was being sent with extra, Facebook-rejected keys.)

Everything else in §5 is fully shipped and verified as of 2026-10-16, except Partnership Ads, which is deliberately mid-rollout (item 1 above).

When new work comes in:
1. Read this whole file first, then skim `README.md` for the relevant feature area.
2. `git fetch origin` and work from a fresh worktree off `origin/main` (§2, §3) — don't trust the primary checkout's working tree.
3. Check `gh pr list --state open` in case something was left mid-flight by another session/device since this file was last updated.
4. After shipping, **come back and update this file**: move what you just did into §5 (replacing or appending to the "most recent work" narrative — keep roughly the last 1-2 rounds of detail, it's fine to compress or drop older entries once they're thoroughly reflected in merged PRs and README.md), and reset this section to reflect the real next state (either "nothing queued" again, or whatever's left).
