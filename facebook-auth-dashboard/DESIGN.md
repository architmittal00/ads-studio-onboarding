# Design system

The source of truth for how screens in this app look. Read this before building or restyling a component; update it whenever a convention changes. Everything here is derived from `styles/globals.css` (tokens) and `styles/Home.module.css` (components) — if this file and the CSS disagree, the CSS wins and this file is stale.

## Principles

1. **Tokens, never literals.** Colors come from CSS variables in `styles/globals.css`. No hex/`rgb()` in component code (exception: `#fff` on a solid brand-colored fill, and `rgba(0,0,0,.65)` modal scrims).
2. **Translucent surfaces.** Cards/inputs/buttons are tints of the ink color (`rgba(var(--surface-tint-rgb), α)`) over the page background, so one definition works in light and dark.
3. **Reuse before building.** If a shared component exists (list below), use it. Do not restyle a one-off copy.
4. **Light + dark are both first-class.** Theme is `data-theme` on `<html>`; tokens swap, components don't branch.
5. **CSS Modules** (`styles/Home.module.css`, `import styles from "@/styles/Home.module.css"`) for app UI. Inline `style` only for one-off layout (flex gaps, widths), never for colors.

## Tokens (`styles/globals.css`)

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#fbf5f0` | `#0b0b14` | page background |
| `--card` / `--card2` | ink 4% / 7% | white 4% / 7% | surfaces, inputs, hover |
| `--border` / `--border2` | ink 10% / 15% | white 8% / 14% | hairlines / stronger borders |
| `--t1` / `--t2` / `--t3` | ink / 55% / 28% | `#fff` / 55% / 28% | primary / secondary / tertiary text |
| `--purple` (brand) | `#ec7c6f` | `#af46fd` | primary action, selected, focus |
| `--grad` | coral gradient | purple→pink | primary buttons |
| `--green` `--amber` `--red` `--blue` | status colors | | success / warning / error / info |
| `--*-rgb` triplets | | | translucent tints: `rgba(var(--purple-rgb), .12)` |
| `--surface-tint-rgb`, `--bg-rgb` | | | neutral washes / opaque-ish panels |
| `--shadow-sm` / `--shadow-md` | | | floating panels (dropdown, popover) |

Note the brand color is *coral in light, purple in dark* — never hardcode either.

## Typography

Font: Plus Jakarta Sans via `--font-studio` (set on `<body>`; inherit it, don't redeclare). Base 14px.

| Role | Class | Size / weight | Color |
|---|---|---|---|
| Page title | `.h1` | 16 / 800 | `--t1` |
| Section title | `.h2` | 15 / 700 | `--t1` |
| Body / helper | `.sub` | 13 / 400 | `--t2` |
| Micro label | `.muted` | 11 / 600 | `--t3` |
| Table cell | `.table` | 12.5 | `--t1` |
| Table header | `.table th` | 10 / 700, uppercase, .4px | `--t3` |
| Button | `.btnPrimary` 13/700 · `.btnSecondary` 12/700 | | |

Scale in use: 10, 11, 11.5 (tabs), 12, 12.5 (tables), 13, 15, 16. Don't add half-steps beyond these.

## Shape & spacing

- Radii: card **14**, primary button **10**, secondary button/input/select/error **9**, tab group **10** (tab **7**), pill/badge **20**.
- Page: `.page` > `.main` — max-width 800 (wide tools use their own full-width layout), padding `48px 32px`, gap 20. App shell is `Layout` = fixed `Sidebar` + `.appContent`.
- Card padding 20. Common gaps: 6 / 8 / 10 / 14 / 20.

## Components

**Buttons** — `.btnPrimary` (gradient, brand glow, hover .88, disabled .35) for the one main action per surface; `.btnSecondary` (translucent, `--t2` text) for everything else. Small inline actions: `.rowActionBtn`.
**Inputs** — `.select` for `<input>`/`<select>` (9px radius, 4% tint, focus = purple border + 5% purple wash). Account pickers: `AccountSelect` (searchable combobox). Date ranges: `DateRangeMenu`. Interest/targeting/audience pickers: `InterestPicker`, `TargetingSearchPicker`, `CustomAudiencePicker`.
**Tabs / segmented** — `.tabGroup` + `.tab` / `.tabActive` (selected = 15% purple tint, 30% purple border, purple text).
**Badges** — `.pill` (brand), `.badgeInfo` (blue), `.badgeGood` / `.badgeWarn` / `.badgeDanger` (status). 10px/700, 20px radius.
**Messages** — `.error` for failures; warnings/success via the `.badge*` tints. Inline status text uses `--green/--amber/--red`.
**Tables** — `SortableTable` (sort, search, resize, freeze, pinned total row). Don't hand-roll `<table>` styling.
**Overlays** — modal: fixed scrim `rgba(0,0,0,.65)` + blur, `.card` panel, `z-index: 800` (see `RowActions`, `DuplicateEntityModal`). Side drawer: `.drawerOverlay`/`.drawerPanel` (see `EntityDetailDrawer`). Creative preview: `CreativeLightbox`; thumbnails: `Thumb`.
**Loading / empty** — `Loader` (spinner, optional label). Empty state: icon + heading + numbered steps + CTA (`.exploreEmptyState`, see `ExploreEmptyState` in `pages/explore.js`).
**Icons** — `components/icons.js` (own inline SVGs, `size` prop). Add new icons there; don't pull another icon library.
**Query panel pattern** — right-side collapsible "Query & Filters" panel (`.exploreLayout`/`.exploreQueryPanel`) for report-style pages.

## Cloned screens: Launch Ad & Catalog Ads (sr-ads-launch)

These two pages are verbatim clones of `lovebhardwaj-commits/sr-ads-launch` (`launch-ad/`), deliberately kept diffable against that repo so they can be changed one piece at a time. They are wrapped by `launch-ad/components/PageShell.tsx` (our `Layout` + a `.la-root` container). Their CSS is `launch-ad/launch-ad.scoped.css`: every selector prefixed `.la-root`, every variable renamed `--la-*` and mapped onto the tokens above (`--la-coral`→`--purple`, `--la-ink`→`--t1`, `--la-card`→`--card`, …), so colors and light/dark already follow this system. **Anything marked Open in the audit below still uses the clone's own components.**

### Audit: where the clones differ from the rest of the app

Visual primitives were converged in `launch-ad/launch-ad.scoped.css` (blanket token/radius/size fixes plus a final "Design-system convergence" block that restates controls in this app's sizes). **Structural duplicates were not replaced** — swapping them for our shared components changes behaviour/APIs, so each needs its own pass.

| # | Area | Status |
|---|---|---|
| 1 | Colors — hardcoded ok/bad hexes → `--green`/`--red`; `#fff` remains only on solid fills and white product-image backgrounds | **Fixed** |
| 2 | Selected segmented control / catalog tabs → `.tabGroup`/`.tab` look (15% tint, purple text) | **Fixed** |
| 3 | Radii → card 14, button 10, secondary/input/notice 9, badge/chip 20 | **Fixed** |
| 4 | Type scale → page title 16/800, section 15/700, buttons 13/700 · 12/700, badges 10/700; 10.5/13.5 removed | **Fixed** (11.5/12.5 kept — both in our scale) |
| 5 | Primary button → glow, hover .88, disabled .35 | **Fixed** |
| 6 | Secondary button (`.btn-ghost`) → `.btnSecondary` look | **Fixed** |
| 7 | Inputs → `.select` look (padding, 9px, focus wash); fixed 34px height removed | **Fixed** |
| 8 | Notices/badges/chips → `.error`/`.badge*`/`.pill` tints | **Fixed** |
| 9 | Table look → `.table` header/cell/hover values. Still the clone's own `.cat-table`: no sort/resize/freeze/search | Visual fixed; **`SortableTable` swap open** |
| 10 | Spinner/loading → shared `Loader` in the main "Loading" state (button-inline spinners keep the clone's) | **Mostly fixed** |
| 11 | Empty state → icon/heading colors aligned with `.exploreEmptyState`; markup still the clone's | Partly fixed |
| 12 | Page-level ad account picker → shared `AccountSelect` in the `.headerPillRow` (`launch-ad/components/PageHeader.tsx`, mirrors `pages/partnership-ads.js`). In-flow `SearchSelect`s (catalog, page, pixel…) remain the clone's | **Fixed** (header) / Open (in-flow) |
| 13 | Date range → shared `DateRangeMenu` (clone's `DateRange.tsx` deleted) | **Fixed** |
| 19 | Page header + frame: `.h1`/`.sub` title block, labeled pills + refresh button, `.tabGroup`/`.tab`, `.exploreEmptyState` empty state, `.main`-style frame (flex column, gap 20, 48px 32px, max 1500); stat tiles on `.stat*` values | **Fixed** |
| 14 | Pickers — own interest/audience/location pickers vs `InterestPicker`, `TargetingSearchPicker`, `CustomAudiencePicker` | **Open** (duplicates) |
| 15 | Icons — `lucide-react` (12 files) vs `components/icons.js` | **Open** |
| 16 | Page layout — own `.content` (835 / 1320) instead of `.page`/`.main` | **Open** (wizard needs width; decide per screen) |
| 17 | Overlays / z-index (25/30/40/60 vs modals 800) | **Open** — verify |
| 18 | Sticky step bar opaque at `top: 0`; API log removed; light/dark via tokens | **Fixed** |

Remaining order: 14, 12 (in-flow), 9 (replace duplicate components — removes the most code) → 15 → 16, 17.

## Mobile web (phone widths, ≤768px)

Only **Custom Views** (`/explore`) is adapted for phones so far. Mobile is **not the desktop layout squeezed down** — it presents the same data differently. One breakpoint: `MOBILE_MAX_WIDTH = 768` in `lib/useIsMobile.js` (keep CSS `@media (max-width: 768px)` blocks in sync).

**Principles**
- One job per screen region; glanceable first (totals + ranked list), detail on demand (tap).
- **Navigation = fixed bottom tab bar** (`components/MobileTabBar.js`: Views · Partners · Catalog, 56px + safe area). The top bar only carries the screen title, theme and sign-out. Every other fixed-bottom element (bulk bars) sits above it (`bottom: calc(56px + env(safe-area-inset-bottom))`); sheets (z 700) cover it. Screens with their own sub-tabs use a scrollable chip row, not a second bottom bar.
- **Catalog Ads on a phone** (`launch-ad/components/CatalogAdsMobile.tsx`, styles under "Mobile Catalog Ads" in `launch-ad.scoped.css`): one account button + date/refresh row (`.mvHeader`, account list in a sheet), a sticky chip row for Overview · Ads · Sets · **Create ad** (the primary action, gradient chip), Overview as KPI strip + Catalog-vs-Normal head-to-head rows with delta pills, ads and product sets as cards (products open in a sheet, 3-up grid). The Create Ad wizard keeps its steps but collapses the step bar to numbered dots with only the current title, moves the preview into a sheet behind an eye button, and pins the Continue/Launch bar (`.sticky-bar`) above the tab bar with a one-line "Still needed: X +N more". Sticky stack: top bar 52 → chips 55 → wizard step bar at `top: 107px`.
- **App screens share one phone chrome** (`components/mobile/MobileChrome.js`, used by Partnership Ads and Catalog Ads; build new multi-tab screens from it): `MobileContextBar` (account + date line, icon actions beside it) → sheet with `PickerField`s; `MobileChips` sticky tab row; `PickerSheet` for long lists with a pinned search box (only the list scrolls); `PartnershipEmptyState` for "nothing checked yet". On desktop both screens also match: same header (title/sub left, labeled pills + primary action right), tab group, empty state, 30-day default range.
- **Refreshing over existing results:** no full-section scrim (the loader would centre off-screen in a tall list). A sticky pill (`.mvRerunBar`) shows progress and stale rows fade to 45%.
- **Cards, not tables.** A 10-column table can't be read at 375px. Each entity is a card: name (2-line clamp) + status, a 3-column metric grid (first 9 metrics, then "+N more metrics"), compact numbers (`formatMetricValue(..., {compact:true})` → ₹1.2L). The metric you sort by leads the card and is tinted.
- **Sheets, not popovers/modals.** Every "pick one" or "edit settings" interaction is a bottom sheet (`components/BottomSheet.js`): sort, filters, row actions, view switcher, date range. Query & Filters is a full-screen sheet.
- **Thumb-reachable and 44px targets.** Primary actions in a sticky bottom bar (bulk selection); filters/sort/search in a sticky toolbar under the top bar.
- No browser-style tab strip: views are a single switcher button → sheet.

**Structure of Custom Views on a phone**
1. Top bar (52px, `.mobileTopBar`: logo, title, theme, sign out) — replaces the sidebar rail.
2. View switcher (title + "account · level · N metrics") → "Your views" sheet (switch / close / New view).
3. Date range (compact label, bottom sheet) + **Edit** (opens the query sheet).
4. List | Chart, **Filters** (count badge), ⋯ (hard refresh, export CSV); one meta line (range · rows · updated).
5. Sticky toolbar: Search, Sort (sheet; High→Low / Low→High), Select (multi-select mode).
6. Totals as a horizontally scrolling KPI strip; then the card list. Campaign/ad set cards have "View ad sets/ads" that nests child cards inline; time-grouped results have "View day-by-day".
7. Selecting rows shows a sticky bottom bar (Open New / Duplicate / Copy IDs / Clear). Card ⋯ and tapping a card open actions / details.

**Code map:** `components/ExploreMobileList.js` (card list), `components/BottomSheet.js`, `RowActions variant="sheet"`, `DateRangeMenu fullWidth` (+ bottom-sheet popover), mobile branches in `pages/explore.js` (`renderMobileHeader`, `renderMobileResultBar`, `ExploreResultsTable`'s `isMobile` return), CSS in the "Mobile Custom Views" section of `styles/Home.module.css`.

**Gate:** `MOBILE_SUPPORTED_PATHS` in `lib/useIsMobile.js` lists phone-ready screens; `components/Layout.js` shows a "Best on a larger screen" notice for the rest. Form controls are 16px on phones (stops iOS zoom-on-focus); no floating buttons (`ApiLogsFab` hidden); no horizontal page scroll.

**Not yet verified on a real device** — checked in a 375px emulated viewport with mocked data only.

### Partnership Ads on phones

Same rules as Custom Views, applied to a six-tab screen (`pages/partnership-ads.js`, `components/partnership/*`):

- **One context button, not a pill row.** "Ad account · Last 30 days ▾" opens a bottom sheet with Ad Account (+ Business / Instagram on the tabs that need them) and the date range (`PartnershipMobileChrome.js`). Reload and the Ready-to-Launch queue are 44px icon buttons beside it (queue shows a count badge). The h1/intro are hidden.
- **Sub-tabs = sticky scrollable chip row** (`MobileTabChips`, short labels, active chip scrolled into view, still synced to `?tab=`). List toolbars pin *below* it (`top: 96px` via `.pvChipRow ~ …`).
- **Overview = hero ROAS + head-to-head table** (Partnership vs Normal per metric, green/red delta pill, CPA inverted) instead of two stat cards plus six delta cards.
- **My Ads / Creators reuse `ExploreMobileList`** (new props: `selectable`, `kpiKeys`, `toolbarExtra`, `renderLead`); filters live in a sheet; the creator's ads open in a `BottomSheet` (the desktop drawer can't sit above the tab bar from inside `.main`).
- **Explore Ads** = search + Filters sheet and a two-up card grid; the selection bar sits above the tab bar. **Requests** = cards.
- **Modals become bottom sheets** with `pvModalOverlay` / `pvModalCard` / `pvModalMedia` classes (they are inline-styled, so the mobile CSS overrides with `!important`). `.main { z-index: auto }` on phones — its `z-index: 1` stacking context otherwise keeps inline `z-index: 800` modals under the top and tab bars.
- Empty states drop the numbered steps (`.pvEmpty`): the point plus one full-width action.

## Adding or changing a component

1. Check the list above and `components/` for something reusable.
2. Style with tokens + the classes in `Home.module.css`; add new classes there (CSS Modules), not inline colors.
3. Verify in light **and** dark, and at ~800px width.
4. Update this file in the same PR.
