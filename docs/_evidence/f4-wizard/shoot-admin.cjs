/* eslint-disable */
/**
 * Captures the ADMIN form-editor preview stage — proving the editor's "preview
 * fiel" now uses the SHARED FormWizard engine (SOT-3 drop-in). Desktop 1440×960.
 */
const { chromium } = require("playwright");
const path = require("path");

const BASE = process.argv[2] || "http://localhost:3000";
const OUT = __dirname;
const IGNORE = /hydrat|caret-color|extension|DevTools|preload|pdf\.worker|fake worker|workerSrc/i;

(async () => {
  const browser = await chromium.launch();
  for (const theme of ["light", "dark"]) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 960 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on("console", (m) => {
      if (m.type() === "error" && !IGNORE.test(m.text())) errors.push(m.text());
    });
    page.on("pageerror", (e) => {
      if (!IGNORE.test(String(e))) errors.push(String(e));
    });
    await page.addInitScript((t) => {
      try { localStorage.setItem("ulp-theme", t); } catch {}
    }, theme);
    await page.goto(`${BASE}/admin-preview/form-editor-pdf`, { waitUntil: "networkidle" });
    await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
    await page.waitForTimeout(700);
    // Click the "Previsualizar" stage in the stage bar.
    const prev = page.getByText("Previsualizar", { exact: false }).first();
    if (await prev.count()) {
      await prev.click().catch(() => {});
      await page.waitForTimeout(1200);
    }
    const file = path.join(OUT, `admin-preview-cabled-${theme}.png`);
    await page.screenshot({ path: file, fullPage: false });
    console.log(`admin preview (${theme}) errors=${errors.length}`, errors);
    await page.close();
    await ctx.close();
  }
  await browser.close();
  process.exit(0);
})();
