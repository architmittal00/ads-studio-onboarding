# Facebook Auth Dashboard

A minimal Next.js (Pages Router) dashboard that lets a user log in with Facebook and view their profile, Facebook Pages, and Ad Accounts via the Graph API.

## How it works

- Auth is handled by [NextAuth.js](https://next-auth.js.org/) using the Facebook provider (`pages/api/auth/[...nextauth].js`).
- Login requests `public_profile,email,pages_show_list,pages_read_engagement,ads_read` scopes.
- The Facebook access token is kept server-side in the session JWT, never exposed to the browser.
- After login, the user lands on `/report` — the **Account Handover Report**: a wide dashboard with a sticky section nav (scroll-spy), sortable scroll-capped and searchable tables (every column header is clickable to sort; long names wrap up to 3 lines and only then ellipsize, with a hover tooltip for the full text), and creative thumbnails wherever an individual ad is shown — click one to open it fullscreen; video ads actually play (direct video `source` URL resolved server-side from the creative's `video_id`), not just a static thumbnail. Covers last-30-day spend/purchases/ROAS/CTR/CVR, best week/month by ROAS, top spending campaigns with % of total revenue (click a row to jump into the structure drill-down), the ads driving 80% of purchase revenue with % of revenue per ad, pixel health, and high-frequency ads outside retargeting — ad-level tables show each ad's status (Active/Paused/etc.) alongside its thumbnail.
  - **Account Structure** is a single Ads-Manager-style indented tree table (campaign → ad set → ad) with a search box (matches at any level; a match on an ancestor shows everything beneath it, a match on a descendant only shows that branch, auto-expanded), Expand All/Collapse All, a sort-by-metric control (Name/Spend/Purchases/ROAS, applied within each level so the hierarchy stays intact), status dots at every level including individual ads, and consistent Spend/Purchases/ROAS/Creatives columns (dashed where not applicable).
  - **Budget Utilization & Creative Count** is one merged, CBO/ABO-aware section with a tab switch (CBO Campaigns / ABO Ad Sets, not stacked) — CBO campaigns judged at the campaign level, ABO campaigns judged ad set by ad set (where the budget actually lives), with Utilization%, current/recommended creative count, and additional-needed all in the same row — sort by whichever metric matters. Creative recommendations benchmark each row's spend-per-creative against the account's own average (last 30 days, no arbitrary number).
- `/dashboard` ("Raw Data") shows the raw profile/Pages/Ad Accounts payload plus a manual per-account 30-day ROAS check.
- `/logs` shows the most recent Graph API calls (method, path, status, duration, full request/response) for debugging — see "API logging" below.
- `pages/api/fb/data.js` calls the Graph API (`/me`, `/me/accounts`, `/me/adaccounts`) for the account picker.
- `pages/api/fb/report.js` builds the handover report from several Graph API insights/campaign/pixel calls.
- `lib/facebookGraph.js` is a shared `graphGet()` helper all routes use — it logs every Graph API call (see below).

## API logging

Every Graph API call made by the server goes through `lib/facebookGraph.js`, which logs the path, status, duration, and a truncated response/error to an in-memory ring buffer (`lib/apiLogger.js`, last ~200 calls). View it at `/logs`.

This is **best-effort only**: Vercel serverless functions have no persistent disk, so the log resets on cold start or redeploy. For a permanent record, use the Vercel dashboard's Function Logs for this project.

## Report caching

`/api/fb/report` caches its response per (user, ad account) for 30 minutes (`lib/reportCache.js`, same in-memory/best-effort caveat as the API log — resets on cold start/redeploy). Switching accounts or reloading within that window reuses the cached data instantly; the "Hard Refresh" button on `/report` bypasses the cache and re-fetches from the Graph API.

## Known Graph API caveats

- **Frequency is per-ad, not comparable across levels.** The High-Frequency Ads section shows each ad's own frequency over the last 30 days. Facebook deduplicates reach differently at the ad, ad set, and campaign level, so this will not match a campaign- or ad-set-level frequency column in Ads Manager — compare it against Ads Manager's own **per-ad** frequency for the same date range instead.
- **Explicit date ranges, not `date_preset`.** All "last 30 days" / "last 7 days" queries use an explicit `since`/`until` range (shown in the report's header) rather than Facebook's `date_preset` shortcuts, since those can drift by a day from what Ads Manager's date picker shows — and reach-based metrics like frequency aren't additive across days, so even a one-day difference can visibly shift them.
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
