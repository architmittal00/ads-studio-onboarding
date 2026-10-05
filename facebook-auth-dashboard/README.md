# Facebook Auth Dashboard

A minimal Next.js (Pages Router) dashboard that lets a user log in with Facebook and view their profile, Facebook Pages, and Ad Accounts via the Graph API.

## How it works

- Auth is handled by [NextAuth.js](https://next-auth.js.org/) using the Facebook provider (`pages/api/auth/[...nextauth].js`).
- Login requests `public_profile,email,pages_show_list,pages_read_engagement,ads_read` scopes.
- The Facebook access token is kept server-side in the session JWT, never exposed to the browser.
- `pages/api/fb/data.js` is a server-side API route that calls the Graph API (`/me`, `/me/accounts`, `/me/adaccounts`) and returns the combined result to the dashboard page.

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
