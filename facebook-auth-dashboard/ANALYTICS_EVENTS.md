# Analytics events (PostHog) — running doc

Source of truth for what we send to PostHog, from which page, and how to find it. **Keep this file updated in the same PR as any change to events** (new `track()` call, new `data-track`, change in `lib/analytics.js`). Code lives in `lib/analytics.js`; `<Analytics />` in `pages/_app.js` starts it.

Last reviewed: 2026-11-05.

## 1. How to read events in PostHog

- **Page** = the `screen` property (the URL path, e.g. `/explore`, `/partnership-ads`). The `tab` property is added when the URL has `?tab=`. `$pathname` / `$current_url` also exist on every event.
- **Unique pair** = `event` + `screen`. For click-driven API events the property `event_key` is that pair pre-joined: `<screen>::<event>`. Break down or filter by it to count one action on one page.
- **User** = Facebook user id + per-browser device id, distinct id `<fbId>:<deviceId>`. Person properties: `fb_user_id`, `device_id`, `email`, `name`. Same person on two browsers = two users; filter by `fb_user_id` to group a whole Facebook login.
- **Device** = every custom event has `device` = `mobile` / `desktop`.
- **Typical queries**
  - "What was clicked on page X?" → events `cta_clicked`, `tab_changed`, `control_changed` where `screen = X`.
  - "Which buttons that hit the API on page X?" → events whose name starts with `click_` where `screen = X`; break down by event name.
  - "Did it work?" → same events, filter `ok = false` or `status >= 400`; `api_error` lists every failed call.
  - "Where do people stall in a flow?" → funnel of the `*_started` events (section 4) then the `click_…` call and its `ok`.
- Nothing is sent unless `NEXT_PUBLIC_POSTHOG_KEY` is set, so local dev and previews send nothing.

## 2. Naming rules

- **Click-to-API events** (automatic): `click_<endpoint>[_<action>]__<control>`
  - `<endpoint>` = path after `/api/` (and `fb/`), slashes → `_`, id-like segments dropped. `/api/fb/entity-action` → `entity_action`.
  - `<action>` = the `action` / `type` / `mode` / `kind` / `op` field of a JSON request body, only when it is a short enum-like word (e.g. `pause`). No other body values are ever read.
  - `<control>` = `data-track-action` on the button, else its safe label (digits stripped), else its component class.
  - Example: `click_entity_action_pause__pause_ad`.
  - So per page one control + endpoint + action = one event name, and different actions never share one.
- **Explicit events** (hand-written): `snake_case`, `<thing>_<past-tense verb>` (`explore_view_added`, `copy_ads_started`). Same name on different pages is fine; on one page, one name = one action.
- Never put ad copy, names, metric values, API responses or tokens in an event or property. Identifiers and counts only.

## 3. Automatic events (every page, no code needed)

| Event | Fires when | Key properties |
|---|---|---|
| `$pageview` | first load and every client-side route change | PostHog standard |
| `cta_clicked` | any button / link / icon button click | `screen`, `kind` (button/link/icon_button), `style` (primary/secondary/other), `label`, `component`, `href`, `in_dialog` |
| `tab_changed` | click on a `role="tab"` (chips, tab groups) | `screen`, `tab`, `label`, `component` |
| `control_changed` | select / checkbox / radio / range / date / file input changes | `screen`, `control`, `type`, `checked` — never the value |
| `search_used` | typing in a search box, debounced 1 s | `screen`, `control`, `query_length` — never the text |
| `form_submitted` | `<form>` submit | `screen`, `form` |
| `dialog_opened` | modal / sheet / drawer / lightbox appears | `screen`, `dialog`, `component` |
| `click_<endpoint>…` | a button/tab click that starts an `/api/*` call within 1.5 s (GET or not); once per endpoint per click | `screen`, `event_key`, `path`, `method`, `action_kind`, `label`, `component`, `in_dialog`, `status`, `ok`, `duration_ms` |
| `api_action` | a non-GET `/api/*` call with no click behind it | `path`, `method`, `status`, `ok`, `duration_ms` |
| `api_error` | any failed (non-2xx / network) `/api/*` call that is a GET or click-driven | `path`, `method`, `status`, `duration_ms` |
| `js_error` | uncaught error / unhandled rejection | `screen`, `message` |
| `text_copied` | copy to clipboard | `screen`, `length` |
| `$pageleave`, `$autocapture`, `$rageclick`, `$dead_click`, `$exception` | PostHog's own | — |

Labels are only taken from short, static-looking text, and never inside tables, cards or list rows (they hold ad/campaign names). A control with no safe label falls back to its component class, so two unlabeled icon buttons in one table that hit the same endpoint with the same action share an event name — give one a `data-track-action` to split them.

## 4. Named events (explicit) and where they fire

| Event | Page(s) (`screen`) | Fires when | Properties |
|---|---|---|---|
| `login_clicked` | `/` | Facebook login button | `screen` |
| `nav_clicked` | all (sidebar on desktop, bottom bar on mobile) | nav item clicked | `item`, `surface` (`sidebar` / `bottom_bar`) |
| `theme_toggled` | all (sidebar) | light/dark toggle | `to` |
| `signed_out` | all (sidebar) | sign out | — |
| `account_switched` | all (account picker) | ad account changed | `account` |
| `date_range_applied` | `/explore`, `/pixel`, `/partnership-ads`, `/copy-ads` | date range menu applied | `preset`, `compare` |
| `explore_query_run` | `/explore`, `/partnership-ads` (Explore tab) | a Custom View query runs | `level`, `metric_count`, `account_count`, `forced` |
| `explore_export_csv` | `/explore`, `/partnership-ads` (Explore tab) | CSV export | `row_count` |
| `explore_view_added` / `explore_view_duplicated` / `explore_view_closed` | `/explore`, `/partnership-ads` (Explore tab) | Custom View tab opened / duplicated / closed | — |
| `explore_bulk_pause` | `/explore` | bulk pause of ads confirmed | `count` |
| `bulk_duplicate_ads_started` | `/explore` (also from row actions) | bulk duplicate confirmed | `ad_count`, `adset_count` |
| `ad_edited` | `/explore` (details drawer) | ad edit saved | `changed` (field names) |
| `explore_adset_edited` | `/explore` (details drawer) | ad set edit saved | `fields` |
| `explore_campaign_edited` | `/explore` (details drawer) | campaign edit saved | `fields` |
| `campaign_budget_mode_switched` | `/explore` (campaign details drawer) | campaign switched between campaign budget and ad set budgets | `to` (`adset` / `campaign`) |
| `partnership_tab_opened` | `/partnership-ads` | tab switched | `tab` |
| `partnership_launch_started` | `/partnership-ads` (Code tab), `/partnership-ads/queue` | partnership launch wizard confirmed | — |
| `copy_ads_started` | `/copy-ads` | copy confirmed | `level` (`ad` / `adset` / `campaign`) |
| `campaign_launch_started` | `/strategy` | launch panel confirmed | — |

All also carry `device`. Where a component is used on more than one page (details drawer, row actions), the `screen` property says which page it fired from.

## 5. What fires on which page (quick map)

Everything in section 3 fires on every page. The `click_…` events depend on which APIs the page calls from a button/tab click; the endpoints each page uses today:

| Page | Named events | API endpoints behind clicks (→ `click_…` events) |
|---|---|---|
| `/` | `login_clicked` | — |
| `/dashboard` | — | `insights`, `account-balances` |
| `/report` | — | `report/headline`, `report/core`, `report/<id>` |
| `/explore` | `explore_*`, `bulk_duplicate_ads_started`, `ad_edited`, `explore_adset_edited`, `explore_campaign_edited`, `campaign_budget_mode_switched`, `date_range_applied` | `explore-insights`, `entity-action`, `entity-action-batch`, `entity-details`, `ad-update`, `adset-update`, `campaign-update`, `campaign-budget-mode`, `duplicate-ad`, `duplicate-campaign`, `launch-campaign`, `ad-thumbnails`, `ad-landing-pages`, `custom-conversions` |
| `/recommendations` | — | `rules/check`, `ad-thumbnails`, `entity-action`, `entity-action-batch` |
| `/recent-changes` | — | `recent-changes`, `recent-changes/impact`, `recent-changes/investigate` |
| `/strategy` | `campaign_launch_started` | `data`, `strategy-signal`, `launch-strategy`, `launch-campaign` |
| `/launch` | — | `campaigns-list`, `adsets-list`, `targeting-data`, `launch-campaign` |
| `/copy-ads` | `copy_ads_started`, `date_range_applied` | `copy-ads/source-ads`, `copy-ads/copy`, `copy-ads/copy-adset`, `copy-ads/copy-campaign`, `campaigns-list`, `adsets-list` |
| `/pixel` | `date_range_applied` | `pixels`, `pixel-events` |
| `/partnership-ads` | `partnership_tab_opened`, `partnership_launch_started`, explore events (Explore tab) | `partnership/overview`, `partnership/mine`, `partnership/content-lookup(-bulk)`, `partnership/request-permission(-bulk)`, `partnership/code-preview`, `partnership/launch` |
| `/partnership-ads/queue` | `partnership_launch_started` | `partnership/launch` |
| `/logs` | — | `logs` |
| `/catalog-ads`, `/launch-ad` | — | — (shell pages) |

The endpoint lists come from a grep of the code and are a guide, not a guarantee: to see what a page really fires, open it with the PostHog key set and watch Live events, or filter `screen = <page>` in PostHog.

## 6. How to add or change tracking

1. **Button that calls an API** — nothing to do; the `click_…` event appears automatically. To choose its name, add `data-track-action="my_action"` to the button. Check the event shows up and the name is not shared with a different action on that page.
2. **Pure UI action with no API call** (open a panel, switch a toggle) — add `data-track="my_event"` plus optional `data-track-foo="bar"` (→ property `foo`). Or call `track("my_event", { small_id_or_count })` from `lib/analytics.js`.
3. **A business moment** (a flow started or finished) — `track("thing_verb", { counts })` at the moment of success.
4. **Hide a label** — add `data-ph-no-label` to the element (or put it inside a table/card).
5. Update sections 4 and 5 of this file, and add a line to the changelog below.

## 7. Known gaps

- Nothing here has been checked in the PostHog dashboard itself; behaviour was verified in a production build with a stubbed `posthog.capture`.
- Calls made by a click handler more than 1.5 s after the click (rare) are not attributed to the click and show up as `api_action` / `api_error`.
- Plain-link clicks never produce `click_…` events (they are navigations); the following page's loads show as `$pageview`.

## Changelog

- **2026-11-10** — Copy Ads result: "Retry failed ads" button re-calls `/api/fb/copy-ads/copy`; tracked automatically as a `click_copy-ads-copy__retry-failed-ads`-style click event (no new named event).
- **2026-11-05** — Added `campaign_budget_mode_switched`.
- **2026-11-04** — Added click-to-API events (`click_<endpoint>[_<action>]__<control>`, `event_key`); created this doc.
- **2026-10-27** — Automatic event coverage (`cta_clicked`, `tab_changed`, `control_changed`, `search_used`, `form_submitted`, `dialog_opened`, `api_action`, `api_error`, `js_error`, `text_copied`); PostHog product analytics (identity, `$pageview`, first named events).
