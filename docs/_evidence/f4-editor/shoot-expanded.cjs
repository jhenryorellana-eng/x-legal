/* eslint-disable */
/** One-off: capture the form editor with a question card expanded (origin selector + ES|EN). */
const { chromium } = require("playwright");
const path = require("path");
const BASE = process.env.BASE_URL || "http://localhost:3000";

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/admin-preview/form-editor-pdf`, { waitUntil: "networkidle" });
  // Expand the first question card (the profile-source one).
  await page.getByText("¿Cuál es tu nombre completo", { exact: false }).first().click();
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(__dirname, "form-editor-pdf-expanded.png"), fullPage: true });
  console.log("✓ form-editor-pdf-expanded.png");
  await browser.close();
})();
