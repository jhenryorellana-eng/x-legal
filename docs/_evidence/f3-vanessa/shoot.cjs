/**
 * Playwright harness — F3 Vanessa panel (8 views, light+dark).
 *
 * Renders the (dev) preview routes (no session) and captures full-page
 * screenshots in light + dark, mirroring the F1 admin / F2 cliente harnesses.
 * playwright is resolved from the project node_modules (this file lives inside
 * the repo). Filters known ambient hydration artifacts.
 *
 * Run: ENABLE_VENTAS_PREVIEW=true + dev server up, then `node docs/_evidence/f3-vanessa/shoot.cjs`.
 */
const { chromium } = require("playwright");
const path = require("path");

const BASE = process.env.BASE_URL || "http://localhost:3000";
const OUT = __dirname;

const VIEWS = [
  "mi-dia",
  "leads",
  "citas",
  "disponibilidad",
  "clientes",
  "metricas",
  "configuracion",
];

const NOISE = /hydrat|caret-color|extension|DevTools|Download the React/i;

async function shoot(page, view, theme) {
  const errors = [];
  page.on("console", (m) => {
    if (m.type() === "error" && !NOISE.test(m.text())) errors.push(m.text());
  });
  page.on("pageerror", (e) => {
    if (!NOISE.test(String(e))) errors.push(String(e));
  });

  await page.addInitScript((t) => {
    try {
      localStorage.setItem("ulp-theme", t);
    } catch (e) {}
  }, theme);

  await page.goto(`${BASE}/ventas-preview/${view}`, { waitUntil: "networkidle" });
  await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
  await page.waitForTimeout(900); // fonts + backdrop-filters settle
  const file = path.join(OUT, `${view}-${theme}.png`);
  await page.screenshot({ path: file, fullPage: true });
  return { view, theme, file: path.basename(file), errors };
}

(async () => {
  const browser = await chromium.launch();
  const results = [];
  for (const theme of ["light", "dark"]) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });
    for (const view of VIEWS) {
      const page = await ctx.newPage();
      results.push(await shoot(page, view, theme));
      await page.close();
    }
    await ctx.close();
  }
  await browser.close();

  let totalErrors = 0;
  for (const r of results) {
    totalErrors += r.errors.length;
    console.log(`${r.errors.length === 0 ? "OK " : "ERR"} ${r.file}${r.errors.length ? " :: " + r.errors.join(" | ") : ""}`);
  }
  console.log(`\n${results.length} screenshots, ${totalErrors} console errors`);
  process.exit(totalErrors > 0 ? 1 : 0);
})();
