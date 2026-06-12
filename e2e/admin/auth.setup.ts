/**
 * Admin auth setup — runs ONCE before the "admin" project tests.
 *
 * Performs a real UI login as henry@usalatinoprime.com, asserts the session
 * lands on /admin (which requires the Custom Access Token Hook to be active),
 * and persists cookies + localStorage to e2e/.auth/admin.json.
 *
 * Every test in the "admin" project receives this storageState and therefore
 * starts already authenticated — no per-test logins, no rate-limit churn.
 *
 * WHEN THE HOOK IS INACTIVE
 * ─────────────────────────
 * If the middleware rejects the session (no JWT claims) and redirects back to
 * /login, this setup test FAILS with a clear message. Playwright will then
 * automatically skip all tests that depend on the "admin-setup" project.
 *
 * HOW TO ACTIVATE LOCALLY
 * ────────────────────────
 * 1. `supabase start`   — local stack; config.toml enables the Custom Access
 *                         Token Hook automatically.
 * 2. `supabase db reset` — applies the seed (henry user + org + role).
 * 3. Point the dev server at the local Supabase URL and run:
 *      npx playwright test e2e/admin/
 *
 * HOW TO ACTIVATE ON REMOTE DASHBOARD
 * ─────────────────────────────────────
 * Supabase Dashboard → Authentication → Hooks → Custom Access Token Hook:
 * enable the hook and point it at the `custom_access_token` Edge Function.
 */

import { test as setup, expect } from "@playwright/test";
import path from "path";

const ADMIN_EMAIL = "henry@usalatinoprime.com";
const ADMIN_PASSWORD = "changeme-henry!";

// Path is relative to the project root (where playwright.config.ts lives).
export const ADMIN_AUTH_FILE = path.join("e2e", ".auth", "admin.json");

setup("authenticate as admin (henry)", async ({ page }) => {
  await page.goto("/login");

  // Verify the login form rendered correctly before interacting.
  await expect(page.locator('input[type="email"]')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('input[type="password"]')).toBeVisible();

  await page.locator('input[type="email"]').fill(ADMIN_EMAIL);
  await page.locator('input[type="password"]').fill(ADMIN_PASSWORD);
  await page.locator('button[type="submit"]').click();

  // Wait specifically for /admin: the page is ALREADY at /login, so a regex
  // that also matches /login resolves immediately while the server action is
  // still in flight. Cold compiles of /admin + remote Supabase round-trips
  // can take 15-30s on the first hit — wait generously.
  await page
    .waitForURL(/\/admin$/, { timeout: 60_000 })
    .catch(() => {
      /* fall through — `landed` below reports the actual URL */
    });

  const landed = page.url();

  if (!landed.includes("/admin")) {
    throw new Error(
      `[admin-setup] Login did NOT land on /admin (landed: ${landed}).\n` +
        "  Possible causes:\n" +
        "  1. Custom Access Token Hook not active → enable in Supabase dashboard\n" +
        "     Settings → Authentication → Hooks → Custom Access Token Hook\n" +
        "  2. Running against remote Supabase — use `supabase start` for local CI\n" +
        "  3. Seed not applied → run `supabase db reset`\n" +
        "  Until the hook is active all tests in the 'admin' project will be skipped.",
    );
  }

  // Persist the authenticated session for the "admin" project tests.
  await page.context().storageState({ path: ADMIN_AUTH_FILE });

  console.log(`[admin-setup] Session saved to ${ADMIN_AUTH_FILE} (landed: ${landed})`);
});
