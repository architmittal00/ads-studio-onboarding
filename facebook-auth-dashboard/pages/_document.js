import { Html, Head, Main, NextScript } from "next/document";

// Light is the default theme (styles/globals.css's bare :root) — this runs
// synchronously, before first paint, so a device set to dark mode switches
// to the app's dark palette ([data-theme="dark"] in globals.css) without a
// light-then-dark flash. Kept to one matchMedia check + one attribute write;
// anything more (e.g. reacting to a live OS theme change) lives in
// pages/_app.js, where React effects are the normal place for it.
const THEME_BOOTSTRAP_SCRIPT = `
(function () {
  try {
    if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
      document.documentElement.setAttribute("data-theme", "dark");
    }
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
