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
          scope: "public_profile,email,pages_show_list,pages_read_engagement,ads_read,ads_management,instagram_basic",
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
