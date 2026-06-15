/**
 * Diana auth setup — runs ONCE before the "diana" project tests (F4 §4.3).
 *
 * Real UI login as diana@usalatinoprime.com (paralegal role); persists the
 * session to e2e/.auth/diana.json. Diana is the assigned paralegal of the demo
 * cases (seed 03), so she can approve form responses and generate PDFs.
 *
 * PRECONDITIONS (same as all staff setups):
 *   1. Custom Access Token Hook active in Supabase.
 *   2. Seed 01+03 applied.
 *   3. Dev server on localhost:3000 (run with AI_E2E_STUB=1 → npm run dev:e2e).
 */

import { test as setup, expect } from "@playwright/test";
import path from "path";

const DIANA_EMAIL = "diana@usalatinoprime.com";
const DIANA_PASSWORD = "changeme-diana!";

export const DIANA_AUTH_FILE = path.join("e2e", ".auth", "diana.json");

setup("authenticate as Diana (paralegal)", async ({ page }) => {
  await page.goto("/login");

  await expect(page.locator('input[type="email"]')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('input[type="password"]')).toBeVisible();

  await page.locator('input[type="email"]').fill(DIANA_EMAIL);
  await page.locator('input[type="password"]').fill(DIANA_PASSWORD);
  await page.locator('button[type="submit"]').click();

  await page
    .waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 60_000 })
    .catch(() => { /* fall through — landed below reports the actual URL */ });

  const landed = page.url();

  if (landed.includes("/login") || landed.includes("/welcome")) {
    throw new Error(
      `[diana-setup] Login did NOT land on a staff route (landed: ${landed}).\n` +
        "  Causes: Custom Access Token Hook inactive, seed not applied, or password mismatch\n" +
        "  (seed uses bcrypt('changeme-diana!')).",
    );
  }

  await page.context().storageState({ path: DIANA_AUTH_FILE });
  console.log(`[diana-setup] Session saved to ${DIANA_AUTH_FILE} (landed: ${landed})`);
});
