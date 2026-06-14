/* F3 live verification with real Chromium + real authenticated sessions.
 * Drives the ACTUAL app routes (not preview/mock) using storageState JWTs.
 *   node docs/_evidence/f3-verify/verify.cjs [baseUrl]
 * Exit 0 only if every route renders with NO server error and NO console error.
 */
const path = require("path");
const fs = require("fs");
const { chromium } = require(path.join(__dirname, "../../../node_modules/playwright"));

const BASE = process.argv[2] || "http://localhost:3000";
const OUT = __dirname;
const AUTH = path.join(__dirname, "../../../e2e/.auth");

const FILTER =
  /hydrat|caret-color|extension|Download the React DevTools|webpack-hmr|favicon|404 \(Not Found\)|Failed to load resource.*404/i;

// Detect a Next.js error overlay / crash in the DOM.
async function pageHealth(page) {
  return page.evaluate(() => {
    const body = document.body ? document.body.innerText : "";
    const bad = [
      "Internal Server Error",
      "Application error",
      "Unhandled Runtime Error",
      "This page could not be found",
      "500",
    ];
    const overlay = document.querySelector("nextjs-portal");
    const hitText = bad.find((b) => body.includes(b));
    return {
      hasOverlay: !!overlay,
      hitText: hitText || null,
      h1: (document.querySelector("h1")?.innerText || "").slice(0, 80),
      title: document.title,
      bodyLen: body.length,
    };
  });
}

async function shoot(context, route, file, opts = {}) {
  const page = await context.newPage();
  const errors = [];
  page.on("console", (m) => {
    if (m.type() === "error" && !FILTER.test(m.text())) errors.push(m.text());
  });
  page.on("pageerror", (e) => {
    if (!FILTER.test(String(e))) errors.push(String(e));
  });
  let status = "?";
  try {
    const resp = await page.goto(`${BASE}${route}`, {
      waitUntil: "domcontentloaded",
      timeout: 90000,
    });
    status = resp ? resp.status() : "no-resp";
  } catch (e) {
    errors.push(`goto failed: ${String(e).slice(0, 120)}`);
  }
  await page.waitForTimeout(2500);
  const health = await pageHealth(page);
  await page.screenshot({ path: path.join(OUT, file), fullPage: true }).catch(() => {});
  await page.close();
  const ok = !health.hasOverlay && !health.hitText && errors.length === 0;
  return { route, file, status, health, errors, ok, finalUrl: opts.url };
}

(async () => {
  const browser = await chromium.launch();
  const results = [];

  // ── Staff (Vanessa) — real ventas panel routes ──────────────────────
  const vanessa = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    storageState: path.join(AUTH, "vanessa.json"),
  });
  const staffRoutes = [
    ["/ventas/mi-dia", "staff-mi-dia.png"],
    ["/ventas/leads", "staff-leads.png"],
    ["/ventas/citas", "staff-citas.png"],
    ["/ventas/disponibilidad", "staff-disponibilidad.png"],
    ["/ventas/clientes", "staff-clientes.png"],
    ["/ventas/metricas", "staff-metricas.png"],
  ];
  for (const [r, f] of staffRoutes) results.push(await shoot(vanessa, r, f));
  await vanessa.close();

  // ── Client (María) — real case/scheduling routes ────────────────────
  const maria = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
  });
  // load maria storageState manually so we can also read it for the caseId
  const mariaState = JSON.parse(fs.readFileSync(path.join(AUTH, "maria.json"), "utf8"));
  await maria.addCookies(mariaState.cookies || []);
  const mctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    storageState: path.join(AUTH, "maria.json"),
  });
  results.push(await shoot(mctx, "/home", "client-home.png"));

  // discover María's case id from /home links, then visit agendar
  const probe = await mctx.newPage();
  let caseId = null;
  try {
    await probe.goto(`${BASE}/home`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await probe.waitForTimeout(2000);
    caseId = await probe.evaluate(() => {
      const a = Array.from(document.querySelectorAll('a[href*="/caso/"]'))[0];
      if (!a) return null;
      const m = a.getAttribute("href").match(/\/caso\/([^/]+)/);
      return m ? m[1] : null;
    });
  } catch (e) {}
  await probe.close();

  if (caseId) {
    results.push(await shoot(mctx, `/caso/${caseId}/agendar`, "client-agendar.png", { url: caseId }));
  } else {
    results.push({ route: "/caso/:id/agendar", file: "client-agendar.png", status: "skip", health: { note: "no case link on /home" }, errors: [], ok: false });
  }
  await mctx.close();
  await maria.close();

  await browser.close();

  // ── Report ──────────────────────────────────────────────────────────
  console.log("\n================ F3 LIVE VERIFICATION ================\n");
  let allOk = true;
  for (const r of results) {
    if (!r.ok) allOk = false;
    const tag = r.ok ? "PASS" : "FAIL";
    console.log(
      `[${tag}] ${r.route}  → http ${r.status}  h1="${r.health.h1 || r.health.note || ""}"`
    );
    if (r.health.hitText) console.log(`       ⚠ error text: ${r.health.hitText}`);
    if (r.health.hasOverlay) console.log(`       ⚠ Next.js error overlay present`);
    if (r.errors.length) r.errors.forEach((e) => console.log(`       ! console: ${e.slice(0, 140)}`));
  }
  console.log(`\nRESULT: ${allOk ? "ALL GREEN ✓" : "SOME FAILED ✗"}\n`);
  process.exit(allOk ? 0 : 1);
})();
