# Facebook Auth Dashboard

A minimal Next.js (Pages Router) dashboard that lets a user log in with Facebook and view their profile, Facebook Pages, and Ad Accounts via the Graph API.

## How it works

- Auth is handled by [NextAuth.js](https://next-auth.js.org/) using the Facebook provider (`pages/api/auth/[...nextauth].js`).
- Login requests `public_profile,email,pages_show_list,pages_read_engagement,ads_read,ads_management` scopes. Note: **Page Public Content Access is not an OAuth scope** — it's a Facebook app *Feature*, granted via App Review in the Meta App Dashboard (Settings → App Review → Permissions and Features), not something that can be requested through the login `scope` string.
- The Facebook access token is kept server-side in the session JWT, never exposed to the browser.
- After login, the user lands on `/report` — the **Account Handover Report**: a wide dashboard with a sticky section nav (scroll-spy), sortable scroll-capped and searchable tables (every column header is clickable to sort; long names wrap up to 3 lines and only then ellipsize, with a hover tooltip for the full text), and creative thumbnails wherever an individual ad is shown — click one to open it fullscreen; video ads actually play (direct video `source` URL resolved server-side from the creative's `video_id`), not just a static thumbnail.
  - **Date range**: a selector (Today / Last 7 Days / Last 30 Days / Custom) at the top drives the entire report — overview, top campaigns, pareto, structure, budget/creative recommendations all recompute for whatever's selected. Custom uses two date inputs plus an Apply button (so it doesn't refetch on every keystroke). Best Week/Best Month stay on their own fixed 90-day/6-month lookback regardless, since they're about historical context rather than "the current view" — noted inline so that's not confusing.
  - **Metric drill-down**: click any Overview stat (Spend, Purchases, ROAS, CTR, CVR) to open a trend chart — daily breakdown for ranges up to a month, weekly beyond that — rendered with a small dependency-free SVG line chart (`components/TrendChart.js`), no charting library added.
  - Covers spend/purchases/ROAS/CTR/CVR for the selected range, top spending campaigns with % of total revenue (click a row to jump into the structure drill-down), the ads driving 80% of purchase revenue with % of revenue per ad, pixel health, and high-frequency ads outside retargeting — ad-level tables show each ad's status (Active/Paused/etc.) alongside its thumbnail.
  - Three more "where does 80% of purchase revenue come from" breakdowns, same pattern as the creative-level one: **by age & gender** and **by state** (both via the Graph API's `breakdowns` param — region isn't available for every country), and a full **by creative type** split (Static/Video/Catalog, derived from each ad's creative — a catalog ad is detected via `product_set_id`, not a Facebook breakdown dimension — shown in full rather than cut at 80%, since there are only ever 3 possible groups). Each shows spend, revenue, % of revenue, ROAS, and purchases per group.
  - **Account Structure** is a single Ads-Manager-style indented tree table (campaign → ad set → ad) with a search box (matches at any level; a match on an ancestor shows everything beneath it, a match on a descendant only shows that branch, auto-expanded), Expand All/Collapse All, a sort-by-metric control (Name/Spend/Purchases/ROAS, applied within each level so the hierarchy stays intact), status dots at every level including individual ads, and consistent Spend/Purchases/ROAS/Creatives columns (dashed where not applicable).
  - **Budget Utilization & Creative Count** is one merged, CBO/ABO-aware section with a tab switch (CBO Campaigns / ABO Ad Sets, not stacked) — CBO campaigns judged at the campaign level, ABO campaigns judged ad set by ad set (where the budget actually lives), with Utilization%, current/recommended creative count, and additional-needed all in the same row — sort by whichever metric matters. Creative recommendations benchmark each row's spend-per-creative against the account's own average for the selected range (no arbitrary number).
- `/dashboard` ("Raw Data") shows the raw profile/Pages/Ad Accounts payload plus a manual per-account 30-day ROAS check.
- `/logs` shows the most recent Graph API calls (method, path, status, duration, full request/response) for debugging — see "API logging" below.
- `pages/api/fb/data.js` calls the Graph API (`/me`, `/me/accounts`, `/me/adaccounts`) for the account picker.
- `pages/api/fb/report.js` builds the handover report from several Graph API insights/campaign/pixel calls.
- `lib/facebookGraph.js` is a shared `graphGet()` helper all routes use — it logs every Graph API call (see below).

## API logging

Every Graph API call made by the server goes through `lib/facebookGraph.js`, which logs the path, status, duration, and a truncated response/error to an in-memory ring buffer (`lib/apiLogger.js`, last ~200 calls). View it at `/logs`.

This is **best-effort only**: Vercel serverless functions have no persistent disk, so the log resets on cold start or redeploy. For a permanent record, use the Vercel dashboard's Function Logs for this project.

## Report caching

There are two layers of caching, both 30 minutes, both bypassed by the "Hard Refresh" button:

- **Server-side** (`lib/reportCache.js`): `/api/fb/report` caches its response per (user, ad account, exact date range) in-memory on the server for 30 minutes (same best-effort caveat as the API log — resets on cold start/redeploy).
- **Client-side** (in `pages/report.js`): the browser tab also keeps every report payload it has fetched, keyed by (account, date range), for 30 minutes. This means switching the date range selector — e.g. Last 7 Days → Last 30 Days → back to Last 7 Days — shows the already-fetched data instantly with **no network request at all**, not even a fast cache-hit one. A nice loading spinner shows only while an actual fetch is in flight (first load, a genuinely new range, or past the 30-minute TTL).

## Known Graph API caveats

- **Insights queries can come back asynchronous, with no warning.** For large accounts in particular, Facebook will sometimes decide an `/insights` query (even a plain one with no breakdown) is too expensive to run synchronously and returns `{ report_run_id }` instead of `{ data: [...] }` — this is based on Facebook's own cost estimate for that specific request at that moment, not reliably predictable from the request shape, and is why the region/age-gender breakdowns could come back looking empty even though the account had data (a naive reader of `.data` just sees `undefined`). `lib/facebookGraph.js`'s `graphGetInsights()` wraps every `/insights` call used by the report, detects this, and polls the job (`/<report_run_id>`) until it completes, then fetches `/<report_run_id>/insights` for the real rows — transparent to the rest of the code. `vercel.json` raises `pages/api/fb/report.js`'s function timeout to 30s to leave headroom for this polling.
- **Frequency is per-ad, not comparable across levels.** The High-Frequency Ads section shows each ad's own frequency over the selected range. Facebook deduplicates reach differently at the ad, ad set, and campaign level, so this will not match a campaign- or ad-set-level frequency column in Ads Manager — compare it against Ads Manager's own **per-ad** frequency for the same date range instead.
- **Explicit date ranges, not `date_preset`.** The selected range (Today/Last 7 Days/Last 30 Days/Custom) is always sent as an explicit `since`/`until` pair rather than Facebook's `date_preset` shortcuts, since those can drift by a day from what Ads Manager's date picker shows — and reach-based metrics like frequency aren't additive across days, so even a one-day difference can visibly shift them. "Today" is the one exception that intentionally includes the partial, still-accumulating day — same as every other ad platform's "Today" view.
- **Creative thumbnails are fetched by exact ad ID, not via `/act_x/ads`.** That edge with no filter returns Facebook's default-ordered first N ads — oldest-created first — which for any account with real history is a completely different set from the ads with spend in the report window. `lib`-level code instead batches `?ids=<exact ad ids>&fields=creative{thumbnail_url,image_url}` (chunked by 50) against only the ad IDs actually shown in the report. Some ad formats (e.g. catalog/dynamic creative, Advantage+ flexible ads) still have no single static `thumbnail_url`/`image_url` and fall back to a blank placeholder — that's a real gap in what Facebook exposes for those formats, not a fetch bug.

## Environment variables

Copy `.env.example` to `.env.local` for local development, or set these directly in your Vercel project settings (Production/Preview/Development):

| Variable | Description |
| --- | --- |
| `FACEBOOK_APP_ID` | Facebook App ID (public) |
| `FACEBOOK_APP_SECRET` | Facebook App Secret (keep private — never commit) |
| `NEXTAUTH_SECRET` | Random string used to sign session tokens. Generate with `openssl rand -base64 32` |
| `NEXTAUTH_URL` | The deployed URL (e.g. `https://your-app.vercel.app`). Not required on Vercel in production (auto-detected), but needed for local dev. |

## Facebook App configuration

In the [Meta App Dashboard](https://developers.facebook.com/apps/) → Facebook Login → Settings, add to **Valid OAuth Redirect URIs**:

```
https://<your-vercel-domain>/api/auth/callback/facebook
```

Note: `pages_show_list` and `ads_read` require App Review / Advanced Access for accounts that are not Admins/Developers/Testers of the app.

## Deploy

This project is deployed via Vercel, connected to this GitHub repo/branch. Pushing to the branch triggers a new deployment automatically.
