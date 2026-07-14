/**
 * Carlos (demo client) auth setup — runs ONCE before the "carlos" project tests (F4 §4.3).
 *
 * Password login as carlos.ramirez.demo@example.com (seed 03 provisions a known
 * bcrypt password — same mechanism as the maria setup; the canonical phone-OTP
 * path is covered by identity unit tests). Carlos owns case U26-000002
 * (asilo, self), which has the published I-589 pdf_automation form.
 *
 * PRECONDITIONS:
 *   1. Custom Access Token Hook active in Supabase.
 *   2. Seed 03 applied (Carlos + case U26-000002 active).
 *   3. Dev server on localhost:3000 (run with AI_E2E_STUB=1 → npm run dev:e2e).
 */

import { test as setup, expect } from "@playwright/test";
import path from "path";

const CARLOS_EMAIL = "carlos.ramirez.demo@example.com";
const CARLOS_PASSWORD = "demo-carlos!";

export const CARLOS_AUTH_FILE = path.join("e2e", ".auth", "carlos.json");

setup("authenticate as Carlos Ramírez (demo client)", async ({ page }) => {
  await page.goto("/login");

  await expect(page.locator('input[type="email"]')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('input[type="password"]')).toBeVisible();

  await page.locator('input[type="email"]').fill(CARLOS_EMAIL);
  await page.locator('input[type="password"]').fill(CARLOS_PASSWORD);
  await page.locator('button[type="submit"]').click();

  await page
    .waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 60_000 })
    .catch(() => { /* fall through — landed below reports the actual URL */ });

  const landed = page.url();

  if (landed.includes("/login") || landed.includes("/welcome")) {
    throw new Error(
      `[carlos-setup] Client login did NOT land on a client route (landed: ${landed}).\n` +
        "  Causes: Custom Access Token Hook inactive, seed 03 not applied, or password\n" +
        "  mismatch (seed uses bcrypt('demo-carlos!')).",
    );
  }

  await page.context().storageState({ path: CARLOS_AUTH_FILE });
  console.log(`[carlos-setup] Session saved to ${CARLOS_AUTH_FILE} (landed: ${landed})`);
});
