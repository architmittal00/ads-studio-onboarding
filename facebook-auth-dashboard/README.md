# Facebook Auth Dashboard

A minimal Next.js (Pages Router) dashboard that lets a user log in with Facebook and view their profile, Facebook Pages, and Ad Accounts via the Graph API.

## How it works

- Auth is handled by [NextAuth.js](https://next-auth.js.org/) using the Facebook provider (`pages/api/auth/[...nextauth].js`).
- Login requests `public_profile,email,pages_show_list,pages_read_engagement,ads_read` scopes.
- The Facebook access token is kept server-side in the session JWT, never exposed to the browser.
- After login, the user lands on `/report` — the **Account Handover Report**: a wide dashboard with a sticky section nav (scroll-spy), sortable scroll-capped tables, and a campaign → ad set → ad drill-down. Covers last-30-day spend/purchases/ROAS/CTR/CVR, best week/month by ROAS, top spending campaigns (click to jump into the structure drill-down), the ads driving 80% of purchase revenue, pixel health, full account structure, high-frequency ads outside retargeting, and two CBO/ABO-aware sections:
  - **Budget utilization** — CBO campaigns judged at the campaign level; ABO campaigns judged ad set by ad set, since that's where the budget actually lives.
  - **Creative count recommendations** — flags campaigns/ad sets spending more per creative than the account's own average spend-per-creative (last 30 days), and estimates how many more creatives they need to get back in line.
- `/dashboard` ("Raw Data") shows the raw profile/Pages/Ad Accounts payload plus a manual per-account 30-day ROAS check.
- `/logs` shows the most recent Graph API calls (method, path, status, duration, full request/response) for debugging — see "API logging" below.
- `pages/api/fb/data.js` calls the Graph API (`/me`, `/me/accounts`, `/me/adaccounts`) for the account picker.
- `pages/api/fb/report.js` builds the handover report from several Graph API insights/campaign/pixel calls.
- `lib/facebookGraph.js` is a shared `graphGet()` helper all routes use — it logs every Graph API call (see below).

## API logging

Every Graph API call made by the server goes through `lib/facebookGraph.js`, which logs the path, status, duration, and a truncated response/error to an in-memory ring buffer (`lib/apiLogger.js`, last ~200 calls). View it at `/logs`.

This is **best-effort only**: Vercel serverless functions have no persistent disk, so the log resets on cold start or redeploy. For a permanent record, use the Vercel dashboard's Function Logs for this project.

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
