/**
 * F0 smoke — client auth surface (DOC-22 §1, DOC-51 screens 1-4).
 *
 * Covers the F0 exit criteria that do not require Twilio Verify:
 * - welcome renders and navigates
 * - phone form normalizes and ALWAYS lands on /otp (anti-enumeration §1.4)
 * - OTP screen: 6 boxes, countdown, uniform error on wrong code
 * - surface guards (middleware)
 */
import { test, expect } from "@playwright/test";

const DEMO_PHONE_DIGITS = "7865550101"; // seed 03 demo client (+1 786 555 0101)

test.describe("welcome", () => {
  test("renders brand, Lex and CTAs", async ({ page }) => {
    await page.goto("/welcome");
    await expect(page.getByText("Bienvenido a tu portal")).toBeVisible();
    await expect(page.getByRole("link", { name: /ver mi caso/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /no tengo acceso/i })).toBeVisible();
  });

  test("CTA navigates to /phone", async ({ page }) => {
    await page.goto("/welcome");
    await page.getByRole("link", { name: /ver mi caso/i }).click();
    // Generous timeout: Turbopack cold-compiles /phone on first hit in dev
    await expect(page).toHaveURL(/\/phone$/, { timeout: 30_000 });
    await expect(page.locator('input[type="tel"]')).toBeVisible();
  });
});

test.describe("phone → otp (anti-enumeration: always lands on /otp)", () => {
  test("submits demo phone and lands on /otp with the formatted number", async ({ page }) => {
    await page.goto("/phone");
    await page.locator('input[type="tel"]').fill(DEMO_PHONE_DIGITS);
    await page.locator('button[type="submit"]').click();

    // Uniform response: ALWAYS transitions to OTP (DOC-22 §1.4) — the request
    // takes >= 800ms (latency floor) plus dev cold-compile of the action.
    await expect(page).toHaveURL(/\/otp\?phone=/, { timeout: 30_000 });
    await expect(page.getByText("Escribe tu código")).toBeVisible();

    // 6 OTP boxes
    const boxes = page.locator('input[aria-label^="Dígito"]');
    await expect(boxes).toHaveCount(6);

    // Countdown is live (interpolated, not the raw i18n key)
    await expect(page.getByText(/Reenviar código en 0:\d{2}/)).toBeVisible();
    await expect(page.getByText("cliente.otp.resendCountdown")).toHaveCount(0);
  });

  test("wrong code shows the uniform error (no enumeration hint)", async ({ page }) => {
    await page.goto(`/otp?phone=%2B1%20786%20555%200101`);
    const boxes = page.locator('input[aria-label^="Dígito"]');
    for (let i = 0; i < 6; i++) {
      await boxes.nth(i).fill(String(i));
    }
    // Submit (auto-submit on 6th digit or via CTA)
    const cta = page.getByRole("button", { name: /entrar a mi caso/i });
    if (await cta.isEnabled().catch(() => false)) {
      await cta.click();
    }
    // Uniform error — same message whether the phone exists or not
    await expect(
      page.getByText(/(no coincide|Demasiados intentos)/i),
    ).toBeVisible({ timeout: 15_000 });
    // Still on /otp (no session was created)
    await expect(page).toHaveURL(/\/otp/);
  });

  test("/otp without phone param redirects to /phone", async ({ page }) => {
    await page.goto("/otp");
    await expect(page).toHaveURL(/\/phone$/);
  });
});

test.describe("surface guards (middleware)", () => {
  test("client home requires session → /welcome", async ({ page }) => {
    await page.goto("/home");
    await expect(page).toHaveURL(/\/welcome$/);
  });

  test("no-access renders neutral message", async ({ page }) => {
    await page.goto("/no-access");
    await expect(page).toHaveURL(/\/no-access$/);
    // Page renders without error (neutral copy, no enumeration hint)
    await expect(page.locator("body")).not.toContainText("Internal Server Error");
  });
});
