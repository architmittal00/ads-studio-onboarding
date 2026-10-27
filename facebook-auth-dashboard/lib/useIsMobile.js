import { useSyncExternalStore } from "react";

// Phone-width breakpoint used app-wide for the mobile web experience (kept in
// sync with the `@media (max-width: 768px)` blocks in styles/Home.module.css).
export const MOBILE_MAX_WIDTH = 768;

// Height of the mobile top bar (components/Sidebar.js) — sticky elements that
// pin under it offset by this.
export const MOBILE_TOP_BAR_HEIGHT = 52;

const QUERY = `(max-width: ${MOBILE_MAX_WIDTH}px)`;

function subscribe(onChange) {
  const media = window.matchMedia(QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

// Server render (and the first hydration pass) always reports `false`, so
// markup matches on both sides; the real value takes over right after.
export function useIsMobile() {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false
  );
}

// Screens that have been adapted for phones. Everything else shows a
// "use desktop" notice on a phone-width viewport until it's ported.
export const MOBILE_SUPPORTED_PATHS = ["/explore", "/partnership-ads", "/catalog-ads"];

// Height of the fixed bottom tab bar (components/MobileTabBar.js), excluding
// the device safe-area inset. Fixed bottom bars of other components sit above it.
export const MOBILE_TAB_BAR_HEIGHT = 56;

// Sub-pages count too (e.g. /partnership-ads/queue under /partnership-ads).
export function isMobileSupportedPath(pathname) {
  return MOBILE_SUPPORTED_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
