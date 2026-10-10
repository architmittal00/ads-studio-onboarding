import "@/styles/globals.css";
import { useEffect } from "react";
import { SessionProvider } from "next-auth/react";
import { Plus_Jakarta_Sans } from "next/font/google";
import { AccountProvider } from "@/components/AccountProvider";
import { getThemePreference } from "@/lib/clientStorage";

const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-studio",
});

// pages/_document.js's inline script sets the initial theme once, before
// paint, from a stored preference (or a single matchMedia check when there
// isn't one) — it can't react to the device's OS preference changing
// *while the app is open* (e.g. an OS's scheduled light/dark switch). This
// keeps the open app in sync with that, but only when no explicit choice
// has been made via the Sidebar's theme toggle: once someone has picked a
// theme, a background OS change must not silently override it.
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
      if (getThemePreference() == null) apply(e.matches);
    }
    if (getThemePreference() == null) apply(media.matches);
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
