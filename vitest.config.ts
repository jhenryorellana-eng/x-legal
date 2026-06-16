import { defineConfig } from "vitest/config";
import { fileURLToPath } from "url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  // tsconfig sets jsx:"preserve" (Next/SWC handles JSX at build time). Tests run
  // through Vite/oxc, which inherits that and leaves JSX untransformed, failing to
  // parse .tsx modules (e.g. platform/emails react-email templates). Force the
  // automatic React runtime for the test transform only.
  oxc: {
    jsx: {
      runtime: "automatic",
      importSource: "react",
    },
  },
  test: {
    environment: "node",
    include: ["src/**/__tests__/**/*.test.ts", "src/**/*.test.ts"],
    // e2e/ belongs to Playwright (DOC-21 §5)
    exclude: ["e2e/**", "node_modules/**"],
  },
});
