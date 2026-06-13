/**
 * María (demo client) auth setup — runs ONCE before F3-F1 client-side tests.
 *
 * SMTP / OTP NOTE — WHY THIS IS NOT AN OTP FLOW
 * ═══════════════════════════════════════════════
 * The canonical client login flow is phone OTP (Supabase Auth with Twilio Verify).
 * SMTP / email OTP for the "magic link" path is also supported in Auth but the SMTP
 * provider is NOT yet configured for this project (pending Henry).  This means any
 * attempt to send an email OTP would silently fail or timeout in the test environment.
 *
 * The seed (03_demo.sql) provisions María with BOTH phone AND email auth, and sets a
 * known bcrypt password (`demo-maria!`) so that password-based login works without
 * any external service.  We use that password here — the same mechanism used for
 * staff users in admin-setup.ts.
 *
 * Unit-level coverage for the OTP flow lives in:
 *   src/backend/modules/identity/__tests__/
 * The E2E test below assumes a pre-authenticated session — identical to the pattern
 * used for the "admin" project (henry) and "vanessa" project (sales).
 *
 * PRECONDITIONS
 * ─────────────
 * 1. Custom Access Token Hook must be active in Supabase (same as all staff setups).
 * 2. Seed 03 applied (`supabase db reset` applies all seeds).
 * 3. Dev server running on localhost:3000.
 * 4. María must have a case (ULP-2026-0001) with status='active' and
 *    assigned_sales_id = Vanessa's user_id (both set by seed 03).
 *
 * LANDING URL
 * ───────────
 * Clients land on /home or /caso/<id> after login — NOT on /login or /admin.
 * We wait for any client route that is NOT /login to indicate success.
 */

import { test as setup, expect } from "@playwright/test";
import path from "path";

const MARIA_EMAIL = "maria.gonzalez.demo@example.com";
const MARIA_PASSWORD = "demo-maria!";

export const MARIA_AUTH_FILE = path.join("e2e", ".auth", "maria.json");

setup("authenticate as María González (demo client)", async ({ page }) => {
  await page.goto("/login");

  await expect(page.locator('input[type="email"]')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('input[type="password"]')).toBeVisible();

  await page.locator('input[type="email"]').fill(MARIA_EMAIL);
  await page.locator('input[type="password"]').fill(MARIA_PASSWORD);
  await page.locator('button[type="submit"]').click();

  // Client lands on /home or /caso/<id> — wait until we leave /login.
  // The middleware for clients redirects to /home (or /email if no session yet).
  // We use a broad "not /login" assertion and give 60s for cold compiles.
  await page
    .waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 60_000 })
    .catch(() => { /* fall through — landed below reports the actual URL */ });

  const landed = page.url();

  if (landed.includes("/login") || landed.includes("/welcome")) {
    throw new Error(
      `[maria-setup] Client login did NOT land on a client route (landed: ${landed}).\n` +
        "  Possible causes:\n" +
        "  1. Custom Access Token Hook not active — client sessions also go through the hook\n" +
        "  2. Seed 03 not applied → run `supabase db reset`\n" +
        "  3. Password mismatch — seed uses bcrypt('demo-maria!')\n" +
        "  Until fixed all F3-F1 client tests will show 'did not run'.",
    );
  }

  await page.context().storageState({ path: MARIA_AUTH_FILE });
  console.log(`[maria-setup] María session saved to ${MARIA_AUTH_FILE} (landed: ${landed})`);
});
