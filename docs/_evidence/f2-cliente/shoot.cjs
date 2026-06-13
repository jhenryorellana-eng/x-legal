/* Playwright evidence for F2 cliente screens (light + dark). Run with the dev
 * server up. Resolves playwright from the project node_modules. Run:
 *   node docs/_evidence/f2-cliente/shoot.cjs [baseUrl]
 */
const path = require("path");
const { chromium } = require(path.join(__dirname, "../../../node_modules/playwright"));

const BASE = process.argv[2] || "http://localhost:3001";
const OUT = __dirname;
const VIEWS = ["home", "camino", "documentos", "disclaimer", "proceso"];
const THEMES = ["light", "dark"];

const FILTER = /hydrat|caret-color|extension|Download the React DevTools|webpack-hmr|404 \(Not Found\)/i;

(async () => {
  const browser = await chromium.launch();
  let totalErrors = 0;

  for (const theme of THEMES) {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    });
    await context.addInitScript((t) => {
      try {
        localStorage.setItem("ulp-theme", t);
        localStorage.setItem("ulp-text-scale", "md");
      } catch (e) {}
    }, theme);

    for (const view of VIEWS) {
      const page = await context.newPage();
      const errors = [];
      page.on("console", (m) => {
        if (m.type() === "error" && !FILTER.test(m.text())) errors.push(m.text());
      });
      page.on("pageerror", (e) => {
        if (!FILTER.test(String(e))) errors.push(String(e));
      });

      const url = `${BASE}/cliente-preview/${view}`;
      await page.goto(url, { waitUntil: "networkidle" });
      await page.evaluate((t) => {
        document.documentElement.setAttribute("data-theme", t);
      }, theme);
      await page.waitForTimeout(900);

      const file = path.join(OUT, `${view}-${theme}.png`);
      await page.screenshot({ path: file, fullPage: true });
      console.log(`shot ${view}-${theme}.png  (console errors: ${errors.length})`);
      if (errors.length) {
        totalErrors += errors.length;
        errors.forEach((e) => console.log(`   ! ${e}`));
      }
      await page.close();
    }
    await context.close();
  }

  await browser.close();
  console.log(`\nDONE — total non-filtered console errors: ${totalErrors}`);
  process.exit(totalErrors > 0 ? 1 : 0);
})();
