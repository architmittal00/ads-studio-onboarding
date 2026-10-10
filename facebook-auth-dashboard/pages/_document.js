import { Html, Head, Main, NextScript } from "next/document";

// Light is the default theme (styles/globals.css's bare :root) — this runs
// synchronously, before first paint, so a device set to dark mode (or a
// user who's explicitly picked dark via the Sidebar's theme toggle, see
// lib/clientStorage.js's getThemePreference/setThemePreference) switches to
// the app's dark palette ([data-theme="dark"] in globals.css) without a
// light-then-dark flash. An explicit preference always wins over the OS
// setting; with no preference stored, this falls back to matchMedia exactly
// as before. Kept to one localStorage read + one matchMedia check + one
// attribute write; anything more (e.g. reacting to a live OS theme change)
// lives in pages/_app.js, where React effects are the normal place for it.
// "fb-dashboard:theme" is duplicated from clientStorage.js's THEME_KEY —
// this script runs before any module, including that one, can load.
const THEME_BOOTSTRAP_SCRIPT = `
(function () {
  try {
    var pref = localStorage.getItem("fb-dashboard:theme");
    var dark = pref === "dark" || (pref !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    if (dark) document.documentElement.setAttribute("data-theme", "dark");
  } catch (e) {}
})();
`;

export default function Document() {
  return (
    <Html lang="en">
      <Head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }} />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
