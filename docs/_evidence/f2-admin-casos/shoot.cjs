/**
 * Playwright screenshot harness — F2-W2-b (firma pública + admin casos).
 *
 * Lives under docs/_evidence (scripts/ is owned by another agent). Captures:
 *  - The public signing page with a FAKE token → uniform "link unavailable"
 *    screen (real route, no auth, must be HTTP 200).
 *  - The firmable signing view (mobile) via the dev preview.
 *  - The admin casos list + caso detalle (shared-case) via the dev preview
 *    (the panel is auth-gated; previews render with mock data).
 *
 * Run from repo root with the dev server up (ENABLE_ADMIN_PREVIEW=true):
 *   ENABLE_ADMIN_PREVIEW=true npm run dev
 *   node docs/_evidence/f2-admin-casos/shoot.cjs
 */

const { chromium } = require("playwright");
const path = require("path");

const BASE = process.env.BASE_URL || "http://localhost:3000";
const OUT = __dirname;

const NOISE = /hydrat|caret-color|extension|Download the React DevTools/i;

async function shoot(page, url, file, errors, { fullPage = true } = {}) {
  const local = [];
  const onConsole = (m) => {
    if (m.type() === "error" && !NOISE.test(m.text())) local.push(`console: ${m.text()}`);
  };
  const onError = (e) => {
    if (!NOISE.test(String(e))) local.push(`pageerror: ${e}`);
  };
  const on404 = (r) => {
    if (r.status() === 404 && !r.url().includes("favicon")) local.push(`404: ${r.url()}`);
  };
  page.on("console", onConsole);
  page.on("pageerror", onError);
  page.on("response", on404);

  const resp = await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(OUT, file), fullPage });

  page.off("console", onConsole);
  page.off("pageerror", onError);
  page.off("response", on404);
  errors.push({ file, status: resp ? resp.status() : "n/a", errors: local });
}

(async () => {
  const browser = await chromium.launch();
  const results = [];

  // ---- DESKTOP (admin, surface-staff) ----
  const desktop = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1,
  });
  await desktop.addInitScript(() => {
    try {
      window.localStorage.setItem("ulp-theme", "light");
    } catch (e) {}
  });

  let p = await desktop.newPage();
  await shoot(p, `${BASE}/admin-preview/casos`, "screenshot-desktop.png", results);
  await p.close();

  p = await desktop.newPage();
  await shoot(p, `${BASE}/admin-preview/caso-detalle`, "admin-caso-detalle.png", results);
  await p.close();

  // Dark variant of the list (token coverage).
  const desktopDark = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1,
  });
  await desktopDark.addInitScript(() => {
    try {
      window.localStorage.setItem("ulp-theme", "dark");
    } catch (e) {}
  });
  p = await desktopDark.newPage();
  await shoot(p, `${BASE}/admin-preview/casos`, "admin-casos-dark.png", results);
  await p.close();

  // ---- MOBILE (public signing surface) ----
  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  });
  await mobile.addInitScript(() => {
    try {
      window.localStorage.setItem("ulp-theme", "light");
    } catch (e) {}
  });

  // Firmable signing view (preview).
  p = await mobile.newPage();
  await shoot(p, `${BASE}/admin-preview/firma`, "screenshot-mobile.png", results);
  await p.close();

  // Real firma route with a FAKE token → uniform "link unavailable" (HTTP 200).
  p = await mobile.newPage();
  await shoot(
    p,
    `${BASE}/firma/00000000-0000-4000-8000-000000000000`,
    "firma-token-invalido.png",
    results,
  );
  await p.close();

  await browser.close();

  console.log("\n=== F2-W2-b screenshot report ===");
  for (const r of results) {
    console.log(
      `${r.file} [HTTP ${r.status}] ${r.errors.length ? "ERRORS:\n  " + r.errors.join("\n  ") : "OK (0 console errors)"}`,
    );
  }
  const totalErrors = results.reduce((n, r) => n + r.errors.length, 0);
  console.log(`\nTotal console/page errors (filtered): ${totalErrors}`);
})();
