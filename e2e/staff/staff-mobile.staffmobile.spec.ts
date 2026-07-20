/**
 * Staff mobile mode (≤860px) — responsive + a11y overhaul coverage.
 *
 * Covers the staff-mobile work wave:
 *   1. Messaging panel: SOLID surface (no glass/backdrop-blur) and FULL-SCREEN
 *      in staff mobile mode (user-directed; V2 docs spec no staff mobile).
 *   2. Notification bell popover: full-screen on mobile, Escape closes,
 *      focus returns to the bell, mobile-only close button.
 *   3. Drawer a11y: aria-expanded/aria-controls, Escape closes.
 *   4. Kanban "Mover a…" menu (DOC-01 §5.3): moves a lead without drag&drop.
 *   5. Anti-horizontal-overflow guard on the key staff views (vanessa +
 *      finanzas via admin storageState).
 *
 * Runs in the "staff-mobile" project (390x844, Vanessa storageState).
 * Finanzas routes need finance module access → admin storageState override.
 */

import { test, expect, type Page } from "@playwright/test";
import path from "path";
import { expectNoSeriousA11yViolations } from "../helpers/a11y";

const SHOTS = path.join("e2e", "__screenshots__");
const VW = 390;
const VH = 844;

/** Asserts the element covers (≈) the whole 390x844 viewport. */
async function expectFullViewport(page: Page, selector: string) {
  const bb = await page.locator(selector).boundingBox();
  expect(bb, `${selector} should have a bounding box`).not.toBeNull();
  expect(Math.abs(bb!.x)).toBeLessThanOrEqual(2);
  expect(Math.abs(bb!.y)).toBeLessThanOrEqual(2);
  expect(Math.abs(bb!.width - VW)).toBeLessThanOrEqual(2);
  expect(Math.abs(bb!.height - VH)).toBeLessThanOrEqual(2);
}

/** Applies the staff theme instantly (same mechanism as e2e/helpers/visual.ts). */
async function setTheme(page: Page, theme: "light" | "dark") {
  await page.evaluate((t) => {
    localStorage.setItem("ulp-theme", t);
    document.documentElement.setAttribute("data-theme", t);
  }, theme);
  await page.waitForTimeout(400);
}

/** Computed background-color must be fully opaque (no glass). */
async function expectOpaqueSurface(page: Page, selector: string) {
  const { backgroundColor, backdropFilter } = await page.locator(selector).evaluate((el) => {
    const cs = getComputedStyle(el);
    return { backgroundColor: cs.backgroundColor, backdropFilter: cs.backdropFilter };
  });
  const m = backgroundColor.match(/rgba?\(([^)]+)\)/);
  expect(m, `unexpected background-color "${backgroundColor}"`).not.toBeNull();
  const parts = m![1].split(",").map((p) => p.trim());
  const alpha = parts.length === 4 ? parseFloat(parts[3]) : 1;
  expect(alpha, `${selector} background must be opaque, got ${backgroundColor}`).toBe(1);
  expect(backdropFilter, `${selector} must not use backdrop-filter`).toBe("none");
}

/* ─────────────────────────────────────────────────────────────────
   1 — Messaging panel: solid + full-screen
   ───────────────────────────────────────────────────────────────── */

test.describe("Staff mobile: messaging panel", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/ventas/mi-dia");
    await expect(page.locator(".msg-launch")).toBeVisible({ timeout: 20_000 });
  });

  test("opens full-screen with an opaque, blur-free surface (light + dark)", async ({ page }) => {
    for (const theme of ["light", "dark"] as const) {
      await setTheme(page, theme);
      await page.locator(".msg-launch").click();
      const panel = page.locator(".msg-panel");
      await expect(panel).toBeVisible();

      await expectFullViewport(page, ".msg-panel");
      await expectOpaqueSurface(page, ".msg-panel");
      await expect(panel).toHaveCSS("border-radius", "0px");

      await expectNoSeriousA11yViolations(page, `staff-mobile-messaging-${theme}`);
      await page.screenshot({
        path: path.join(SHOTS, `staff-mobile-mensajeria-fullscreen-${theme}.png`),
        fullPage: false,
      });

      // Close for the next theme iteration.
      await page.getByRole("button", { name: /^cerrar$/i }).click();
      await expect(panel).not.toBeVisible();
      await expect(page.locator(".msg-launch")).toBeVisible();
    }
  });

  test("stays a floating 392px card on desktop widths (regression guard)", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.locator(".msg-launch").click();
    const panel = page.locator(".msg-panel");
    await expect(panel).toBeVisible();
    const bb = await panel.boundingBox();
    expect(Math.abs(bb!.width - 392)).toBeLessThanOrEqual(2);
    await expectOpaqueSurface(page, ".msg-panel");
  });
});

/* ─────────────────────────────────────────────────────────────────
   2 — Notification bell: full-screen popover + Escape + focus return
   ───────────────────────────────────────────────────────────────── */

test.describe("Staff mobile: notification bell", () => {
  test("popover covers the viewport; Escape closes and focus returns to the bell", async ({ page }) => {
    await page.goto("/ventas/mi-dia");
    const bell = page.getByRole("button", { name: "Avisos", exact: true });
    await expect(bell).toBeVisible({ timeout: 20_000 });

    await bell.click();
    const popover = page.locator(".bell-popover");
    await expect(popover).toBeVisible();
    await expectFullViewport(page, ".bell-popover");

    // Mobile-only close button is offered in full-screen mode.
    await expect(page.locator(".bell-close")).toBeVisible();

    await expectNoSeriousA11yViolations(page, "staff-mobile-bell-light");
    await page.screenshot({
      path: path.join(SHOTS, "staff-mobile-notificaciones-fullscreen-light.png"),
      fullPage: false,
    });

    await page.keyboard.press("Escape");
    await expect(popover).not.toBeVisible();
    await expect(bell).toBeFocused();

    // The close button also closes (touch path).
    await bell.click();
    await expect(popover).toBeVisible();
    await page.locator(".bell-close").click();
    await expect(popover).not.toBeVisible();
  });
});

/* ─────────────────────────────────────────────────────────────────
   3 — Drawer a11y
   ───────────────────────────────────────────────────────────────── */

test.describe("Staff mobile: navigation drawer", () => {
  test("hamburger exposes aria-expanded/aria-controls; Escape closes the drawer", async ({ page }) => {
    await page.goto("/ventas/mi-dia");
    const menuBtn = page.locator(".staff-menu-btn");
    await expect(menuBtn).toBeVisible({ timeout: 20_000 });
    await expect(menuBtn).toHaveAttribute("aria-expanded", "false");
    await expect(menuBtn).toHaveAttribute("aria-controls", "staff-sidebar");

    await menuBtn.click();
    await expect(menuBtn).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator("#staff-sidebar")).toHaveAttribute("data-open", "true");

    await page.keyboard.press("Escape");
    await expect(page.locator("#staff-sidebar")).toHaveAttribute("data-open", "false");
    await expect(menuBtn).toBeFocused();
  });
});

/* ─────────────────────────────────────────────────────────────────
   4 — Kanban "Mover a…" menu (no drag&drop)
   ───────────────────────────────────────────────────────────────── */

const TS = Date.now();
const LEAD_PHONE = `+1555${String(TS).slice(-7)}`;
const LEAD_NAME = `E2E Mobile Move ${TS}`;

test.describe("Staff mobile: kanban move menu", () => {
  test("creates a lead and moves it to Contactados via the card menu", async ({ page }) => {
    await page.goto("/ventas/leads");
    await expect(page.getByText("Nuevos").first()).toBeVisible({ timeout: 20_000 });

    // Create the lead (same modal flow as f3-f1-flow-vanessa S2).
    await page.getByRole("button", { name: /nuevo lead|new lead/i }).first().click();
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 8_000 });
    await dialog.locator('input[type="tel"], input[placeholder*="+1"], input').first().fill(LEAD_PHONE);
    await dialog.locator("input").nth(1).fill(LEAD_NAME);
    await dialog.getByRole("button", { name: /crear|create/i }).evaluate((el) => (el as HTMLButtonElement).click());
    await expect(dialog).not.toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(LEAD_NAME).first()).toBeVisible({ timeout: 15_000 });

    // Open the card's "Mover a…" menu and pick Contactados.
    const card = page
      .locator("[data-card-id], .kcard, .kanban-card, [role='article']")
      .filter({ hasText: LEAD_NAME })
      .first();
    await card.getByRole("button", { name: /mover a|move to/i }).click();
    await page.getByRole("menuitem", { name: "Contactados" }).click();

    const contactadosCol = page.locator(".kcol").filter({ hasText: "Contactados" }).first();
    await expect(contactadosCol.getByText(LEAD_NAME)).toBeVisible({ timeout: 10_000 });
  });
});

/* ─────────────────────────────────────────────────────────────────
   5 — Anti-horizontal-overflow guard (RNF-040 spirit)
   ───────────────────────────────────────────────────────────────── */

async function expectNoHorizontalOverflow(page: Page, route: string) {
  await page.goto(route);
  // Let data load + entrance animations settle before measuring.
  await page.waitForTimeout(1_500);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, `${route} has ${overflow}px of horizontal overflow`).toBeLessThanOrEqual(2);
}

test.describe("Staff mobile: no horizontal overflow (vanessa)", () => {
  for (const route of ["/ventas/mi-dia", "/ventas/leads", "/ventas/citas", "/ventas/metricas"]) {
    test(`${route} fits the viewport`, async ({ page }) => {
      await expectNoHorizontalOverflow(page, route);
    });
  }
});

test.describe("Staff mobile: no horizontal overflow (finanzas, admin session)", () => {
  test.use({ storageState: "e2e/.auth/admin.json" });
  for (const route of ["/finanzas", "/finanzas/contabilidad", "/finanzas/campanas", "/finanzas/seguimiento"]) {
    test(`${route} fits the viewport`, async ({ page }) => {
      await expectNoHorizontalOverflow(page, route);
    });
  }
});
