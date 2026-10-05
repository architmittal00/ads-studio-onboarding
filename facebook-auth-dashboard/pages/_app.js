import "@/styles/globals.css";
import { SessionProvider } from "next-auth/react";
import { Plus_Jakarta_Sans } from "next/font/google";

const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-studio",
});

export default function App({
  Component,
  pageProps: { session, ...pageProps },
}) {
  return (
    <SessionProvider session={session}>
      <main className={plusJakartaSans.variable} style={{ fontFamily: "var(--font-studio)" }}>
        <Component {...pageProps} />
      </main>
    </SessionProvider>
  );
}
