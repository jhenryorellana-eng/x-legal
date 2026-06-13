/**
 * Playwright screenshot harness for the F2 mobile components (DOC-01 §5.2).
 *
 * Lives under docs/_evidence (scripts/ is owned by another agent). Shoots the
 * public /design showcase, scrolls to the "Mobile" section, and captures it in
 * light + dark. Also exercises the interactive overlays (BottomSheet drag-sheet
 * + Tutorial coach-marks) and a mobile-viewport sanity shot. Records
 * console/page errors and writes PNGs alongside.
 *
 * Run from the repo root (dev server on http://localhost:3000):
 *   node docs/_evidence/f2-mobile/shoot.cjs
 */

const { chromium } = require("playwright");
const path = require("path");

const BASE = process.env.BASE_URL || "http://localhost:3000";
const OUT = __dirname;
const THEMES = ["light", "dark"];

const IGNORE = /hydrat|caret-color|extension/i;

function wireErrors(page, sink) {
  page.on("console", (msg) => {
    if (msg.type() === "error") sink.push(msg.text());
  });
  page.on("pageerror", (err) => sink.push(`pageerror: ${err.message}`));
  page.on("requestfailed", (req) =>
    sink.push(`requestfailed: ${req.url()} (${req.failure()?.errorText})`),
  );
}

async function gotoDesign(page, theme) {
  await page.goto(`${BASE}/design`, { waitUntil: "networkidle" });
  await page.evaluate((t) => {
    document.documentElement.setAttribute("data-theme", t);
  }, theme);
  await page.waitForTimeout(900); // fonts + backdrop filters settle
}

(async () => {
  const browser = await chromium.launch();
  const allErrors = [];

  // ── Desktop captures of the Mobile section (light + dark) ──────────────
  for (const theme of THEMES) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      deviceScaleFactor: 1,
    });
    await context.addInitScript((t) => {
      try {
        window.localStorage.setItem("ulp-theme", t);
      } catch (e) {}
    }, theme);

    const page = await context.newPage();
    const errors = [];
    wireErrors(page, errors);
    await gotoDesign(page, theme);

    // Scroll the "Mobile" heading into view and frame the section.
    const heading = page
      .locator("h2", { hasText: /Móvil|Mobile/ })
      .first();
    await heading.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);

    // Section = the heading's parent <section>; screenshot just that element.
    const section = page
      .locator("section", { has: heading })
      .first();
    await section.screenshot({
      path: path.join(OUT, `mobile-section-${theme}.png`),
    });
    console.log(`OK mobile-section (${theme})`);

    // Also a full-page shot for context.
    await page.screenshot({
      path: path.join(OUT, `design-full-${theme}.png`),
      fullPage: true,
    });

    const real = errors.filter((e) => !IGNORE.test(e));
    if (real.length) allErrors.push({ shot: `mobile-section`, theme, errors: real });
    await page.close();
    await context.close();
  }

  // ── Interactive overlays (light) — BottomSheet + Tutorial ──────────────
  {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      deviceScaleFactor: 1,
    });
    await context.addInitScript(() => {
      try { window.localStorage.setItem("ulp-theme", "light"); } catch (e) {}
    });
    const page = await context.newPage();
    const errors = [];
    wireErrors(page, errors);
    await gotoDesign(page, "light");

    // BottomSheet
    await page.locator("button", { hasText: /Abrir hoja|Open sheet/ }).first().click();
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(OUT, "bottom-sheet.png") });
    console.log("OK bottom-sheet (light)");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);

    // Tutorial
    await page.locator("button", { hasText: /Ver tutorial|Show tutorial/ }).first().click();
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(OUT, "tutorial.png") });
    console.log("OK tutorial (light)");
    await page.keyboard.press("Escape");

    const real = errors.filter((e) => !IGNORE.test(e));
    if (real.length) allErrors.push({ shot: "overlays", theme: "light", errors: real });
    await page.close();
    await context.close();
  }

  // ── Mobile-viewport sanity (390px) — the section on a phone ────────────
  {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
    });
    await context.addInitScript(() => {
      try { window.localStorage.setItem("ulp-theme", "light"); } catch (e) {}
    });
    const page = await context.newPage();
    const errors = [];
    wireErrors(page, errors);
    await gotoDesign(page, "light");
    const heading = page.locator("h2", { hasText: /Móvil|Mobile/ }).first();
    await heading.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    const section = page.locator("section", { has: heading }).first();
    await section.screenshot({ path: path.join(OUT, "mobile-section-390.png") });
    console.log("OK mobile-section (390)");
    const real = errors.filter((e) => !IGNORE.test(e));
    if (real.length) allErrors.push({ shot: "mobile-390", theme: "light", errors: real });
    await page.close();
    await context.close();
  }

  await browser.close();

  if (allErrors.length) {
    console.log("\nConsole/page errors detected:");
    for (const e of allErrors) console.log(`  [${e.shot}/${e.theme}]`, e.errors);
    process.exitCode = 1;
  } else {
    console.log("\nNo console/page errors across captures (light + dark).");
  }
})();
