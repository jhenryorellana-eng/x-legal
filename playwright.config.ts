import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config — E2E + visual QA (DOC-81 §4/§5, DOC-21 §5).
 *
 * Projects:
 * - mobile         : client surface (390x844, Chromium)
 * - desktop        : staff surface + showcase (1440x900, Desktop Chrome)
 *                    matches *.desktop.spec.ts — explicitly EXCLUDES *.admin.spec.ts
 * - admin-setup    : runs e2e/admin/auth.setup.ts ONCE, saves storageState
 * - admin          : admin panel tests (1440x900); depends on admin-setup,
 *                    starts each test already authenticated via storageState
 *
 * The dev server is started automatically (reused if already running).
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false, // shared dev server + rate-limited auth endpoints
  retries: 0,
  reporter: [["list"]],
  timeout: 60_000,
  use: {
    baseURL: "http://localhost:3000",
    // Target user is Spanish-speaking; without the ulp-locale cookie the app
    // negotiates Accept-Language (DOC-23 §2.1) — en-US default would render EN.
    locale: "es-ES",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    // ── Client surface ───────────────────────────────────────────
    {
      name: "mobile",
      use: {
        ...devices["iPhone 14"],
        // Chromium with mobile emulation (WebKit binaries are not installed;
        // visual parity with the prototype is validated on Chromium anyway)
        browserName: "chromium",
        viewport: { width: 390, height: 844 },
      },
      testMatch: /.*\.mobile\.spec\.ts/,
    },

    // ── Staff surface (non-admin) ────────────────────────────────
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
      // Matches *.desktop.spec.ts but explicitly excludes *.admin.spec.ts
      // (those run under the "admin" project with storageState).
      testMatch: /.*\.desktop\.spec\.ts/,
      testIgnore: /.*\.admin\.spec\.ts/,
    },

    // ── Admin panel — auth setup ─────────────────────────────────
    {
      name: "admin-setup",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
      testMatch: /.*admin[/\\]auth\.setup\.ts/,
    },

    // ── Admin panel — F1 wizard suite ────────────────────────────
    {
      name: "admin",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
        locale: "es-ES",
        // Authenticated session saved by admin-setup.
        storageState: "e2e/.auth/admin.json",
      },
      testMatch: /.*\.admin\.spec\.ts/,
      dependencies: ["admin-setup"],
    },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000/welcome",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
