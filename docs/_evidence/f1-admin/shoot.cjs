/**
 * Playwright screenshot harness for the F1 admin screens (DOC-53).
 *
 * Lives under docs/_evidence (scripts/ is owned by another agent). Shoots the
 * dev-only preview routes (/admin-preview/[view]) — the admin panel is
 * auth-gated, so the previews render each view with mock data. Captures every
 * view in light + dark, records console/page errors, writes PNGs alongside.
 *
 * Run from the repo root (dev server on http://localhost:3000):
 *   node docs/_evidence/f1-admin/shoot.cjs
 */

const { chromium } = require("playwright");
const path = require("path");

const BASE = process.env.BASE_URL || "http://localhost:3000";
const OUT = __dirname;

const VIEWS = [
  { slug: "catalogo", name: "catalogo" },
  { slug: "nuevo-servicio", name: "catalogo-wizard" },
  { slug: "empleados", name: "empleados" },
  { slug: "auditoria", name: "auditoria" },
  { slug: "configuracion", name: "configuracion" },
];

const THEMES = ["light", "dark"];

(async () => {
  const browser = await chromium.launch();
  const allErrors = [];

  for (const theme of THEMES) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 1,
    });
    await context.addInitScript((t) => {
      try {
        window.localStorage.setItem("ulp-theme", t);
      } catch (e) {}
    }, theme);

    for (const view of VIEWS) {
      const page = await context.newPage();
      const errors = [];
      page.on("console", (msg) => {
        if (msg.type() === "error") errors.push(msg.text());
      });
      page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
      page.on("requestfailed", (req) =>
        errors.push(`requestfailed: ${req.url()} (${req.failure()?.errorText})`),
      );

      const url = `${BASE}/admin-preview/${view.slug}`;
      await page.goto(url, { waitUntil: "networkidle" });
      await page.evaluate((t) => {
        document.documentElement.setAttribute("data-theme", t);
      }, theme);
      await page.waitForTimeout(900);

      const file = path.join(OUT, `${view.name}-${theme}.png`);
      await page.screenshot({ path: file, fullPage: true });
      console.log(`OK ${view.name} (${theme})`);

      const real = errors.filter((e) => !/hydrat|caret-color|extension/i.test(e));
      if (real.length) allErrors.push({ view: view.name, theme, errors: real });

      await page.close();
    }
    await context.close();
  }

  // Mobile capture of the catalog list (responsive sanity, 390px).
  const mctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
  });
  await mctx.addInitScript(() => {
    try { window.localStorage.setItem("ulp-theme", "light"); } catch (e) {}
  });
  const mp = await mctx.newPage();
  await mp.goto(`${BASE}/admin-preview/catalogo`, { waitUntil: "networkidle" });
  await mp.waitForTimeout(800);
  await mp.screenshot({ path: path.join(OUT, "catalogo-mobile.png"), fullPage: true });
  console.log("OK catalogo (mobile 390)");
  await mctx.close();

  await browser.close();

  if (allErrors.length) {
    console.log("\nConsole/page errors detected:");
    for (const e of allErrors) console.log(`  [${e.view}/${e.theme}]`, e.errors);
    process.exitCode = 1;
  } else {
    console.log("\nNo console/page errors across all views (light + dark).");
  }
})();
