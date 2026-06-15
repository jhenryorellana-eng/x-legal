/**
 * F4 §4.3 (staff side) — paralegal approval + filled-PDF generation.
 *
 * Diana opens the case's forms screen, sees the submitted/approved I-589, and
 * regenerates the filled PDF (deterministic mupdf AcroForm fill — non-mutating
 * to business data). We assert the UI controls AND the backend state via the
 * service_role client: the response is approved and has a filled_pdf_path.
 */

import { test, expect } from "@playwright/test";
import { collectConsoleErrors } from "../helpers/console";
import { serviceDb } from "../helpers/db";

const CASE_ID = "00000000-0000-0000-0000-000000000302";
const I589_FORM_ID = "2cacca73-0526-4326-bebc-2b3fe58cb64c";

test.describe("F4 §4.3 — staff approval + PDF generation (Diana)", () => {
  test("lists the approved I-589 response with PDF controls + no console errors", async ({ page }) => {
    const errors = collectConsoleErrors(page);

    await page.goto(`/admin/casos/${CASE_ID}/formularios`);

    await expect(page.getByRole("heading", { name: /Formularios · ULP-2026-0002/i })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText("Formulario I-589 (partes 1-5)")).toBeVisible();
    await expect(page.getByText(/Aprobado/i).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /Regenerar PDF|Generar PDF/i })).toBeVisible();

    expect(errors(), `console errors:\n${errors().join("\n")}`).toEqual([]);
  });

  test("regenerating the filled PDF produces a stored filled_pdf_path", async ({ page }) => {
    await page.goto(`/admin/casos/${CASE_ID}/formularios`);

    const regenBtn = page.getByRole("button", { name: /Regenerar PDF|Generar PDF/i });
    await expect(regenBtn).toBeVisible({ timeout: 20_000 });
    await regenBtn.click();

    // Success signal: a "Ver PDF" link or a success toast appears (mupdf fill ~1-3s).
    const ok = page.getByRole("link", { name: /Ver PDF/i }).or(page.getByText(/PDF generado/i));
    await expect(ok.first()).toBeVisible({ timeout: 45_000 });

    // Backend assertion (service_role): the response is approved with a filled PDF.
    const db = serviceDb();
    const { data, error } = await db
      .from("case_form_responses")
      .select("status, filled_pdf_path")
      .eq("case_id", CASE_ID)
      .eq("form_definition_id", I589_FORM_ID)
      .limit(1)
      .maybeSingle();

    expect(error).toBeNull();
    expect(data?.status).toBe("approved");
    expect(data?.filled_pdf_path, "filled_pdf_path should be set after generation").toBeTruthy();
  });
});
