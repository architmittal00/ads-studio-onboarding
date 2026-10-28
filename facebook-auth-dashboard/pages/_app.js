import "@/styles/globals.css";
import "@/launch-ad/launch-ad.scoped.css";
import { useEffect } from "react";
import { useRouter } from "next/router";
import Script from "next/script";
import { SessionProvider, useSession } from "next-auth/react";
import { Plus_Jakarta_Sans } from "next/font/google";
import { AccountProvider } from "@/components/AccountProvider";
import ApiLogsFab from "@/components/ApiLogsFab";
import { getThemePreference } from "@/lib/clientStorage";
import { sweepAllKnownCaches } from "@/lib/clientCache";
import { CLARITY_PROJECT_ID, identifyClarityUser } from "@/lib/clarity";
import { initAnalytics, installAutoTracking, identifyUser, resetAnalytics, trackPageview } from "@/lib/analytics";

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

// Several dropdowns in this app (AdSetMultiSelect, PixelSelect, AccountSelect's
// portal mode) render via React's createPortal(..., document.body) to escape
// a scroll-clipping ancestor — they land as DOM SIBLINGS of this file's own
// <main className={plusJakartaSans.variable}> below, not descendants of it,
// so they never inherited --font-studio and fell back to the browser's bare
// default font (visibly serif) instead of this app's real one. Reported by
// the user as the ad-set picker's typography looking "very different."
// `next/font` can't be used in pages/_document.js (Next refuses it outright),
// so <body> itself — an ancestor of every portaled node, since portals still
// land inside <body> in the real DOM regardless of React tree position —
// can't get the font's generated className the normal declarative way either.
// This adds the same class imperatively instead, once, before any portal a
// user interaction could possibly open gets the chance to render; paired
// with the plain `font-family: var(--font-studio), ...` fallback declared on
// `body` in globals.css, this fixes every current and future document.body
// portal at once instead of patching each one's own dropdown individually.
function useBodyFontClass() {
  useEffect(() => {
    document.body.classList.add(plusJakartaSans.variable);
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
    // Housekeeping — not needed for the first paint, so it waits for the browser to be
    // idle (it parses every stored cache entry, which is noticeable on a heavy browser).
    const run = () => sweepAllKnownCaches();
    if (typeof window.requestIdleCallback === "function") {
      const id = window.requestIdleCallback(run, { timeout: 5000 });
      return () => window.cancelIdleCallback?.(id);
    }
    const t = setTimeout(run, 3000);
    return () => clearTimeout(t);
  }, []);
}

// Tags the current Clarity recording with the real logged-in user's email
// (see lib/clarity.js) instead of leaving it an anonymous visitor. Has to
// live inside <SessionProvider> to call useSession() — this file's own App
// component wraps that provider around everything else, so it can't call
// the hook itself.
function ClarityIdentify() {
  const { data: session } = useSession();
  useEffect(() => {
    identifyClarityUser(session?.user?.email);
  }, [session?.user?.email]);
  return null;
}

// PostHog: init once, identify the signed-in user by Facebook id, send a page
// view on first load and every client-side route change, reset on sign-out so
// two people on one device are never merged. See lib/analytics.js.
function Analytics() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const userId = session?.user?.id;
  const email = session?.user?.email;
  const name = session?.user?.name;
  useEffect(() => {
    initAnalytics();
    installAutoTracking();
  }, []);
  useEffect(() => {
    if (userId) identifyUser({ id: userId, email, name });
    else if (status === "unauthenticated") resetAnalytics();
  }, [userId, email, name, status]);
  useEffect(() => {
    trackPageview();
    router.events.on("routeChangeComplete", trackPageview);
    return () => router.events.off("routeChangeComplete", trackPageview);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- subscribe once; router object identity is stable enough for events
  }, []);
  return null;
}

export default function App({
  Component,
  pageProps: { session, ...pageProps },
}) {
  useSyncThemeWithOs();
  useSweepStaleCaches();
  useBodyFontClass();
  return (
    <SessionProvider session={session} refetchOnWindowFocus={false}>
      {CLARITY_PROJECT_ID && (
        <Script
          id="clarity-init"
          strategy="afterInteractive"
          dangerouslySetInnerHTML={{
            __html: `(function(c,l,a,r,i,t,y){
              c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
              t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
              y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
            })(window, document, "clarity", "script", "${CLARITY_PROJECT_ID}");`,
          }}
        />
      )}
      <ClarityIdentify />
      <Analytics />
      <AccountProvider>
        <main className={plusJakartaSans.variable} style={{ fontFamily: "var(--font-studio)" }}>
          <Component {...pageProps} />
          <ApiLogsFab />
        </main>
      </AccountProvider>
    </SessionProvider>
  );
}
