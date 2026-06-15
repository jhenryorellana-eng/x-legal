/**
 * E2E visual helper (DOC-81 §5). Captures a screen in light AND dark, runs the
 * axe-core gate on each (RNF-037), and snapshots against the committed baseline.
 *
 * Theme is the live `data-theme` attribute on <html> (theme.ts); setting it +
 * the `ulp-theme` localStorage key applies the palette instantly (no reload).
 */

import { expect, type Page } from "@playwright/test";
import { expectNoSeriousA11yViolations } from "./a11y";

/** Captures light+dark screenshots of the current page and gates a11y on each. */
export async function snapshotThemes(
  page: Page,
  opts: { name: string; settleMs?: number },
): Promise<void> {
  for (const theme of ["light", "dark"] as const) {
    await page.evaluate((t) => {
      localStorage.setItem("ulp-theme", t);
      document.documentElement.setAttribute("data-theme", t);
    }, theme);

    // Let entrance animations settle (DOC-81 §5: animation-delay ≤ 0.75s).
    await page.waitForTimeout(opts.settleMs ?? 900);

    await expectNoSeriousA11yViolations(page, `${opts.name}-${theme}`);

    await expect(page).toHaveScreenshot(`${opts.name}-${theme}.png`, {
      maxDiffPixelRatio: 0.02,
      animations: "disabled",
    });
  }
}
