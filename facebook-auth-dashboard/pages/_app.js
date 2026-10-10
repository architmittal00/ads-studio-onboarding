import "@/styles/globals.css";
import { useEffect } from "react";
import { SessionProvider } from "next-auth/react";
import { Plus_Jakarta_Sans } from "next/font/google";
import { AccountProvider } from "@/components/AccountProvider";

const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-studio",
});

// pages/_document.js's inline script sets the initial theme once, before
// paint, from a single matchMedia check — it can't react to the device's
// preference changing *while the app is open* (e.g. an OS's scheduled
// light/dark switch). This keeps the open app in sync with that, same
// default-light/OS-dark-override rule.
function useSyncThemeWithOs() {
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    function apply(isDark) {
      if (isDark) {
        document.documentElement.setAttribute("data-theme", "dark");
      } else {
        document.documentElement.removeAttribute("data-theme");
      }
    }
    function handleChange(e) {
      apply(e.matches);
    }
    apply(media.matches);
    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }, []);
}

export default function App({
  Component,
  pageProps: { session, ...pageProps },
}) {
  useSyncThemeWithOs();
  return (
    <SessionProvider session={session}>
      <AccountProvider>
        <main className={plusJakartaSans.variable} style={{ fontFamily: "var(--font-studio)" }}>
          <Component {...pageProps} />
        </main>
      </AccountProvider>
    </SessionProvider>
  );
}
