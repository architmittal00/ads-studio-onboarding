import NextAuth from "next-auth";
import FacebookProvider from "next-auth/providers/facebook";

export const authOptions = {
  providers: [
    FacebookProvider({
      clientId: process.env.FACEBOOK_APP_ID,
      clientSecret: process.env.FACEBOOK_APP_SECRET,
      authorization: {
        params: {
          scope: "public_profile,email,pages_show_list,pages_read_engagement,ads_read,ads_management",
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
