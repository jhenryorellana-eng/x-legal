/**
 * F4 admin surfaces — the screens the IA-engine + catalog editor phase delivers.
 *
 * Render + integrity coverage with real data and no console errors:
 *   - Catalog wizard ("Nuevo servicio") — the §4.6 "prueba de fuego" entry point
 *     (service-as-config: 6 steps Datos básicos → Publicar).
 *   - Form editor (pdf_automation) — the most complex admin screen, on the
 *     published I-589 (460 detected AcroForm fields, 4 stages).
 *   - AI costs dashboard + Datasets (with the anti-PII guard).
 *
 * The full create→publish→activate journey (§4.6 mutating steps) is authored for
 * the ephemeral CI DB (DOC-81 §6); here we cover the live-data render paths.
 */

import { test, expect } from "@playwright/test";
import { collectConsoleErrors } from "../helpers/console";

const ASILO_SERVICE_ID = "7fea2d11-b5ef-42ef-8f5d-d314b8dd6cb0";
const I589_FORM_ID = "2cacca73-0526-4326-bebc-2b3fe58cb64c";

test.describe("F4 admin surfaces", () => {
  test("catalog 'Nuevo servicio' wizard renders the 6 steps (prueba de fuego entry)", async ({ page }) => {
    const errors = collectConsoleErrors(page);

    await page.goto("/admin/catalogo/nuevo");

    await expect(page.getByRole("heading", { name: "Nuevo servicio" })).toBeVisible({ timeout: 20_000 });
    // The product promise: catalog-as-config, never as code.
    await expect(page.getByText(/nunca como código/i)).toBeVisible();
    for (const step of ["Datos básicos", "Planes", "Fases", "Documentos", "Formularios", "Publicar"]) {
      await expect(page.getByText(step, { exact: true }).first()).toBeVisible();
    }
    await expect(page.getByRole("button", { name: "Siguiente" })).toBeVisible();

    expect(errors(), `console errors:\n${errors().join("\n")}`).toEqual([]);
  });

  test("pdf_automation form editor renders the published I-589 with its stages + field count", async ({ page }) => {
    const errors = collectConsoleErrors(page);

    await page.goto(`/admin/catalogo/${ASILO_SERVICE_ID}/formularios/${I589_FORM_ID}`);

    await expect(page.getByRole("heading", { name: /Formulario I-589/i })).toBeVisible({ timeout: 25_000 });
    await expect(page.getByText("PDF oficial").first()).toBeVisible();
    // The 4 editor stages.
    for (const stage of ["Subir PDF", "Estructurar", "Previsualizar", "Publicar"]) {
      await expect(page.getByRole("button", { name: new RegExp(stage, "i") }).first()).toBeVisible();
    }
    // Detected AcroForm fields surfaced (mupdf detected 460 on the I-589).
    await expect(page.getByText(/de 460 campos/i)).toBeVisible();

    expect(errors(), `console errors:\n${errors().join("\n")}`).toEqual([]);
  });

  test("AI costs dashboard renders budget KPIs", async ({ page }) => {
    const errors = collectConsoleErrors(page);

    await page.goto("/admin/ai-costs");

    await expect(page.getByRole("heading", { name: "Costes IA" })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("Gasto del mes")).toBeVisible();
    await expect(page.getByText("Presupuesto", { exact: true })).toBeVisible();
    await expect(page.getByText("Uso del presupuesto", { exact: true })).toBeVisible();

    expect(errors(), `console errors:\n${errors().join("\n")}`).toEqual([]);
  });

  test("Datasets screen renders with the anti-PII guard", async ({ page }) => {
    const errors = collectConsoleErrors(page);

    await page.goto("/admin/datasets");

    await expect(page.getByRole("button", { name: "Nuevo dataset" }).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/Nunca subas PII/i)).toBeVisible();

    expect(errors(), `console errors:\n${errors().join("\n")}`).toEqual([]);
  });
});
