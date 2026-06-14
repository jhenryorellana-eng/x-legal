/* eslint-disable */
/**
 * F4-wizard Playwright evidence (mobile 390×844).
 *
 * Captures the form wizard + Mi Historia from the dev preview harness
 * (/cliente-preview/[view]) in light + dark. No live session needed.
 *
 * Run: node docs/_evidence/f4-wizard/shoot.cjs [baseUrl]
 */
const { chromium } = require("playwright");
const path = require("path");

const BASE = process.argv[2] || process.env.BASE_URL || "http://localhost:3000";
const OUT = __dirname;

const VIEWS = ["formulario", "formulario-prefill", "historia", "formulario-enviado"];

const THEMES = ["light", "dark"];

const IGNORE = /hydrat|caret-color|extension|DevTools|Download the React|Lighthouse|preload/i;

(async () => {
  const browser = await chromium.launch();
  const results = [];

  for (const theme of THEMES) {
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    });

    for (const view of VIEWS) {
      const page = await ctx.newPage();
      const errors = [];
      page.on("console", (m) => {
        if (m.type() === "error" && !IGNORE.test(m.text())) errors.push(m.text());
      });
      page.on("pageerror", (e) => {
        if (!IGNORE.test(String(e))) errors.push(String(e));
      });

      // Inject theme BEFORE hydration.
      await page.addInitScript((t) => {
        try {
          localStorage.setItem("ulp-theme", t);
        } catch {}
      }, theme);

      const url = `${BASE}/cliente-preview/${view}`;
      await page.goto(url, { waitUntil: "networkidle" });
      // Apply data-theme post-load (the no-flash script reads localStorage).
      await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
      await page.waitForTimeout(900);

      const file = path.join(OUT, `${view}-${theme}.png`);
      await page.screenshot({ path: file, fullPage: true });
      results.push({ view, theme, errors });
      console.log(`shot ${view} (${theme})  errors=${errors.length}`);
      await page.close();
    }

    await ctx.close();
  }

  await browser.close();

  const totalErr = results.reduce((n, r) => n + r.errors.length, 0);
  console.log(`\nDONE — ${results.length} screenshots, ${totalErr} console errors`);
  for (const r of results) if (r.errors.length) console.log(`  ${r.view}/${r.theme}:`, r.errors);
  process.exit(0);
})();
