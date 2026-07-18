/**
 * Lex tab — the case AI chat for staff (admin surface).
 *
 * Flow: open a seeded case workspace → the "Lex" tab renders → empty state with
 * the 3 clickable suggestions → send "Hazme un resumen del caso" → optimistic
 * "Lex está escribiendo…" placeholder → with AI_E2E_STUB=1 (npm run dev:e2e)
 * the local-dispatch job answers deterministically, so the placeholder resolves
 * to the stub answer and the sources section appears.
 *
 * Runs under the "admin" Playwright project (storageState e2e/.auth/admin.json),
 * following the filename-suffix convention of the neighbouring staff specs.
 * Re-runnable: after the first run the thread is persisted, so the empty state
 * no longer shows — the spec then sends the same question via the composer.
 */

import { test, expect } from "@playwright/test";
import { collectConsoleErrors } from "../helpers/console";

// Seeded demo case U26-000002 (supabase/seeds/03_demo.sql) — same case the F4
// staff specs use; accessible to the admin role.
const CASE_ID = "00000000-0000-0000-0000-000000000302";
const QUESTION = "Hazme un resumen del caso";

test.describe("Lex tab — case AI chat (admin)", () => {
  test("empty state → suggestion → deterministic stub answer with sources", async ({ page }) => {
    // The answer is produced by an async job; polling can take up to ~90s.
    test.setTimeout(150_000);
    const errors = collectConsoleErrors(page);

    await page.goto(`/admin/casos/${CASE_ID}`);

    // The tab bar exposes the Lex tab for staff; clicking it opens the chat.
    const lexTab = page.getByRole("tab", { name: "Lex", exact: true });
    await expect(lexTab).toBeVisible({ timeout: 20_000 });
    await lexTab.click();

    // Fresh thread → empty state with the clickable suggestions. A returning
    // thread (re-run) already has messages → send via the composer instead.
    const suggestion = page.getByRole("button", { name: QUESTION });
    const isFreshThread = await suggestion
      .waitFor({ state: "visible", timeout: 20_000 })
      .then(() => true)
      .catch(() => false);

    if (isFreshThread) {
      await expect(page.getByText("Pregúntale a Lex sobre este caso")).toBeVisible();
      await expect(page.getByRole("button", { name: "¿Qué documentos ha subido el cliente?" })).toBeVisible();
      await expect(page.getByRole("button", { name: "¿Cuál es el estado del caso?" })).toBeVisible();
      await suggestion.click();
    } else {
      const composer = page.getByPlaceholder("Escribe tu pregunta…");
      await composer.fill(QUESTION);
      await composer.press("Enter");
    }

    // Optimistic UI: the staff question + the typing placeholder.
    await expect(page.getByText(QUESTION).first()).toBeVisible();
    await expect(page.getByText("Lex está escribiendo…")).toBeVisible();

    // The stub-backed job answers deterministically; the placeholder resolves
    // to an assistant bubble containing the stub marker.
    await expect(page.getByText(/stub/i).first()).toBeVisible({ timeout: 90_000 });
    await expect(page.getByText("Lex está escribiendo…")).toBeHidden();

    // The answer cites its sources.
    await expect(page.getByText("Fuentes").first()).toBeVisible();

    expect(errors(), `console errors:\n${errors().join("\n")}`).toEqual([]);
  });
});
