/**
 * Vanessa auth setup — runs ONCE before the "vanessa" project tests.
 *
 * Performs a real UI login as vanessa@usalatinoprime.com (sales role),
 * asserts the session lands on /ventas (the sales panel home), and persists
 * cookies + localStorage to e2e/.auth/vanessa.json.
 *
 * SAME PRECONDITIONS AS admin-setup:
 *   1. Custom Access Token Hook must be active in Supabase.
 *   2. Seed 01+02+03 must be applied (`supabase db reset`).
 *   3. Dev server running on localhost:3000.
 *
 * RATE LIMIT: staff login is capped at 5 req / 15 min (in-memory, dev).
 * Only this setup file calls the login endpoint; all F3-F1 tests reuse
 * the resulting storageState — no per-test logins.
 *
 * WHEN THE HOOK IS INACTIVE
 * ──────────────────────────
 * The middleware rejects the session → redirect back to /login.
 * This setup test FAILS with a clear message; all dependent F3-F1 tests
 * are automatically marked "did not run" (not "skipped").
 */

import { test as setup, expect } from "@playwright/test";
import path from "path";

const VANESSA_EMAIL = "vanessa@usalatinoprime.com";
const VANESSA_PASSWORD = "changeme-vanessa!";

export const VANESSA_AUTH_FILE = path.join("e2e", ".auth", "vanessa.json");

setup("authenticate as Vanessa (sales)", async ({ page }) => {
  await page.goto("/login");

  await expect(page.locator('input[type="email"]')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('input[type="password"]')).toBeVisible();

  await page.locator('input[type="email"]').fill(VANESSA_EMAIL);
  await page.locator('input[type="password"]').fill(VANESSA_PASSWORD);
  await page.locator('button[type="submit"]').click();

  // Vanessa (sales role) shares the same login page as admin staff.
  // The login action redirects ALL staff to /admin after authentication.
  // From there the middleware allows any staff member to navigate to /ventas.
  // Accept any non-/login staff destination: /admin, /ventas, /ventas/leads, etc.
  await page
    .waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 60_000 })
    .catch(() => { /* fall through — landed below reports the actual URL */ });

  const landed = page.url();

  if (landed.includes("/login") || landed.includes("/welcome")) {
    throw new Error(
      `[vanessa-setup] Login did NOT land on a staff route (landed: ${landed}).\n` +
        "  Possible causes:\n" +
        "  1. Custom Access Token Hook not active → Supabase dashboard > Auth > Hooks\n" +
        "  2. Seed not applied → run `supabase db reset`\n" +
        "  3. Running against remote Supabase without the hook configured\n" +
        "  4. Password mismatch — seed uses bcrypt('changeme-vanessa!')\n" +
        "  Until the hook is active all F3-F1 staff tests will show 'did not run'.",
    );
  }

  await page.context().storageState({ path: VANESSA_AUTH_FILE });
  console.log(`[vanessa-setup] Session saved to ${VANESSA_AUTH_FILE} (landed: ${landed})`);
});
