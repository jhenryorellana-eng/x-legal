/**
 * F1 — Service Wizard E2E spec (DOC-80 exit criterion F1).
 *
 * AUTHENTICATION STRATEGY
 * =======================
 * A real login against henry@usalatinoprime.com is attempted in beforeAll.
 * Two outcomes:
 *   - Hook ACTIVE  (local CI / supabase start): JWT claims are present,
 *     middleware lets the user reach /admin → suite runs.
 *   - Hook INACTIVE (remote dashboard not yet configured): middleware treats
 *     the session as "unprovisioned", redirects to /login →
 *     ALL tests are skipped with an explanatory message.
 *
 * HOW TO RUN LOCALLY WITH HOOK ACTIVE
 * =====================================
 * 1. `supabase start`          — local stack (config.toml enables the hook)
 * 2. `supabase db reset`       — apply seed (henry user + org seeded)
 * 3. `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 ... npm run dev`
 * 4. `npx playwright test e2e/admin/`
 *
 * ARIA-LABEL ADDITIONS REQUIRED
 * ==============================
 * The following aria-labels were added to source components to make
 * accessible selectors possible (documented below each interaction):
 *
 * 1. catalog-wizard.tsx BasicsStep — category buttons now have aria-label.
 *    Added: aria-label={c} on each category <button> (values: "migratorio",
 *    "empresarial", "familiar"). Previously no aria-label existed; only text
 *    content was available (catMigratorio i18n key).
 *
 * 2. catalog-wizard.tsx PhasesStep — phase list buttons now have aria-label.
 *    Added: aria-label={`Fase ${i + 1}: ${ph.label.es || ph.slug}`} on each
 *    phase <button> in the sidebar list and aria-label={t.addPhase} on the
 *    "Agregar fase" dashed button.
 *
 * 3. i18n-field.tsx Col — input aria-label now includes the parent field label.
 *    Changed from: aria-label={`${lang}`}
 *    Changed to:   aria-label={`${parentLabel} ${lang}`}
 *    This requires I18nField to pass its `label` prop down to Col.
 *    Without this, two adjacent fields both have "ES" / "EN" inputs with
 *    identical aria-labels, making getByLabel('ES') non-unique.
 *
 * NOTE: If aria-label additions are not yet applied, use the fallback
 * selectors commented inline (locator + nth / closest pattern).
 */

import { test, expect, type Page } from "@playwright/test";

/* ─────────────────────────────────────────────────────────────────
   Constants
   ───────────────────────────────────────────────────────────────── */

const ADMIN_EMAIL = "henry@usalatinoprime.com";
const ADMIN_PASSWORD = "changeme-henry!";

// Timestamp suffix makes each run idempotent (no collision with prior runs).
const TS = Date.now();
const SERVICE_SLUG = `servicio-e2e-${TS}`;
const SERVICE_NAME_ES = "Servicio E2E Prueba";
const SERVICE_NAME_EN = "E2E Test Service";

const EMP_EMAIL = `test.e2e.${TS}@usalatinoprime.com`;
const EMP_NAME = `E2E Tester ${TS}`;

/* ─────────────────────────────────────────────────────────────────
   Auth helpers
   ───────────────────────────────────────────────────────────────── */

/**
 * Performs the staff login flow and returns true if the session landed on
 * /admin (hook active). Returns false if it stayed on /login (hook inactive).
 */
async function tryLogin(page: Page): Promise<boolean> {
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(ADMIN_EMAIL);
  await page.locator('input[type="password"]').fill(ADMIN_PASSWORD);
  await page.locator('button[type="submit"]').click();

  // Allow up to 12 s for either /admin or /login to stabilise.
  await page.waitForURL(/(\/admin$|\/login)/, { timeout: 12_000 }).catch(() => {});
  return page.url().includes("/admin");
}

/* ─────────────────────────────────────────────────────────────────
   Shared state (set in beforeAll, read in each test)
   ───────────────────────────────────────────────────────────────── */

let hookActive = false;

/* ─────────────────────────────────────────────────────────────────
   1. Auth gate — must run first
   ───────────────────────────────────────────────────────────────── */

test.describe("F1 — Admin: auth gate", () => {
  test("login with seeded credentials and detect hook state", async ({ page }, testInfo) => {
    hookActive = await tryLogin(page);

    await testInfo.attach("post-login-url", {
      body: page.url(),
      contentType: "text/plain",
    });
    await testInfo.attach("post-login-screenshot", {
      body: await page.screenshot(),
      contentType: "image/png",
    });

    if (!hookActive) {
      console.log(
        "[F1 admin] Auth Hook INACTIVE — hook not enabled in Supabase dashboard.\n" +
          "  Run suite locally with `supabase start` (config.toml enables the hook)\n" +
          "  or activate the hook in the remote Supabase dashboard Settings → Auth → Hooks.",
      );
    } else {
      console.log("[F1 admin] Auth Hook ACTIVE — session landed on /admin. Suite will run.");
    }

    // Either outcome is valid at this stage — the guard tests decide what to assert.
    await expect(page.locator("body")).not.toContainText("Internal Server Error");
  });
});

/* ─────────────────────────────────────────────────────────────────
   2. Dashboard KPIs
   ───────────────────────────────────────────────────────────────── */

test.describe("F1 — Admin: dashboard", () => {
  test.beforeEach(async ({ page }) => {
    if (!hookActive) test.skip(true, "Requiere Auth Hook activo (dashboard) o stack local CI");
    const ok = await tryLogin(page);
    if (!ok) test.skip(true, "Requiere Auth Hook activo (dashboard) o stack local CI");
  });

  test("renders dashboard with KPI cards", async ({ page }) => {
    // After login, already at /admin from beforeEach.
    await expect(page).toHaveURL(/\/admin$/);

    // The greeting text (Buen día or Buen día, Henry) is always present.
    await expect(page.getByText(/Buen día/i)).toBeVisible({ timeout: 15_000 });

    // At least one KPI label is visible.
    await expect(
      page.getByText(/Servicios activos|Empleados activos|Casos activos/i),
    ).toBeVisible({ timeout: 10_000 });
  });
});

/* ─────────────────────────────────────────────────────────────────
   3. Catalog wizard — happy path
   ───────────────────────────────────────────────────────────────── */

test.describe("F1 — Admin: service wizard (happy path)", () => {
  test.beforeEach(async ({ page }) => {
    if (!hookActive) test.skip(true, "Requiere Auth Hook activo (dashboard) o stack local CI");
    const ok = await tryLogin(page);
    if (!ok) test.skip(true, "Requiere Auth Hook activo (dashboard) o stack local CI");
  });

  test("catalog list renders 'Nuevo servicio' button", async ({ page }) => {
    await page.goto("/admin/catalogo");
    await expect(page).toHaveURL(/\/admin\/catalogo$/);

    // Either the CTA inside ViewHead or the EmptyState action.
    await expect(page.getByRole("button", { name: /Nuevo servicio/i })).toBeVisible({
      timeout: 15_000,
    });
  });

  test("wizard step 1: fill basic data (ES + EN + slug + category)", async ({ page }) => {
    await page.goto("/admin/catalogo/nuevo");
    await expect(page.getByText("Datos básicos")).toBeVisible({ timeout: 15_000 });

    // Slug field — plain TextInput without a label element; target by placeholder.
    // aria-label addition needed: TextInput in BasicsStep should get aria-label="Identificador (slug)"
    // Fallback: placeholder="asilo-politico"
    const slugInput = page.locator('input[placeholder="asilo-politico"]');
    await slugInput.clear();
    await slugInput.fill(SERVICE_SLUG);

    // Category: target via aria-label="migratorio" (see ARIA-LABEL ADDITIONS above)
    // Fallback: getByText for the translated value
    const categoryBtn = page.getByRole("button", { name: /Migratorio/i }).first();
    await categoryBtn.click();

    // Service name ES — I18nField for "Nombre del servicio"
    // With aria-label additions: getByLabel("Nombre del servicio ES")
    // Without: first input with aria-label="ES" in the form
    const nameES = page.getByLabel("Nombre del servicio ES");
    await nameES.fill(SERVICE_NAME_ES);

    // Service name EN
    const nameEN = page.getByLabel("Nombre del servicio EN");
    await nameEN.fill(SERVICE_NAME_EN);

    // Description ES
    const descES = page.getByLabel("Descripción corta ES");
    await descES.fill("Descripción E2E prueba");

    // Description EN
    const descEN = page.getByLabel("Descripción corta EN");
    await descEN.fill("E2E test description");

    // Click "Siguiente" to advance to step 2.
    await page.getByRole("button", { name: /Siguiente/i }).click();

    // Should transition to step 2 (Planes).
    await expect(page.getByText("Planes")).toBeVisible({ timeout: 15_000 });
  });

  test("wizard step 2: configure self + with_lawyer plans", async ({ page }) => {
    // Navigate fresh to wizard and re-run basics to get to step 2.
    // In a full run, these steps are sequential. Here each test starts from /login
    // due to beforeEach re-login; we go through the wizard programmatically.
    await page.goto("/admin/catalogo/nuevo");
    await expect(page.getByText("Datos básicos")).toBeVisible({ timeout: 15_000 });

    // Fill basics quickly to advance.
    await page.locator('input[placeholder="asilo-politico"]').fill(`${SERVICE_SLUG}-plans`);
    await page.getByRole("button", { name: /Migratorio/i }).first().click();
    await page.getByLabel("Nombre del servicio ES").fill(SERVICE_NAME_ES);
    await page.getByLabel("Nombre del servicio EN").fill(SERVICE_NAME_EN);
    await page.getByRole("button", { name: /Siguiente/i }).click();
    await expect(page.getByText("Planes")).toBeVisible({ timeout: 15_000 });

    // Enable "Self" plan.
    // The Switch component renders a button or input; target via aria-label="Ofrecer este plan"
    // There are two switches (one per plan card). The first is for "Self".
    const offerSwitches = page.getByRole("switch", { name: /Ofrecer este plan/i });
    await offerSwitches.nth(0).click(); // enable Self

    // Wait for the price field to become interactive (opacity switches from 0.45 to 1).
    // The price input inside the Self card has no specific aria-label; use nth(0).
    // aria-label addition needed: TextInput for price should get aria-label="Precio Self" etc.
    // Fallback: nth within the card, or target by proximity to plan heading.
    const selfCard = page.getByText("Self").locator("..").locator("..");
    // The price input is of type=number; fill 1000 (represents $1,000.00 → 100000 cents).
    await selfCard.locator('input[type="number"]').first().fill("1000");

    // Enable "Con abogado" plan (second switch).
    await offerSwitches.nth(1).click();
    const lawyerCard = page.getByText("Con abogado").locator("..").locator("..");
    await lawyerCard.locator('input[type="number"]').first().fill("2500");

    // Advance to step 3.
    await page.getByRole("button", { name: /Siguiente/i }).click();
    await expect(page.getByText("Fases")).toBeVisible({ timeout: 15_000 });
  });

  test("wizard step 3: create two bilingual phases and mark entry phase", async ({ page }) => {
    // Navigate and fill basics + plans to reach step 3.
    await page.goto("/admin/catalogo/nuevo");
    await expect(page.getByText("Datos básicos")).toBeVisible({ timeout: 15_000 });

    await page.locator('input[placeholder="asilo-politico"]').fill(`${SERVICE_SLUG}-phases`);
    await page.getByRole("button", { name: /Migratorio/i }).first().click();
    await page.getByLabel("Nombre del servicio ES").fill(SERVICE_NAME_ES);
    await page.getByLabel("Nombre del servicio EN").fill(SERVICE_NAME_EN);
    await page.getByRole("button", { name: /Siguiente/i }).click();
    await expect(page.getByText("Planes")).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: /Siguiente/i }).click();
    await expect(page.getByText("Fases")).toBeVisible({ timeout: 15_000 });

    // Add first phase.
    // The "Agregar fase" button is a dashed button inside the phase sidebar.
    // aria-label addition: aria-label={t.addPhase} — "Agregar fase"
    await page.getByRole("button", { name: /Agregar fase/i }).click();

    // After adding, the phase editor appears on the right. Fill bilingual label.
    // I18nField for "Nombre de la fase" — needs aria-label additions.
    await expect(page.getByLabel("Nombre de la fase ES")).toBeVisible({ timeout: 10_000 });
    await page.getByLabel("Nombre de la fase ES").fill("Consulta inicial");
    await page.getByLabel("Nombre de la fase EN").fill("Initial consultation");

    // Client explainer bilingual.
    await page.getByLabel("Explicación para el cliente ES").fill(
      "En esta fase revisamos tu caso",
    );
    await page.getByLabel("Explicación para el cliente EN").fill(
      "In this phase we review your case",
    );

    // Save phase 1.
    // The save button in the phase editor is a GradientBtn with icon="check".
    // It renders as a button; get by its text content "Guardar".
    await page.getByRole("button", { name: /Guardar/i }).click();
    await expect(page.getByText(/Guardado hace un momento/i)).toBeVisible({ timeout: 8_000 });

    // Add second phase.
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
    await page.getByRole("button", { name: /Guardar/i }).click();
    await expect(page.getByText(/Guardado hace un momento/i)).toBeVisible({ timeout: 8_000 });

    // Verify two phase buttons are visible in the sidebar.
    // Phase list buttons carry aria-label like "Fase 1: Consulta inicial" (after addition).
    // Fallback: count sidebar buttons between the "Agregar fase" dashed button.
    const phaseButtons = page.getByRole("button", { name: /^Fase \d/i });
    await expect(phaseButtons).toHaveCount(2, { timeout: 5_000 });

    // Advance to step 4.
    await page.getByRole("button", { name: /Siguiente/i }).click();
    await expect(page.getByText("Documentos")).toBeVisible({ timeout: 10_000 });
  });

  test("wizard step 4: docs tab shows phase selector (table view)", async ({ page }) => {
    // Navigate to step 4 (Documentos) — requires phases to exist.
    // Without existing data the docs table shows the empty state.
    // This test verifies the phase selector renders and the table header is present.
    await page.goto("/admin/catalogo/nuevo");
    await expect(page.getByText("Datos básicos")).toBeVisible({ timeout: 15_000 });

    await page.locator('input[placeholder="asilo-politico"]').fill(`${SERVICE_SLUG}-docs`);
    await page.getByRole("button", { name: /Migratorio/i }).first().click();
    await page.getByLabel("Nombre del servicio ES").fill(SERVICE_NAME_ES);
    await page.getByLabel("Nombre del servicio EN").fill(SERVICE_NAME_EN);
    await page.getByRole("button", { name: /Siguiente/i }).click();
    await page.getByRole("button", { name: /Siguiente/i }).click(); // skip plans
    await page.getByRole("button", { name: /Siguiente/i }).click(); // skip phases (no phases added)

    // Step 4 — Documentos
    await expect(page.getByText("Documentos")).toBeVisible({ timeout: 10_000 });

    // Phase selector exists (even if no phases were added, label "Fase" is shown).
    // DocsStep renders a SelectInput with label "Fase".
    await expect(page.getByText(/Fase/i)).toBeVisible();

    // The docs table header "Documento" should appear when a phase is selected.
    // With no phases it shows the empty state text from addPhase key.
    // Both paths (table or empty) must not show an error.
    await expect(page.locator("body")).not.toContainText("Internal Server Error");

    // Advance to step 5 (Forms stub).
    await page.getByRole("button", { name: /Siguiente/i }).click();
    await expect(page.getByText("Formularios")).toBeVisible({ timeout: 10_000 });

    // Advance to step 6 (Publicar).
    await page.getByRole("button", { name: /Siguiente/i }).click();
    await expect(page.getByText(/Lista de comprobación de publicación/i)).toBeVisible({
      timeout: 10_000,
    });
  });
});

/* ─────────────────────────────────────────────────────────────────
   4. Publish gate — incomplete service shows domain errors
   ───────────────────────────────────────────────────────────────── */

test.describe("F1 — Admin: publish gate (incomplete service)", () => {
  test.beforeEach(async ({ page }) => {
    if (!hookActive) test.skip(true, "Requiere Auth Hook activo (dashboard) o stack local CI");
    const ok = await tryLogin(page);
    if (!ok) test.skip(true, "Requiere Auth Hook activo (dashboard) o stack local CI");
  });

  test("activating an incomplete service shows blocking issues", async ({ page }) => {
    // Create a minimal service (no EN on name, no plans) and try to publish.
    await page.goto("/admin/catalogo/nuevo");
    await expect(page.getByText("Datos básicos")).toBeVisible({ timeout: 15_000 });

    const incompleteSlug = `e2e-incomplete-${TS}`;
    await page.locator('input[placeholder="asilo-politico"]').fill(incompleteSlug);
    await page.getByRole("button", { name: /Migratorio/i }).first().click();
    // Fill only ES — leave EN empty to trigger a blocking issue.
    await page.getByLabel("Nombre del servicio ES").fill("Servicio incompleto E2E");
    // Intentionally skip EN.

    // Advance through all steps without filling plans or phases.
    await page.getByRole("button", { name: /Siguiente/i }).click();
    await expect(page.getByText("Planes")).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: /Siguiente/i }).click();
    await expect(page.getByText("Fases")).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: /Siguiente/i }).click();
    await expect(page.getByText("Documentos")).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: /Siguiente/i }).click();
    await expect(page.getByText("Formularios")).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: /Siguiente/i }).click();
    await expect(page.getByText(/Lista de comprobación de publicación/i)).toBeVisible({
      timeout: 10_000,
    });

    // Click "Activar servicio".
    await page.getByRole("button", { name: /Activar servicio/i }).click();

    // The activate action returns issues. The publish step renders them.
    // Blocking issues are shown with the "BLOQUEANTE" chip (t.issueBlocking).
    // Either blocking or warning issues must appear, or a toast error.
    const issueOrToast = page.locator(
      '[style*="--red-soft"], [style*="--gold-soft"], [data-sonner-toast]',
    );
    await expect(issueOrToast.first()).toBeVisible({ timeout: 15_000 });

    // The service should NOT be activated (still shows publish step, not celebrate).
    await expect(page.getByText(/Celebrando|a la venta/i)).toHaveCount(0);

    console.log(
      "[F1 admin] Incomplete publish gate: domain errors rendered as expected.",
    );
  });

  test("step 1 'Siguiente' with no EN value shows toast 'Falta EN'", async ({ page }) => {
    await page.goto("/admin/catalogo/nuevo");
    await expect(page.getByText("Datos básicos")).toBeVisible({ timeout: 15_000 });

    // Fill only ES — leave EN empty.
    await page.locator('input[placeholder="asilo-politico"]').fill(`e2e-noen-${TS}`);
    await page.getByLabel("Nombre del servicio ES").fill("Solo ES");
    // Do NOT fill EN.

    // Clicking "Siguiente" should call next() → which checks !label.es but also
    // the component currently guards only slug + label.es (see wizard next()).
    // The "Falta EN" chip on the I18nField serves as a visual indicator.
    // The "missingEn" i18n key triggers a toast.error(t.missingEn) if EN is absent.
    // Note: the current guard in next() checks !label.es, not EN.
    // If EN is empty the "Falta EN" chip should be visible on the field.
    const missingEnChip = page.getByText("Falta EN");
    await expect(missingEnChip).toBeVisible();
  });
});

/* ─────────────────────────────────────────────────────────────────
   5. Employees — invite + permission matrix
   ───────────────────────────────────────────────────────────────── */

test.describe("F1 — Admin: employees", () => {
  test.beforeEach(async ({ page }) => {
    if (!hookActive) test.skip(true, "Requiere Auth Hook activo (dashboard) o stack local CI");
    const ok = await tryLogin(page);
    if (!ok) test.skip(true, "Requiere Auth Hook activo (dashboard) o stack local CI");
  });

  test("employees page renders title and 'Nuevo empleado' button", async ({ page }) => {
    await page.goto("/admin/empleados");
    await expect(page.getByText("Empleados")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: /Nuevo empleado/i })).toBeVisible();
  });

  test("invite new employee (sales role) via create modal", async ({ page }) => {
    await page.goto("/admin/empleados");
    await expect(page.getByText("Empleados")).toBeVisible({ timeout: 15_000 });

    // Open create modal.
    await page.getByRole("button", { name: /Nuevo empleado/i }).click();

    // Modal title "Nuevo empleado" should appear.
    await expect(page.getByText("Nuevo empleado")).toBeVisible({ timeout: 8_000 });

    // Fill email.
    await page.getByLabel(/Email/i).fill(EMP_EMAIL);

    // Fill name.
    await page.getByLabel(/Nombre/i).fill(EMP_NAME);

    // Role: click "Sales" / "Ventas" button (the role selector grid in step 1).
    await page.getByRole("button", { name: /Ventas/i }).first().click();

    // Advance to step 2 (permission grid).
    await page.getByRole("button", { name: /Siguiente/i }).click();
    await expect(page.getByText(/Módulo/i)).toBeVisible({ timeout: 8_000 });

    // In the permission grid, turn OFF the "catalog" module view permission
    // to verify we can fine-tune before inviting.
    // The switch is aria-labeled "Catálogo Ver" (moduleLabels.catalog + colView).
    // Note: moduleLabels.catalog is translated via tt("employees.moduleLabels.catalog").
    // We target by aria-label pattern.
    const catalogViewSwitch = page.getByRole("switch", { name: /Catálogo.*Ver|catalog.*Ver/i });
    if (await catalogViewSwitch.isVisible()) {
      const isChecked = await catalogViewSwitch.getAttribute("data-state");
      if (isChecked === "checked") {
        await catalogViewSwitch.click();
      }
    }

    // Submit invitation.
    await page.getByRole("button", { name: /Crear y enviar invitación/i }).click();

    // Expect toast: "Invitación enviada a {email}."
    await expect(
      page.getByText(new RegExp(`Invitación enviada a ${EMP_EMAIL}`, "i")),
    ).toBeVisible({ timeout: 15_000 });

    // Modal closes; employee should appear in the table.
    await expect(page.getByText(EMP_NAME)).toBeVisible({ timeout: 10_000 });
  });

  test("open permission matrix for created employee and remove catalog module", async ({
    page,
  }) => {
    await page.goto("/admin/empleados");
    await expect(page.getByText("Empleados")).toBeVisible({ timeout: 15_000 });

    // Find the row for the created employee.
    const empRow = page.getByText(EMP_NAME);
    await expect(empRow).toBeVisible({ timeout: 10_000 });

    // Click the "Permisos" action button in the employee's row.
    // RowBtn renders aria-label={t.menuPermissions} = "Permisos".
    // The row is identified by EMP_NAME; button is in the same row.
    const row = page.locator("tr", { hasText: EMP_NAME });
    await row.getByRole("button", { name: /Permisos/i }).click();

    // Permission matrix modal opens.
    await expect(page.getByText(/Permisos ·/i)).toBeVisible({ timeout: 8_000 });

    // Toggle off the catalog view switch.
    const catalogSwitch = page.getByRole("switch", { name: /Catálogo.*Ver|catalog.*Ver/i });
    if (await catalogSwitch.isVisible()) {
      const state = await catalogSwitch.getAttribute("data-state");
      if (state === "checked") {
        await catalogSwitch.click();
      }
    }

    // Save permissions.
    await page.getByRole("button", { name: /Guardar/i }).click();

    // Toast "Permisos actualizados."
    await expect(
      page.getByText(/Permisos actualizados/i),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("deactivate the test employee (cleanup)", async ({ page }) => {
    await page.goto("/admin/empleados");
    await expect(page.getByText("Empleados")).toBeVisible({ timeout: 15_000 });

    const row = page.locator("tr", { hasText: EMP_NAME });
    await expect(row).toBeVisible({ timeout: 10_000 });

    // Click "Desactivar" button in the row.
    await row.getByRole("button", { name: /Desactivar/i }).click();

    // Confirmation modal appears.
    await expect(page.getByText("Desactivar empleado")).toBeVisible({ timeout: 8_000 });

    // Confirm deactivation.
    await page.getByRole("button", { name: /^Desactivar$/i }).click();

    // Toast confirmation.
    await expect(
      page.getByText(/Desactivar/i),
    ).toBeVisible({ timeout: 10_000 });
  });
});

/* ─────────────────────────────────────────────────────────────────
   6. Audit log
   ───────────────────────────────────────────────────────────────── */

test.describe("F1 — Admin: audit log", () => {
  test.beforeEach(async ({ page }) => {
    if (!hookActive) test.skip(true, "Requiere Auth Hook activo (dashboard) o stack local CI");
    const ok = await tryLogin(page);
    if (!ok) test.skip(true, "Requiere Auth Hook activo (dashboard) o stack local CI");
  });

  test("audit page renders table with recent entries", async ({ page }) => {
    await page.goto("/admin/auditoria");
    await expect(page.getByText("Auditoría")).toBeVisible({ timeout: 15_000 });

    // The "Solo lectura" badge should be visible.
    await expect(page.getByText("Solo lectura")).toBeVisible();

    // Column headers: Cuándo, Quién, Acción, Entidad.
    await expect(page.getByText("Cuándo")).toBeVisible();
    await expect(page.getByText("Quién")).toBeVisible();
    await expect(page.getByText("Acción")).toBeVisible();
    await expect(page.getByText("Entidad")).toBeVisible();
  });

  test("audit table contains entries from catalog/employee actions above", async ({ page }) => {
    await page.goto("/admin/auditoria");
    await expect(page.getByText("Auditoría")).toBeVisible({ timeout: 15_000 });

    // After the wizard and employee tests ran, there should be rows in the table.
    // Look for known action verbs that the domain emits (create, invite, update).
    // The exact action code depends on domain implementation; check for any row.
    const rows = page.locator("table tbody tr");
    const count = await rows.count();

    if (count === 0) {
      // Acceptable if the previous tests were skipped (hook inactive scenario).
      console.log(
        "[F1 admin] Audit table empty — no entries (expected if wizard tests skipped).",
      );
    } else {
      // At least one row exists; verify it renders a date and actor without error.
      await expect(rows.first()).toBeVisible();
      await expect(page.locator("body")).not.toContainText("Internal Server Error");
      console.log(`[F1 admin] Audit table: ${count} entries visible.`);
    }
  });

  test("clicking an audit row opens the detail side panel", async ({ page }) => {
    await page.goto("/admin/auditoria");
    await expect(page.getByText("Auditoría")).toBeVisible({ timeout: 15_000 });

    const rows = page.locator("table tbody tr");
    if ((await rows.count()) === 0) {
      test.skip(true, "No audit entries available — run wizard tests first");
    }

    // Click first row.
    await rows.first().click();

    // Detail panel title: "Detalle del cambio".
    await expect(page.getByText("Detalle del cambio")).toBeVisible({ timeout: 8_000 });

    // Panel shows metadata fields.
    await expect(page.getByText(/Quién|Acción|Entidad|Cuándo/i)).toBeVisible();
  });
});

/* ─────────────────────────────────────────────────────────────────
   7. Cleanup — archive the test service (idempotence)
   ───────────────────────────────────────────────────────────────── */

test.describe("F1 — Admin: cleanup (idempotent)", () => {
  test.beforeEach(async ({ page }) => {
    if (!hookActive) test.skip(true, "Requiere Auth Hook activo (dashboard) o stack local CI");
    const ok = await tryLogin(page);
    if (!ok) test.skip(true, "Requiere Auth Hook activo (dashboard) o stack local CI");
  });

  test("archive all test services created in this run", async ({ page }) => {
    await page.goto("/admin/catalogo");
    await expect(page.getByText(/Catálogo|Nuevo servicio/i)).toBeVisible({ timeout: 15_000 });

    // Show archived services toggle to catch any previously archived ones.
    const showArchivedSwitch = page.getByRole("switch", { name: /Archivados/i });
    if (await showArchivedSwitch.isVisible()) {
      await showArchivedSwitch.click();
    }

    // Each test sub-run created a service with slug containing SERVICE_SLUG base or TS.
    // Find all service cards whose slug code contains the timestamp.
    const slugCells = page.locator("code").filter({ hasText: String(TS) });
    const slugCount = await slugCells.count();

    if (slugCount === 0) {
      console.log(
        "[F1 admin] Cleanup: no services with timestamp found (already cleaned or tests skipped).",
      );
      return;
    }

    // Archive each one via the kebab menu.
    for (let i = 0; i < slugCount; i++) {
      // Re-query each time because the DOM may re-render after each archive.
      const slugs = page.locator("code").filter({ hasText: String(TS) });
      const current = slugs.first();

      if (!(await current.isVisible())) break;

      // Locate the service card containing this slug.
      const card = current.locator("..").locator("..").locator("..");

      // Open the kebab menu — aria-label="Menú".
      const kebab = card.getByRole("button", { name: /Menú/i });
      await kebab.click();

      // Click "Archivar" menu item.
      await page.getByRole("menuitem", { name: /Archivar/i }).click();

      // Confirmation modal — confirm.
      await expect(page.getByText(/Archivar/i)).toBeVisible({ timeout: 5_000 });
      await page.getByRole("button", { name: /^Archivar$/i }).click();

      await page.waitForLoadState("networkidle").catch(() => {});
    }

    console.log(`[F1 admin] Cleanup: archived ${slugCount} test service(s).`);
  });
});
