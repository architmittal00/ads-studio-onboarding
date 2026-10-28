// The session as handed to the browser through getServerSideProps: user + expiry only.
// `accessToken` (the Facebook token) stays server-side. Passing this to
// <SessionProvider session={...}> lets the app start already signed in, with no
// extra /api/auth/session round trip after the page loads.
export function publicSession(session) {
  if (!session) return null;
  const { accessToken, ...rest } = session;
  return JSON.parse(JSON.stringify(rest));
}
