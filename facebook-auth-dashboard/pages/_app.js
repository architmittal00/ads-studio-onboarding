import "@/styles/globals.css";
import { useEffect } from "react";
import { SessionProvider } from "next-auth/react";
import { Plus_Jakarta_Sans } from "next/font/google";
import { AccountProvider } from "@/components/AccountProvider";
import ApiLogsFab from "@/components/ApiLogsFab";
import { getThemePreference } from "@/lib/clientStorage";
import { sweepAllKnownCaches } from "@/lib/clientCache";

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

// Runs once per app load (this component doesn't remount between
// client-side route changes, only on a hard reload or first visit) — every
// visitor self-heals their own accumulated localStorage bloat the moment
// this ships, rather than needing to be individually told to run a console
// snippet or clear site data. See lib/clientCache.js's own comment for why
// this has to be a hardcoded list of every cache family rather than each
// page registering itself on import: a per-module registration would only
// ever sweep whichever caches the page someone happened to land on actually
// touches.
function useSweepStaleCaches() {
  useEffect(() => {
    sweepAllKnownCaches();
  }, []);
}

export default function App({
  Component,
  pageProps: { session, ...pageProps },
}) {
  useSyncThemeWithOs();
  useSweepStaleCaches();
  return (
    <SessionProvider session={session}>
      <AccountProvider>
        <main className={plusJakartaSans.variable} style={{ fontFamily: "var(--font-studio)" }}>
          <Component {...pageProps} />
          <ApiLogsFab />
        </main>
      </AccountProvider>
    </SessionProvider>
  );
}
