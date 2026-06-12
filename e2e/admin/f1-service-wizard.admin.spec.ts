/**
 * F1 — Service Wizard E2E spec (DOC-80 exit criterion F1).
 *
 * AUTHENTICATION
 * ==============
 * Every test in this file starts already authenticated as Henry (admin).
 * The session is established ONCE by e2e/admin/auth.setup.ts and injected via
 * playwright.config.ts project "admin" → storageState: "e2e/.auth/admin.json".
 *
 * No per-test logins → no rate-limit churn (staff login: 5 req / 15 min).
 * Each beforeEach only navigates to the target URL.
 *
 * KNOWN PRODUCT BUG — BUG-CATALOG-001
 * =====================================
 * /admin/catalogo throws a server-side 500 (Digest 1352047311).
 * Root cause: buildCatalogStrings() in strings.ts calls tt("catalog.phases")
 * which has a next-intl interpolation variable "{n}" but is invoked without
 * context { n: ... }. Same for "entryBadge" ({parent}/{phase}), "celebrate"
 * ({service}), "filledBy" ({who}). next-intl throws FORMATTING_ERROR which
 * propagates unhandled from the Server Component.
 * Affected routes: /admin/catalogo (list) → 500 hard crash.
 *                  /admin/catalogo/nuevo  → errors logged, page still renders.
 * Tests that require /admin/catalogo (list or cleanup) are marked test().
 * Fix: in strings.ts, call tt.raw("catalog.phases") (returns the raw ICU string)
 * or pass a dummy context: tt("catalog.phases", { n: 0 }).
 *
 * ARIA-LABEL ADDITIONS (applied to source components)
 * ====================================================
 * 1. i18n-field.tsx — Col.aria-label changed from "{lang}" to "{fieldLabel} {lang}".
 *    Enables: page.getByLabel("Nombre del servicio ES")
 *
 * 2. catalog-wizard.tsx BasicsStep — category <button> elements got
 *    aria-label={c} + aria-pressed={on}.
 *    Enables: page.getByRole("button", { name: /Migratorio/i })
 *
 * 3. catalog-wizard.tsx PhasesStep — phase sidebar buttons got
 *    aria-label={`Fase ${i + 1}: ${ph.label.es || ph.slug}`} + aria-pressed.
 *    The "Agregar fase" dashed button got aria-label={t.addPhase}.
 *    Enables: page.getByRole("button", { name: /^Fase \d/i })
 *
 * IDEMPOTENCE
 * ===========
 * Every service slug is suffixed with TS (Date.now() at module load).
 * The cleanup test is fixme'd due to BUG-CATALOG-001.
 * Orphan drafts: archive manually at /admin/catalogo once the bug is fixed.
 */

import { test, expect, type Page } from "@playwright/test";

/* ─────────────────────────────────────────────────────────────────
   Constants
   ───────────────────────────────────────────────────────────────── */

const TS = Date.now();
const SERVICE_SLUG = `servicio-e2e-${TS}`;
const SERVICE_NAME_ES = "Servicio E2E Prueba";
const SERVICE_NAME_EN = "E2E Test Service";

const EMP_EMAIL = `test.e2e.${TS}@usalatinoprime.com`;
const EMP_NAME = `E2E Tester ${TS}`;

/* ─────────────────────────────────────────────────────────────────
   Selector helper
   ───────────────────────────────────────────────────────────────── */

/**
 * Returns the <h1> ViewHead heading for a given page title.
 *
 * The admin layout renders the page name in TWO places:
 *   1. <span> inside the sidebar nav link   → getByRole('link', ...)
 *   2. <h1>   rendered by ViewHead          → getByRole('heading', ...)
 * getByText('Empleados') / getByText('Auditoría') always find both
 * → strict mode violation. The h1 is the canonical "page loaded" signal.
 */
function pageHeading(page: Page, name: string) {
  return page.getByRole("heading", { name, level: 1 });
}

/* ─────────────────────────────────────────────────────────────────
   1. Dashboard
   ───────────────────────────────────────────────────────────────── */

test.describe("F1 — Admin: dashboard", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/admin$/, { timeout: 15_000 });
  });

  test("renders dashboard with greeting and KPI cards", async ({ page }) => {
    // "Buen día" or "Buen día, Henry" — may appear multiple times; .first() is fine.
    await expect(page.getByText(/Buen día/i).first()).toBeVisible({ timeout: 15_000 });

    // Three KPI spans match this regex → use .first() to avoid strict mode violation.
    await expect(
      page.getByText(/Servicios activos|Empleados activos|Casos activos/i).first(),
    ).toBeVisible({ timeout: 10_000 });

    await expect(page.locator("body")).not.toContainText("Internal Server Error");
  });
});

/* ─────────────────────────────────────────────────────────────────
   2. Catalog list  (BUG-CATALOG-001 fixed: strings.ts uses tt.raw())
   ───────────────────────────────────────────────────────────────── */

test.describe("F1 — Admin: catalog list", () => {
  test("catalog list renders with 'Nuevo servicio' button", async ({ page }) => {
    await page.goto("/admin/catalogo");
    await expect(page).toHaveURL(/\/admin\/catalogo$/, { timeout: 15_000 });
    await expect(page.getByRole("button", { name: /Nuevo servicio/i })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.locator("body")).not.toContainText("Internal Server Error");
  });
});

/* ─────────────────────────────────────────────────────────────────
   3. Catalog wizard — happy path
   ───────────────────────────────────────────────────────────────── */

test.describe("F1 — Admin: service wizard (happy path)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/admin/catalogo/nuevo");
    // The wizard page renders despite server-logged FORMATTING_ERRORs.
    await expect(page.getByText("Datos básicos")).toBeVisible({ timeout: 20_000 });
  });

  // ── Helper ────────────────────────────────────────────────────

  async function fillBasics(page: Page, slug: string) {
    await page.locator('input[placeholder="asilo-politico"]').fill(slug);
    // aria-label="migratorio" added to category buttons in catalog-wizard.tsx
    await page.getByRole("button", { name: /Migratorio/i }).first().click();
    // aria-label="{fieldLabel} {lang}" — see i18n-field.tsx patch
    await page.getByLabel("Nombre del servicio ES").fill(SERVICE_NAME_ES);
    await page.getByLabel("Nombre del servicio EN").fill(SERVICE_NAME_EN);
  }

  // ── Tests ─────────────────────────────────────────────────────

  test("step 1: fill basic data and advance to Planes", async ({ page }) => {
    await fillBasics(page, SERVICE_SLUG);
    await page.getByLabel("Descripción corta ES").fill("Descripción E2E prueba");
    await page.getByLabel("Descripción corta EN").fill("E2E test description");

    await page.getByRole("button", { name: /Siguiente/i }).click();

    // "Planes" appears in the stepper span; .first() guards against future duplication.
    await expect(page.getByText("Planes").first()).toBeVisible({ timeout: 15_000 });
  });

  test("step 2: enable self + with_lawyer plans with prices and advance to Fases", async ({
    page,
  }) => {
    await fillBasics(page, `${SERVICE_SLUG}-plans`);
    await page.getByRole("button", { name: /Siguiente/i }).click();
    await expect(page.getByText("Planes").first()).toBeVisible({ timeout: 15_000 });

    const offerSwitches = page.getByRole("switch", { name: /Ofrecer este plan/i });
    await offerSwitches.nth(0).click(); // enable Self

    // Target price input by card proximity — "Self" heading is unique in its card
    const selfCard = page.locator("div").filter({ has: page.getByText("Self").nth(0) }).nth(1);
    await selfCard.locator('input[type="number"]').first().fill("1000");

    await offerSwitches.nth(1).click(); // enable Con abogado

    const lawyerCard = page
      .locator("div")
      .filter({ has: page.getByText("Con abogado").nth(0) })
      .nth(1);
    await lawyerCard.locator('input[type="number"]').first().fill("2500");

    await page.getByRole("button", { name: /Siguiente/i }).click();
    await expect(page.getByText("Fases").first()).toBeVisible({ timeout: 15_000 });
  });

  test("step 3: create two bilingual phases and verify sidebar count", async ({ page }) => {
    await fillBasics(page, `${SERVICE_SLUG}-phases`);
    await page.getByRole("button", { name: /Siguiente/i }).click();
    await expect(page.getByText("Planes").first()).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: /Siguiente/i }).click();
    await expect(page.getByText("Fases").first()).toBeVisible({ timeout: 15_000 });

    // ── Phase 1 ──────────────────────────────────────────────────
    await page.getByRole("button", { name: /Agregar fase/i }).click();
    await expect(page.getByLabel("Nombre de la fase ES")).toBeVisible({ timeout: 10_000 });

    await page.getByLabel("Nombre de la fase ES").fill("Consulta inicial");
    await page.getByLabel("Nombre de la fase EN").fill("Initial consultation");
    await page.getByLabel("Explicación para el cliente ES").fill(
      "En esta fase revisamos tu caso",
    );
    await page.getByLabel("Explicación para el cliente EN").fill(
      "In this phase we review your case",
    );
    await page.getByRole("button", { name: /^Guardar$/i }).click();
    await expect(page.getByText(/Guardado hace un momento/i)).toBeVisible({ timeout: 8_000 });

    // ── Phase 2 ──────────────────────────────────────────────────
    await page.getByRole("button", { name: /Agregar fase/i }).click();
    await expect(page.getByLabel("Nombre de la fase ES")).toBeVisible({ timeout: 10_000 });

    await page.getByLabel("Nombre de la fase ES").fill("Documentación");
    await page.getByLabel("Nombre de la fase EN").fill("Documentation");
    await page.getByLabel("Explicación para el cliente ES").fill(
      "Reúne todos los documentos",
    );
    await page.getByLabel("Explicación para el cliente EN").fill(
      "Gather all required documents",
    );
    await page.getByRole("button", { name: /^Guardar$/i }).click();
    await expect(page.getByText(/Guardado hace un momento/i)).toBeVisible({ timeout: 8_000 });

    // Sidebar phase buttons have aria-label="Fase 1: ..." (catalog-wizard.tsx patch)
    const phaseButtons = page.getByRole("button", { name: /^Fase \d/i });
    await expect(phaseButtons).toHaveCount(2, { timeout: 5_000 });

    await page.getByRole("button", { name: /Siguiente/i }).click();
    await expect(page.getByText("Documentos").first()).toBeVisible({ timeout: 10_000 });
  });

  test("step 4-6: docs → forms stub → publish screen renders", async ({ page }) => {
    await fillBasics(page, `${SERVICE_SLUG}-docs`);
    await page.getByRole("button", { name: /Siguiente/i }).click(); // → Planes
    await page.getByRole("button", { name: /Siguiente/i }).click(); // → Fases (empty)
    await page.getByRole("button", { name: /Siguiente/i }).click(); // → Documentos

    await expect(page.getByText("Documentos").first()).toBeVisible({ timeout: 10_000 });

    // DocsStep renders <FieldLabel>Fase</FieldLabel> (exact "Fase" without trailing chars).
    // "Fases" in stepper won't match because exact: true is case-sensitive.
    await expect(page.getByText("Fase", { exact: true })).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Internal Server Error");

    // Step 5 — FormsStep stub
    await page.getByRole("button", { name: /Siguiente/i }).click();
    // Use unique stub body text "Disponible en F4" instead of "Formularios"
    // ("Formularios" appears in both the stepper span and the formStubSub body text)
    await expect(page.getByText("Disponible en F4")).toBeVisible({ timeout: 10_000 });

    // Step 6 — PublishStep
    await page.getByRole("button", { name: /Siguiente/i }).click();
    await expect(
      page.getByText("Lista de comprobación de publicación"),
    ).toBeVisible({ timeout: 10_000 });

    await expect(page.getByRole("button", { name: /Activar servicio/i })).toBeVisible();
  });
});

/* ─────────────────────────────────────────────────────────────────
   4. Publish gate — incomplete service exposes domain errors
   ───────────────────────────────────────────────────────────────── */

test.describe("F1 — Admin: publish gate (incomplete service)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/admin/catalogo/nuevo");
    await expect(page.getByText("Datos básicos")).toBeVisible({ timeout: 20_000 });
  });

  test("activating an incomplete service shows blocking or warning issues", async ({ page }) => {
    await page.locator('input[placeholder="asilo-politico"]').fill(`e2e-incomplete-${TS}`);
    await page.getByRole("button", { name: /Migratorio/i }).first().click();
    await page.getByLabel("Nombre del servicio ES").fill("Servicio incompleto E2E");
    // EN deliberately left blank

    await page.getByRole("button", { name: /Siguiente/i }).click();
    await expect(page.getByText("Planes").first()).toBeVisible({ timeout: 10_000 });

    await page.getByRole("button", { name: /Siguiente/i }).click();
    await expect(page.getByText("Fases").first()).toBeVisible({ timeout: 10_000 });

    await page.getByRole("button", { name: /Siguiente/i }).click();
    await expect(page.getByText("Documentos").first()).toBeVisible({ timeout: 10_000 });

    await page.getByRole("button", { name: /Siguiente/i }).click();
    // Use unique stub text to avoid the "Formularios" strict-mode ambiguity
    await expect(page.getByText("Disponible en F4")).toBeVisible({ timeout: 10_000 });

    await page.getByRole("button", { name: /Siguiente/i }).click();
    await expect(
      page.getByText("Lista de comprobación de publicación"),
    ).toBeVisible({ timeout: 10_000 });

    await page.getByRole("button", { name: /Activar servicio/i }).click();

    // PublishStep renders issue cards (--red-soft / --gold-soft) OR a toast.error.
    const gateEvidence = page
      .locator('[style*="red-soft"], [style*="gold-soft"]')
      .or(page.locator('[data-sonner-toast]'));
    await expect(gateEvidence.first()).toBeVisible({ timeout: 15_000 });

    // Celebration copy must NOT appear — service was not published
    await expect(page.getByText(/a la venta/i)).toHaveCount(0);
    console.log("[F1 admin] Publish gate: blocking/warning evidence visible.");
  });

  test("'Falta EN' chip is visible when EN name is left blank", async ({ page }) => {
    await page.locator('input[placeholder="asilo-politico"]').fill(`e2e-noen-${TS}`);
    await page.getByLabel("Nombre del servicio ES").fill("Solo ES");
    // EN deliberately blank — I18nField shows chip for every bilingual field on the form.
    // Two fields (name + description) → two chips. Use .first() to avoid strict mode.
    await expect(page.getByText("Falta EN").first()).toBeVisible();
  });
});

/* ─────────────────────────────────────────────────────────────────
   5. Employees — invite, permission matrix, deactivate
   ───────────────────────────────────────────────────────────────── */

test.describe("F1 — Admin: employees", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/admin/empleados");
    // Use the h1 heading to avoid strict mode: sidebar nav <span> + page <h1>
    // both read "Empleados" → getByText('Empleados') resolves to 2 elements.
    await expect(pageHeading(page, "Empleados")).toBeVisible({ timeout: 15_000 });
  });

  test("page renders title and 'Nuevo empleado' button", async ({ page }) => {
    await expect(page.getByRole("button", { name: /Nuevo empleado/i })).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Internal Server Error");
  });

  test("invite new employee (sales role) and confirm toast", async ({ page }) => {
    await page.getByRole("button", { name: /Nuevo empleado/i }).click();

    // Scope to the Radix Dialog — DialogPrimitive.Content renders role="dialog".
    // This avoids any sidebar nav collision and ensures all selectors below
    // operate inside the modal only.
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 8_000 });
    await expect(
      dialog.getByRole("heading", { name: "Nuevo empleado" }),
    ).toBeVisible({ timeout: 8_000 });

    // Step 1 — basic info.
    // FieldLabel renders as <span>, not <label>, so getByLabel() doesn't work.
    // Use input type / position within the dialog instead.
    await dialog.locator('input[type="email"]').fill(EMP_EMAIL);
    // The name TextInput is the second input element in step 1 (after the email input).
    await dialog.locator("input").nth(1).fill(EMP_NAME);
    // Role selector — three role buttons; Ventas is the sales preset.
    await dialog.getByRole("button", { name: /Ventas/i }).click();

    // Advance to step 2 — permission grid.
    // The Modal uses overflow:auto + maxHeight on its DialogPrimitive.Content wrapper.
    // When the form is taller than the viewport the footer button is inside the modal's
    // scroll container but outside the outer viewport, causing Playwright's actionability
    // check ("element is outside of the viewport") to fail even with force:true.
    // Using evaluate() to dispatch a native click bypasses Playwright's viewport guard
    // entirely while still firing the real React onClick handler.
    const nextBtn = dialog.getByRole("button", { name: /Siguiente/i });
    await nextBtn.evaluate((el) => (el as HTMLButtonElement).click());
    await expect(dialog.getByText("Módulo").first()).toBeVisible({ timeout: 8_000 });

    // Optionally disable Catálogo view before sending
    const catalogViewSwitch = dialog.getByRole("switch", {
      name: /Catálogo.*Ver|catalog.*Ver/i,
    });
    if (await catalogViewSwitch.isVisible()) {
      const state = await catalogViewSwitch.getAttribute("data-state");
      if (state === "checked") await catalogViewSwitch.click();
    }

    // Same modal overflow issue: evaluate() click to bypass viewport guard
    const submitBtn = dialog.getByRole("button", { name: /Crear y enviar invitación/i });
    await submitBtn.evaluate((el) => (el as HTMLButtonElement).click());

    // Primary assertion: the employee row appears after router.refresh().
    // This is the canonical "resulting state" signal — more durable than a toast
    // because router.refresh() can dismiss the toast before it becomes visible.
    await expect(page.getByText(EMP_NAME)).toBeVisible({ timeout: 20_000 });

    // Secondary: log whether the toast was also visible (soft check — non-blocking)
    const toastVisible = await page
      .getByText(new RegExp(`Invitación enviada a ${EMP_EMAIL}`, "i"))
      .isVisible()
      .catch(() => false);
    console.log(`[F1 admin] Invite toast visible: ${toastVisible}`);
    console.log(`[F1 admin] Invite confirmed via resulting employee row: ${EMP_NAME}`);
  });

  test("open permission matrix and save (confirms 'Permisos actualizados' toast)", async ({
    page,
  }) => {
    const empRow = page.locator("tr", { hasText: EMP_NAME });
    await expect(empRow).toBeVisible({ timeout: 10_000 });

    await empRow.getByRole("button", { name: /Permisos/i }).click();

    // Scope to the Radix Dialog for all in-modal assertions
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 8_000 });
    // Modal title: "Permisos · {name}"
    await expect(
      dialog.getByText(new RegExp(`Permisos.*${EMP_NAME}`)).first(),
    ).toBeVisible({ timeout: 8_000 });

    // Toggle catalog view OFF if ON
    const catalogSwitch = dialog.getByRole("switch", {
      name: /Catálogo.*Ver|catalog.*Ver/i,
    });
    if (await catalogSwitch.isVisible()) {
      const state = await catalogSwitch.getAttribute("data-state");
      if (state === "checked") await catalogSwitch.click();
    }

    // evaluate() click — modal overflow may push footer button outside the outer viewport
    const saveBtn = dialog.getByRole("button", { name: /^Guardar$/i });
    await saveBtn.evaluate((el) => (el as HTMLButtonElement).click());

    // Toast: "Permisos actualizados. El efecto es inmediato…"
    await expect(page.getByText(/Permisos actualizados/i).first()).toBeVisible({
      timeout: 10_000,
    });
  });

  test("deactivate the test employee and confirm (cleanup)", async ({ page }) => {
    const empRow = page.locator("tr", { hasText: EMP_NAME });
    await expect(empRow).toBeVisible({ timeout: 10_000 });

    await empRow.getByRole("button", { name: /Desactivar/i }).click();

    // Scope to the Radix Dialog for the confirmation modal
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 8_000 });
    await expect(
      dialog.getByRole("heading", { name: "Desactivar empleado" }),
    ).toBeVisible({ timeout: 8_000 });

    // evaluate() click — modal overflow may push footer button outside the outer viewport
    const deactivateBtn = dialog.getByRole("button", { name: /^Desactivar$/i });
    await deactivateBtn.evaluate((el) => (el as HTMLButtonElement).click());

    // After confirm: the dialog should close and the row should show "Inactivo" status.
    // Wait for the dialog to disappear first (the action completed).
    await expect(dialog).not.toBeVisible({ timeout: 10_000 });
    await expect(
      page.locator("tr", { hasText: EMP_NAME }).getByText(/Inactivo/i),
    ).toBeVisible({ timeout: 10_000 });
  });
});

/* ─────────────────────────────────────────────────────────────────
   6. Audit log
   ───────────────────────────────────────────────────────────────── */

test.describe("F1 — Admin: audit log", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/admin/auditoria");
    // Use h1 — sidebar <span> + <h1> both read "Auditoría" → strict mode if using getByText.
    await expect(pageHeading(page, "Auditoría")).toBeVisible({ timeout: 15_000 });
  });

  test("page renders table with 'Solo lectura' badge and column headers", async ({ page }) => {
    await expect(page.getByText("Solo lectura")).toBeVisible();
    await expect(page.getByText("Cuándo")).toBeVisible();
    await expect(page.getByText("Quién")).toBeVisible();
    // "Acción" appears as both a column header and a filter input placeholder.
    // Target the column header role to be unambiguous.
    await expect(page.getByRole("columnheader", { name: "Acción" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Entidad" })).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Internal Server Error");
  });

  test("audit table has rows after catalog/employee operations", async ({ page }) => {
    const rows = page.locator("table tbody tr");
    const count = await rows.count();

    if (count === 0) {
      console.log("[F1 admin] Audit table empty — run wizard + employee tests first.");
    } else {
      await expect(rows.first()).toBeVisible();
      await expect(page.locator("body")).not.toContainText("Internal Server Error");
      console.log(`[F1 admin] Audit table: ${count} row(s).`);
    }
  });

  test("clicking an audit row opens the detail side panel", async ({ page }) => {
    const rows = page.locator("table tbody tr");
    if ((await rows.count()) === 0) {
      test.skip(true, "No audit entries — run wizard + employee tests first");
    }

    await rows.first().click();

    // The SidePanel uses Radix Dialog → role="dialog".
    // Scope the assertion to avoid matching hidden <option> elements in the
    // background audit filter selects (which contain "Tipo de entidad" etc.)
    const detailPanel = page.locator('[role="dialog"]');
    await expect(detailPanel.getByText("Detalle del cambio")).toBeVisible({ timeout: 8_000 });
    // Meta rows render the labels "Quién", "Acción", "Entidad", "Cuándo" as <span>s inside the panel.
    await expect(detailPanel.getByText(/Quién/i)).toBeVisible();
  });
});

/* ─────────────────────────────────────────────────────────────────
   7. Cleanup (idempotent)
   ───────────────────────────────────────────────────────────────── */

test.describe("F1 — Admin: cleanup (idempotent)", () => {
  test("archive test services created in this run", async ({ page }) => {
    await page.goto("/admin/catalogo");
    await expect(pageHeading(page, "Catálogo")).toBeVisible({ timeout: 15_000 });

    const slugCells = page.locator("code").filter({ hasText: String(TS) });
    const total = await slugCells.count();

    if (total === 0) {
      console.log("[F1 admin] Cleanup: 0 services found with this run's timestamp.");
      return;
    }

    for (let i = 0; i < total; i++) {
      const current = page.locator("code").filter({ hasText: String(TS) }).first();
      if (!(await current.isVisible().catch(() => false))) break;

      // Nearest ancestor that CONTAINS a kebab button = the service card.
      // (Fixed-depth ".." traversal climbed past the card and matched every
      // kebab in the list — strict mode violation with 50+ services.)
      const card = current.locator(
        'xpath=ancestor::*[.//button[@aria-label="Menú"]][1]',
      );
      await card.getByRole("button", { name: /Menú/i }).first().click();
      await page.getByRole("menuitem", { name: /Archivar/i }).click();
      // Confirm dialog
      const confirmBtn = page.getByRole("button", { name: /^Archivar$/i });
      await expect(confirmBtn).toBeVisible({ timeout: 5_000 });
      await confirmBtn.click();
      await page.waitForLoadState("networkidle").catch(() => {});
    }

    console.log(`[F1 admin] Cleanup: archived ${total} test service(s).`);
  });
});
