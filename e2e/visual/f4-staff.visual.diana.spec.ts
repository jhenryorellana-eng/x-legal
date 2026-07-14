/**
 * F4 QA visual + axe — staff form approval screen (DOC-81 §5, RNF-037).
 * Desktop viewport (1440×900, diana project). Light + dark baselines + axe.
 */

import { test } from "@playwright/test";
import { snapshotThemes } from "../helpers/visual";

test.describe.configure({ timeout: 120_000 });

const CASE_ID = "00000000-0000-0000-0000-000000000302";

test.describe("F4 visual — staff approval", () => {
  test("Case forms approval screen", async ({ page }) => {
    await page.goto(`/admin/casos/${CASE_ID}/formularios`);
    await page.getByRole("heading", { name: /Formularios · U26-000002/i }).waitFor({ timeout: 20_000 });
    await snapshotThemes(page, { name: "f4-staff-aprobacion" });
  });
});
