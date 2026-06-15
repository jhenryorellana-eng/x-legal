/**
 * F4 QA visual + axe — client form runtime (DOC-81 §5, RNF-037).
 * Mobile viewport (390×844, carlos project). Light + dark baselines + axe.
 */

import { test } from "@playwright/test";
import { snapshotThemes } from "../helpers/visual";

test.describe.configure({ timeout: 120_000 });

const CASE_ID = "00000000-0000-0000-0000-000000000302";
const I589_FORM_ID = "2cacca73-0526-4326-bebc-2b3fe58cb64c";

test.describe("F4 visual — client", () => {
  test("I-589 wizard runtime", async ({ page }) => {
    await page.goto(`/caso/${CASE_ID}/formulario/${I589_FORM_ID}`);
    await page.getByRole("heading", { name: /Formulario I-589/i }).waitFor({ timeout: 20_000 });
    await snapshotThemes(page, { name: "f4-cliente-formulario" });
  });
});
