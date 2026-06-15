/**
 * F4 QA visual + axe — admin surfaces (DOC-81 §5, RNF-037).
 *
 * Captures light+dark baselines and asserts zero critical/serious axe
 * violations for the IA-engine + catalog-editor screens. Baselines are
 * generated with `npm run test:e2e:update` and committed.
 */

import { test } from "@playwright/test";
import { snapshotThemes } from "../helpers/visual";

// axe + 2 themes + screenshots on heavy screens (the 460-field editor) exceed 60s.
test.describe.configure({ timeout: 150_000 });

const ASILO_SERVICE_ID = "7fea2d11-b5ef-42ef-8f5d-d314b8dd6cb0";
const I589_FORM_ID = "2cacca73-0526-4326-bebc-2b3fe58cb64c";

test.describe("F4 visual — admin", () => {
  test("AI costs dashboard", async ({ page }) => {
    await page.goto("/admin/ai-costs");
    await page.getByRole("heading", { name: "Costes IA" }).waitFor({ timeout: 20_000 });
    await snapshotThemes(page, { name: "f4-ai-costs" });
  });

  test("Datasets list (empty state + anti-PII guard)", async ({ page }) => {
    await page.goto("/admin/datasets");
    await page.getByText(/Nunca subas PII/i).waitFor({ timeout: 20_000 });
    await snapshotThemes(page, { name: "f4-datasets" });
  });

  test("Catalog wizard — Nuevo servicio", async ({ page }) => {
    await page.goto("/admin/catalogo/nuevo");
    await page.getByRole("heading", { name: "Nuevo servicio" }).waitFor({ timeout: 20_000 });
    await snapshotThemes(page, { name: "f4-catalogo-nuevo" });
  });

  test("Form editor — I-589 pdf_automation", async ({ page }) => {
    await page.goto(`/admin/catalogo/${ASILO_SERVICE_ID}/formularios/${I589_FORM_ID}`);
    await page.getByRole("heading", { name: /Formulario I-589/i }).waitFor({ timeout: 25_000 });
    await snapshotThemes(page, { name: "f4-form-editor", settleMs: 1200 });
  });
});
