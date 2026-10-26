import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";

const eslintConfig = defineConfig([
  ...nextVitals,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Verbatim clone of sr-ads-launch (see launch-ad/); kept unmodified so it can be diffed against the source repo.
    "launch-ad/**",
    "app/**",
  ]),
]);

export default eslintConfig;
