/* eslint-disable */
/**
 * Playwright evidence harness for F4-Ola2 (form editor / datasets / ai-costs).
 *
 * Renders the dev-only /admin-preview/[view] routes (auth-gated panel bypassed
 * via mock data) and captures desktop screenshots in light + dark. Requires the
 * dev server running with ENABLE_ADMIN_PREVIEW=true.
 *
 *   node docs/_evidence/f4-editor/shoot.cjs
 */

const { chromium } = require("playwright");
const path = require("path");

const BASE = process.env.BASE_URL || "http://localhost:3000";
const OUT = __dirname;

const VIEWS = [
  "form-editor-pdf",
  "form-editor-ai",
  "datasets",
  "dataset-detalle",
  "ai-costs",
];

const IGNORE = /hydrat|caret-color|extension|DevTools|Download the React|pdf\.worker|Setting up fake worker|workerSrc/i;

(async () => {
  const browser = await chromium.launch();
  const errors = [];

  for (const theme of ["light", "dark"]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });
    await context.addInitScript((t) => {
      try { localStorage.setItem("ulp-theme", t); } catch (e) {}
    }, theme);

    const page = await context.newPage();
    page.on("console", (m) => { if (m.type() === "error" && !IGNORE.test(m.text())) errors.push(`[${theme}] console: ${m.text()}`); });
    page.on("pageerror", (e) => { if (!IGNORE.test(String(e))) errors.push(`[${theme}] pageerror: ${e}`); });
    page.on("requestfailed", (r) => { const u = r.url(); if (!IGNORE.test(u)) errors.push(`[${theme}] reqfailed: ${u}`); });

    for (const view of VIEWS) {
      await page.goto(`${BASE}/admin-preview/${view}`, { waitUntil: "networkidle" });
      // Re-assert theme post-load (the no-flash script reads localStorage).
      await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
      await page.waitForTimeout(900);
      const file = path.join(OUT, `${view}-${theme}.png`);
      await page.screenshot({ path: file, fullPage: true });
      console.log("✓", path.basename(file));
    }
    await context.close();
  }

  await browser.close();

  if (errors.length) {
    console.log("\n--- CONSOLE/PAGE ERRORS ---");
    errors.forEach((e) => console.log(e));
    process.exitCode = 1;
  } else {
    console.log("\n✓ 0 console errors (light + dark)");
  }
})();
