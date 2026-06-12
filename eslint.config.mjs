import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";
import boundaries from "eslint-plugin-boundaries";

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
    ],
  },
  {
    // Import boundary rules — DOC-21 §2 (the 5 dependency rules, enforced).
    files: ["src/**/*.{ts,tsx}"],
    plugins: { boundaries },
    settings: {
      "import/resolver": {
        typescript: { alwaysTryTypes: true },
      },
      // Side-effect stylesheet imports (e.g. layout importing globals.css) are
      // not architectural dependencies — exclude them from boundary analysis.
      "boundaries/ignore": ["**/*.css"],
      // Order matters: first matching pattern wins (module-pub before module-int).
      "boundaries/elements": [
        { type: "app", pattern: "src/app/**", mode: "full" },
        {
          type: "module-pub",
          pattern: "src/backend/modules/*/(index|actions).ts",
          mode: "full",
        },
        { type: "module-int", pattern: "src/backend/modules/*/**", mode: "full" },
        { type: "platform", pattern: "src/backend/platform/**", mode: "full" },
        { type: "jobs", pattern: "src/backend/jobs/**", mode: "full" },
        { type: "frontend", pattern: "src/frontend/**", mode: "full" },
        { type: "shared", pattern: "src/shared/**", mode: "full" },
        { type: "middleware", pattern: "src/middleware.ts", mode: "full" },
      ],
    },
    rules: {
      "boundaries/element-types": [
        "error",
        {
          default: "disallow",
          rules: [
            // app→app: co-located route files (page.tsx imports ./screen.tsx or ./action.ts)
            // are allowed. Pages MUST NOT import from unrelated routes.
            { from: "app", allow: ["app", "module-pub", "frontend", "shared"] },
            { from: "frontend", allow: ["frontend", "shared"] },
            // module-pub (index.ts / actions.ts) — entry points for each module.
            // May import the module's own internals (module-int) and platform helpers.
            // index.ts may also re-export from other module-pub files within the same module.
            {
              from: "module-pub",
              allow: ["module-int", "platform", "shared", "module-pub"],
            },
            // module-int = domain, service, repository and other internals
            {
              from: "module-int",
              allow: ["module-int", "platform", "shared", "module-pub"],
            },
            { from: "jobs", allow: ["module-pub", "platform", "shared"] },
            { from: "platform", allow: ["platform", "shared"] },
            { from: "shared", allow: ["shared"] },
            // middleware.ts lives at src/ root (Next.js requirement) and acts as surface guard
            { from: "middleware", allow: ["platform", "shared"] },
          ],
        },
      ],
    },
  },
];

export default eslintConfig;
