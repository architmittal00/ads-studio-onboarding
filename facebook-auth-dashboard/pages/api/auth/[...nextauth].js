import NextAuth from "next-auth";
import FacebookProvider from "next-auth/providers/facebook";

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
      return session;
    },
  },
};

export default NextAuth(authOptions);
