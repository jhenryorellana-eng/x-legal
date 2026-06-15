import { defineConfig, devices } from "@playwright/test";
import { loadEnvConfig } from "@next/env";

// Load .env.local into process.env so E2E helpers (e2e/helpers/db.ts) can reach
// NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY for BD assertions.
loadEnvConfig(process.cwd());

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
 * - vanessa-setup  : runs e2e/staff/vanessa-auth.setup.ts ONCE (sales role login)
 * - vanessa        : F3-F1 staff-side tests; depends on vanessa-setup
 *                    storageState: e2e/.auth/vanessa.json
 * - maria-setup    : runs e2e/cliente/maria-auth.setup.ts ONCE (demo client login)
 *                    SMTP/OTP NOTE: uses password auth (seed 03); email OTP not yet
 *                    configured. OTP coverage lives in identity unit tests.
 * - maria          : F3-F1 client-side tests; depends on maria-setup
 *                    storageState: e2e/.auth/maria.json
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

    // ── Vanessa (sales) — F3 Phase F1 staff side ─────────────────
    {
      name: "vanessa-setup",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
      testMatch: /.*staff[/\\]vanessa-auth\.setup\.ts/,
    },
    {
      name: "vanessa",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
        locale: "es-ES",
        storageState: "e2e/.auth/vanessa.json",
      },
      testMatch: /.*\.vanessa\.spec\.ts/,
      dependencies: ["vanessa-setup"],
    },

    // ── María (demo client) — F3 Phase F1 client side ────────────
    // SMTP NOTE: setup uses password login (seed 03 provisions bcrypt password).
    // Email OTP path is covered by unit tests in identity/__tests__.
    {
      name: "maria-setup",
      use: { ...devices["iPhone 14"], browserName: "chromium", viewport: { width: 390, height: 844 } },
      testMatch: /.*cliente[/\\]maria-auth\.setup\.ts/,
    },
    {
      name: "maria",
      use: {
        ...devices["iPhone 14"],
        browserName: "chromium",
        viewport: { width: 390, height: 844 },
        locale: "es-ES",
        storageState: "e2e/.auth/maria.json",
      },
      testMatch: /.*\.maria\.spec\.ts/,
      dependencies: ["maria-setup"],
    },

    // ── Diana (paralegal) — F4 §4.3 staff side ───────────────────
    {
      name: "diana-setup",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
      testMatch: /.*staff[/\\]diana-auth\.setup\.ts/,
    },
    {
      name: "diana",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
        locale: "es-ES",
        storageState: "e2e/.auth/diana.json",
      },
      testMatch: /.*\.diana\.spec\.ts/,
      dependencies: ["diana-setup"],
    },

    // ── Carlos (demo client) — F4 §4.3 client side ───────────────
    {
      name: "carlos-setup",
      use: { ...devices["iPhone 14"], browserName: "chromium", viewport: { width: 390, height: 844 } },
      testMatch: /.*cliente[/\\]carlos-auth\.setup\.ts/,
    },
    {
      name: "carlos",
      use: {
        ...devices["iPhone 14"],
        browserName: "chromium",
        viewport: { width: 390, height: 844 },
        locale: "es-ES",
        storageState: "e2e/.auth/carlos.json",
      },
      testMatch: /.*\.carlos\.spec\.ts/,
      dependencies: ["carlos-setup"],
    },
  ],
  webServer: {
    // dev:e2e sets AI_E2E_STUB=1 → deterministic AI + the QStash test seam
    // (DOC-81 §4.3/§4.6). The stub is inert without the flag and impossible in
    // production. If a dev server is already running, reuseExistingServer keeps
    // it — start it with `npm run dev:e2e` for the §4.3/§4.6 specs.
    command: "npm run dev:e2e",
    // /favicon.ico always returns 200 on the Next.js dev server.
    // reuseExistingServer: true means Playwright will NOT start a new process
    // if this URL already responds — requires a 2xx status to be considered "ready".
    // /welcome and /login render RSC errors (500) during dev so they can't be used here.
    url: "http://localhost:3000/favicon.ico",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
