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

These two pages are verbatim clones of `lovebhardwaj-commits/sr-ads-launch` (`launch-ad/`), deliberately kept diffable against that repo so they can be changed one piece at a time. They are wrapped by `launch-ad/components/PageShell.tsx` (our `Layout` + a `.la-root` container). Their CSS is `launch-ad/launch-ad.scoped.css`: every selector prefixed `.la-root`, every variable renamed `--la-*` and mapped onto the tokens above (`--la-coral`→`--purple`, `--la-ink`→`--t1`, `--la-card`→`--card`, …), so colors and light/dark already follow this system. **Anything not listed as "fixed" below still uses the clone's own sizes, radii and components.**

### Audit: where the clones differ from the rest of the app

| # | Area | Clone | App convention | Status |
|---|---|---|---|---|
| 1 | Colors | `--la-*` mapped to tokens ✔; but literal `#fff` ×23, `#111`, `#000`, ok/bad badges hardcode `#2e7d4f`/`#c0392b` | tokens only (`--green`, `--red`) | **Open** (badges) |
| 2 | Selected segmented control | `.seg` solid purple pill (changed on request) | `.tabActive` = purple tint | **Inconsistent** — the Catalog tab bar uses tint while `.seg` is solid; pick one |
| 3 | Radii | cards 12, buttons 8, inputs 7, chips/badges 999 | 14 / 10 / 9 / 20 | Open |
| 4 | Type scale | 10.5 / 11.5 / 12.5 mixed; page title 16/**600**; section title 14/600; button 12.5/600 | 16/800, 15/700, button 13/700 | Open |
| 5 | Primary button | flat gradient, no glow/hover | glow shadow, hover .88 | Open |
| 6 | Secondary button | `.btn-ghost` solid `--card` with `--t1` text | translucent, `--t2` text, hover → `--t1` | Open |
| 7 | Inputs | fixed 34px height, purple border on focus only | 9px/13px padding, purple border **and** 5% wash | Open |
| 8 | Tables | own `.cat-table` (10.5/600/.05em headers, no sort/resize/freeze/search) | `SortableTable` | Open — biggest functional gap |
| 9 | Ad account picker | native `<select>` (`AccountPicker`) | `AccountSelect` (search) | Open |
| 10 | Date range | own `DateRange.tsx` popover (`dr-pop`) | `DateRangeMenu` | Open — duplicate component |
| 11 | Pickers | own interest/audience/location pickers (`AudienceControls`, `Pickers`) | `InterestPicker`, `TargetingSearchPicker`, `CustomAudiencePicker` | Open — duplicates |
| 12 | Icons | `lucide-react` (12 imports) | `components/icons.js` | Open |
| 13 | Loading / empty | own spinner keyframes, own empty-state markup | `Loader`, `.exploreEmptyState` | Open |
| 14 | Messages | `.notice.{ok,warn,bad,info}` | `.error`, `.badge*` | Open |
| 15 | Page layout | own `.content` (max 835 / 1320, own padding), own title classes | `.page`/`.main`, `.h1`/`.sub` | Open |
| 16 | Overlays / z-index | sticky bars 25/30, drawer 40, popover 60 | modals 800 | Open — verify against Sidebar/modals |
| 17 | Sticky step bar | `top: 0` inside our scroll area, opaque `--bg` | — | **Fixed** |
| 18 | API log drawer | removed (we have `/logs`) | — | **Fixed** |
| 19 | Theme | tokens mapped, dark works | — | **Fixed** |

Suggested order when converging: 8, 10, 9, 11 (replace duplicate components — also removes the most code) → 3–7 (restyle primitives in `launch-ad.scoped.css`) → 1, 2, 12–16.

## Adding or changing a component

1. Check the list above and `components/` for something reusable.
2. Style with tokens + the classes in `Home.module.css`; add new classes there (CSS Modules), not inline colors.
3. Verify in light **and** dark, and at ~800px width.
4. Update this file in the same PR.
