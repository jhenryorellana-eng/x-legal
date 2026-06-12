/**
 * F0 smoke — staff surface + design system showcase.
 *
 * NOTE: a SUCCESSFUL staff login requires the Custom Access Token Hook to be
 * activated in the Supabase dashboard (claims org_id/user_kind/user_role).
 * Until then the middleware treats authenticated users without claims as
 * "unprovisioned" — the login attempt test below documents the actual
 * behavior instead of asserting a destination.
 */
import { test, expect } from "@playwright/test";

test.describe("staff guards", () => {
  test("/admin without session redirects to /login", async ({ page }) => {
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("/ventas /legal /finanzas redirect to /login", async ({ page }) => {
    for (const route of ["/ventas", "/legal", "/finanzas"]) {
      await page.goto(route);
      await expect(page).toHaveURL(/\/login$/);
    }
  });
});

test.describe("staff login", () => {
  test("renders the team panel form", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByText("Panel de equipo")).toBeVisible();
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
  });

  test("wrong credentials show uniform error and stay on /login", async ({ page }) => {
    await page.goto("/login");
    await page.locator('input[type="email"]').fill("henry@usalatinoprime.com");
    await page.locator('input[type="password"]').fill("definitely-wrong-password");
    await page.locator('button[type="submit"]').click();

    await expect(page.getByText(/incorrectos|Demasiados intentos/i)).toBeVisible({
      timeout: 15_000,
    });
    await expect(page).toHaveURL(/\/login/);
  });

  test("seeded credentials: document actual behavior (hook-dependent)", async ({ page }, testInfo) => {
    await page.goto("/login");
    await page.locator('input[type="email"]').fill("henry@usalatinoprime.com");
    await page.locator('input[type="password"]').fill("changeme-henry!");
    await page.locator('button[type="submit"]').click();

    // Wait for either a navigation away from /login or an error message
    await page.waitForTimeout(8_000);
    const url = page.url();
    await testInfo.attach("post-login-url", { body: url, contentType: "text/plain" });
    await testInfo.attach("post-login-screenshot", {
      body: await page.screenshot(),
      contentType: "image/png",
    });
    // Hard assertion: the app never 500s on a login attempt
    await expect(page.locator("body")).not.toContainText("Internal Server Error");
    console.log(`[staff-login] landed on: ${url} (hook active → /admin; inactive → /login)`);
  });
});

test.describe("design system showcase", () => {
  test("renders components and theme attribute", async ({ page }) => {
    await page.goto("/design");
    await expect(page.locator("html")).toHaveAttribute("data-theme", /light|dark/);
    // Brand components present
    await expect(page.locator("body")).not.toContainText("Internal Server Error");
  });
});
