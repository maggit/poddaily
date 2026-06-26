import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      // Test files are type-checked (tsc) + run (vitest) but not lint-gated in the
      // production build — they legitimately use loose types for fakes/spies, like the
      // worker/api tests the web build never lints. Keeps `next build` from failing on them.
      "**/*.test.ts",
      "**/*.test.tsx",
    ],
  },
];

export default eslintConfig;
