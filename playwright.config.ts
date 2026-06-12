import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config — E2E + visual QA (DOC-81 §4/§5, DOC-21 §5).
 *
 * Projects:
 * - mobile: client surface (390x844, matches V2/UI Cliente prototype viewport)
 * - desktop: staff surface + showcase (1440x900)
 *
 * The dev server is started automatically (reused if already running).
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false, // F0: shared dev server + rate-limited auth endpoints
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
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
      testMatch: /.*\.desktop\.spec\.ts/,
    },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000/welcome",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
