/**
 * F4 §4.3 (client side) — the form-wizard runtime renders for the client.
 *
 * Carlos (U26-000002, asilo) has the published I-589 pdf_automation form.
 * In the persistent demo DB this response is already submitted, so the runtime
 * shows the "received" confirmation. We assert the wizard route renders the form
 * with no console errors (regression coverage of the client form runtime).
 *
 * NOTE: the full fresh fill→autosave→submit journey (DOC-81 §4.3 steps 1-2)
 * mutates data and is authored against the ephemeral CI DB (DOC-81 §6); here we
 * cover the live-data render path.
 */

import { test, expect } from "@playwright/test";
import { collectConsoleErrors } from "../helpers/console";

const CASE_ID = "00000000-0000-0000-0000-000000000302";
const I589_FORM_ID = "2cacca73-0526-4326-bebc-2b3fe58cb64c";

test.describe("F4 §4.3 — client form runtime (Carlos)", () => {
  test("renders the I-589 wizard route without console errors", async ({ page }) => {
    const errors = collectConsoleErrors(page);

    await page.goto(`/caso/${CASE_ID}/formulario/${I589_FORM_ID}`);

    // The form title is rendered whether the wizard is editable or already submitted.
    await expect(page.getByRole("heading", { name: /Formulario I-589/i })).toBeVisible({
      timeout: 20_000,
    });

    // Runtime shows a coherent state: editable wizard OR the submitted confirmation.
    const submitted = page.getByText(/Lo recibimos|Enviado/i).first();
    const wizardField = page.getByRole("button", { name: /Siguiente|Continuar|Enviar/i }).first();
    await expect(submitted.or(wizardField)).toBeVisible({ timeout: 20_000 });

    expect(errors(), `console errors:\n${errors().join("\n")}`).toEqual([]);
  });

  test("the Formularios case tab resolves without crashing", async ({ page }) => {
    const errors = collectConsoleErrors(page);

    await page.goto(`/caso/${CASE_ID}/formularios`);
    // Phase-scoped: lands on the list, a single-form redirect, or the empty state —
    // any of which must render the case nav (no crash / error boundary).
    await expect(page.getByRole("navigation", { name: /Navegación del caso/i })).toBeVisible({
      timeout: 20_000,
    });

    expect(errors(), `console errors:\n${errors().join("\n")}`).toEqual([]);
  });
});
