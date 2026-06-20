// Quick visual evidence for the global 404 page (dev server on :3100).
// Captures mobile + desktop in both light and dark themes.
const { chromium } = require("playwright");

const URL = "http://localhost:3100/no-existe-404-test";

(async () => {
  const browser = await chromium.launch();
  const shots = [
    { name: "404-mobile-light", w: 402, h: 874, theme: "light" },
    { name: "404-mobile-dark", w: 402, h: 874, theme: "dark" },
    { name: "404-desktop-light", w: 1280, h: 860, theme: "light" },
  ];
  for (const s of shots) {
    const ctx = await browser.newContext({
      viewport: { width: s.w, height: s.h },
      colorScheme: s.theme,
    });
    const page = await ctx.newPage();
    const resp = await page.goto(URL, { waitUntil: "networkidle" });
    // The brand theme is driven by data-theme on <html>; force it to match.
    await page.evaluate((t) => {
      document.documentElement.setAttribute("data-theme", t);
    }, s.theme);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `docs/_evidence/${s.name}.png`, fullPage: false });
    console.log(`${s.name}: HTTP ${resp.status()} -> docs/_evidence/${s.name}.png`);
    await ctx.close();
  }
  await browser.close();
})();
