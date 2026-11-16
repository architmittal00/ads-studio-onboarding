import NextAuth from "next-auth";
import FacebookProvider from "next-auth/providers/facebook";
import GoogleProvider from "next-auth/providers/google";
import { getToken } from "next-auth/jwt";
import { googleAuthActive, googleAuthEverywhere, googleDenialReason } from "@/lib/googleTest";
import { recordIdentityLink } from "@/lib/identityDb";

export const authOptions = {
  providers: [
    FacebookProvider({
      clientId: process.env.FACEBOOK_APP_ID,
      clientSecret: process.env.FACEBOOK_APP_SECRET,
      authorization: {
        params: {
          // instagram_basic: added for Partnership Ads (branded content ads)
          // — reading a Page's linked Instagram Business Account and calling
          // the Content Discovery / Branded Content Permissions APIs needs
          // it. Nothing in Meta's own docs for those two APIs lists an exact
          // minimum scope; this is a best-effort guess, not a confirmed
          // requirement — if either API rejects a call with a permissions
          // error, that's the first thing to revisit.
          //
          // business_management + catalog_management: added for Catalog Ads
          // (lib/catalogAds/). Deliberately NOT requested before now (see
          // pages/api/fb/data.js's own comment on the ad-account `business{}`
          // field) because Meta has no ad-account-→catalog edge at all — the
          // only way to find an account's catalogs is business_management's
          // owned_product_catalogs/client_product_catalogs on its Business,
          // so unlike that field there is no graceful-degradation fallback
          // for Catalog Ads to fall back to without these two scopes.
          // Confirmed with the user before adding: this forces every
          // already-logged-in user to log out/in once to pick up the new
          // scopes, and needs these two permissions' Advanced Access
          // approved on this app's Meta App (or the account to have a role
          // on it) — the user confirmed that's already true.
          scope:
            "public_profile,email,pages_show_list,pages_read_engagement,ads_read,ads_management,instagram_basic,business_management,catalog_management",
        },
      },
    }),
  ],
  callbacks: {
    async jwt({ token, account }) {
      // Persist the Facebook access token on first login
      if (account) {
        token.accessToken = account.access_token;
      }
      return token;
    },
    async session({ session, token }) {
      session.accessToken = token.accessToken;
      // Google sign-in is required for everyone: a session that never signed in with Google (an old Facebook-only one)
      // has no ad access until it does, which also shuts every API route for it.
      if (googleAuthEverywhere()) {
        session.googleRequired = true;
        if (!token.googleEmail) session.accessToken = undefined;
      }
      // Facebook user id (token.sub) — the stable unique-user key for analytics.
      if (session.user) session.user.id = token.fbUserId || token.sub;
      // Google sign-in (see lib/googleTest.js): present once the person has signed in with Google.
      if (token.googleEmail) {
        session.googleEmail = token.googleEmail;
        session.fbConnected = !!token.accessToken;
        session.fbUserId = token.fbUserId || null;
        if (session.user) {
          session.user.fbEmail = token.fbEmail || null;
          session.user.email = token.googleEmail;
          if (token.googleName) session.user.name = token.googleName;
        }
      }
      return session;
    },
  },
};

// Google sign-in, layered on top of the options above. Only when it is active for this request (see
// lib/googleTest.js); otherwise `authOptions` untouched. `existing` is the session's current token: NextAuth starts a
// fresh token on every sign-in, so connecting Facebook after Google would otherwise drop the Google identity, and
// signing in with Google would drop a Facebook connection the person already has.
export function buildAuthOptions(req, existing) {
  if (!googleAuthActive(req)) return authOptions;
  return {
    ...authOptions,
    providers: [...authOptions.providers, GoogleProvider({ clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET })],
    callbacks: {
      ...authOptions.callbacks,
      async signIn({ account, profile }) {
        if (account?.provider === "google") {
          // A refused sign-in returns to the sign-in page with the reason (and the email's domain) instead of a bare "Access Denied".
          const reason = googleDenialReason(profile);
          return reason ? `/?google_denied=${reason}&d=${encodeURIComponent(String(profile?.email || "").split("@")[1] || "")}` : true;
        }
        // Google comes first: a Facebook connection is only accepted on top of a Google sign-in.
        if (account?.provider === "facebook") return !!existing?.googleEmail;
        return true;
      },
      async jwt({ token, account, profile }) {
        if (account?.provider === "google") {
          // A Facebook connection already in this session survives signing in with Google. A session from before Google
          // sign-in existed (Facebook only: no googleSub) keeps its Facebook id and email in `sub` / `email`.
          const legacyFb = existing?.accessToken && !existing.googleSub;
          const next = {
            ...token,
            sub: profile.sub,
            googleSub: profile.sub,
            googleEmail: String(profile.email).toLowerCase(),
            googleName: profile.name || null,
            ...(existing?.accessToken
              ? {
                  accessToken: existing.accessToken,
                  fbUserId: legacyFb ? String(existing.sub) : existing.fbUserId,
                  fbEmail: legacyFb ? existing.email || null : existing.fbEmail,
                }
              : {}),
          };
          if (next.fbUserId) await recordIdentityLink({ googleSub: next.googleSub, googleEmail: next.googleEmail, googleName: next.googleName, fbUserId: next.fbUserId, fbEmail: next.fbEmail, fbName: null });
          return next;
        }
        if (account?.provider === "facebook") {
          const next = {
            ...token,
            accessToken: account.access_token,
            fbUserId: String(account.providerAccountId),
            fbEmail: token.email || null,
            googleSub: existing.googleSub,
            googleEmail: existing.googleEmail,
            googleName: existing.googleName,
          };
          await recordIdentityLink({ googleSub: next.googleSub, googleEmail: next.googleEmail, googleName: next.googleName, fbUserId: next.fbUserId, fbEmail: next.fbEmail, fbName: token.name || null });
          return next;
        }
        return token;
      },
    },
  };
}

export default async function auth(req, res) {
  const existing = googleAuthActive(req) ? await getToken({ req }).catch(() => null) : null;
  return NextAuth(req, res, buildAuthOptions(req, existing));
}
