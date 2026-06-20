// Verifies every "help" affordance points to the canonical support number.
// Waits for the dev server, then extracts the real href attributes + the
// displayed phone string from the 404 and no-access screens.
const { chromium } = require("playwright");

const BASE = "http://localhost:3100";
const EXPECTED_WA = "https://wa.me/14028248171";
const EXPECTED_TEL = "tel:+14028248171";
const EXPECTED_DISPLAY = "+1 (402) 824-8171";

async function waitReady(page) {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await page.goto(`${BASE}/no-access`, { waitUntil: "domcontentloaded", timeout: 8000 });
      if (r && r.status() < 500) return true;
    } catch { /* compiling */ }
    await page.waitForTimeout(2000);
  }
  return false;
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 402, height: 980 } });

  if (!(await waitReady(page))) { console.log("DEV NOT READY"); process.exit(1); }

  // --- no-access ---
  await page.goto(`${BASE}/no-access`, { waitUntil: "networkidle" });
  const waHref = await page.locator('a[href^="https://wa.me"]').first().getAttribute("href");
  const telHref = await page.locator('a[href^="tel:"]').first().getAttribute("href");
  const bodyText = await page.locator("body").innerText();
  const displayShown = bodyText.includes(EXPECTED_DISPLAY);
  await page.screenshot({ path: "docs/_evidence/no-access-contact.png" });

  // --- 404 ---
  await page.goto(`${BASE}/no-existe-xyz`, { waitUntil: "networkidle" });
  const wa404 = await page.locator('a[href^="https://wa.me"]').first().getAttribute("href");

  const ok =
    waHref === EXPECTED_WA &&
    telHref === EXPECTED_TEL &&
    displayShown &&
    wa404 === EXPECTED_WA;

  console.log(JSON.stringify({
    noAccess_whatsapp: waHref,
    noAccess_tel: telHref,
    noAccess_displayShown: displayShown,
    notFound_whatsapp: wa404,
    ALL_MATCH: ok,
  }, null, 2));

  await browser.close();
  process.exit(ok ? 0 : 2);
})();
