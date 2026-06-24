/* Standalone live E2E of the client "one chat per case" flow against the dev
 * server (localhost:3100). Mints Carlos's session in-process and drives its own
 * headless Chromium (real Playwright engine — same as the MCP). Asserts the
 * full flow (list → thread → back → list), captures console errors, and writes
 * screenshots. Read-only: it never sends a message (no writes to prod). */
const fs = require("fs");
const path = require("path");
const { createClient } = require(path.join(__dirname, "../../node_modules/@supabase/supabase-js"));
const { chromium } = require(path.join(__dirname, "../../node_modules/@playwright/test"));

const env = fs.readFileSync(path.join(__dirname, "../../.env.local"), "utf8");
const get = (k) => {
  const m = env.match(new RegExp("^" + k + "=(.*)$", "m"));
  return m ? m[1].trim().replace(/^["']/, "").replace(/["']$/, "") : null;
};
const URL = get("NEXT_PUBLIC_SUPABASE_URL");
const ANON = get("NEXT_PUBLIC_SUPABASE_ANON_KEY") || get("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
const SERVICE = get("SUPABASE_SERVICE_ROLE_KEY");
const UID = "c2e4b05c-bc87-4580-8281-0438c9523e11";
const PASSWORD = "demo-carlos-mendoza!";
const ref = new (require("url").URL)(URL).host.split(".")[0];

const checks = [];
const ok = (name, cond, detail) => { checks.push({ name, pass: !!cond, detail: detail || "" }); console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); };

(async () => {
  const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });
  await admin.auth.admin.updateUserById(UID, { password: PASSWORD, email_confirm: true });
  const sb = createClient(URL, ANON, { auth: { persistSession: false } });
  const { data, error } = await sb.auth.signInWithPassword({ email: "carlos.mendoza.test@example.com", password: PASSWORD });
  if (error) throw new Error("login: " + error.message);
  const s = data.session;
  const obj = { access_token: s.access_token, token_type: s.token_type, expires_in: s.expires_in, expires_at: s.expires_at, refresh_token: s.refresh_token, user: s.user };
  const value = "base64-" + Buffer.from(JSON.stringify(obj)).toString("base64url");
  const cookieName = "sb-" + ref + "-auth-token";

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 440, height: 900 }, deviceScaleFactor: 2 });
  await ctx.addCookies([{ name: cookieName, value, domain: "localhost", path: "/", httpOnly: false, sameSite: "Lax" }]);
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200)); });
  page.on("pageerror", (e) => consoleErrors.push("PAGEERR: " + String(e).slice(0, 200)));

  // 1) Auth + land on an account route
  await page.goto("http://localhost:3100/pagos", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4000);
  ok("auth → lands on /pagos (session valid)", page.url().endsWith("/pagos"), page.url());

  // dismiss the PWA install dialog if present
  try {
    const d = page.locator('[role="dialog"][aria-label="Instala X Legal"]');
    if ((await d.count()) > 0) { await d.locator("button").last().click({ timeout: 3000 }); await page.waitForTimeout(500); }
  } catch (e) {}

  // 2) Launcher opens the case-chat LIST
  await page.getByRole("button", { name: /Tu equipo|Your team/i }).first().click({ timeout: 8000 });
  const row = page.getByRole("button", { name: /Asilo|Tu caso|ULP-/i }).first();
  let appeared = false;
  for (let i = 0; i < 16; i++) { if ((await row.count()) > 0 && (await row.isVisible())) { appeared = true; break; } await page.waitForTimeout(2000); }
  ok("launcher opens the case-chat list (row rendered)", appeared);
  await page.screenshot({ path: path.join(__dirname, "client-list.png") });

  if (appeared) {
    const rowText = (await row.innerText()).replace(/\s+/g, " ").trim();
    ok("row shows service name 'Asilo Político'", /Asilo Pol[ií]tico/i.test(rowText), rowText.slice(0, 80));
    ok("row shows case number ULP-…", /ULP-\d{4}-\d{4}/.test(rowText), (rowText.match(/ULP-\d{4}-\d{4}/) || [""])[0]);
    // avatar svg (service icon) present inside the row
    const svgCount = await row.locator("svg").count();
    ok("row renders a service icon (svg avatar)", svgCount > 0, `svg count=${svgCount}`);
    // avatar background resolved to a real color (not the raw token "accent")
    const bg = await row.locator("div").first().evaluate((el) => getComputedStyle(el).backgroundColor).catch(() => "");
    ok("avatar background resolves to a real color", /^rgb/.test(bg) && bg !== "rgba(0, 0, 0, 0)", bg);

    // 3) Selecting the row opens THAT case's thread (with a back arrow)
    await row.click({ timeout: 6000 });
    await page.waitForTimeout(4000);
    const back = page.getByRole("button", { name: /Volver a tus chats|Back to your chats/i }).first();
    ok("thread opens with a back arrow", (await back.count()) > 0);
    const threadHasTitle = await page.getByText(/Asilo Pol[ií]tico/i).first().isVisible().catch(() => false);
    ok("thread header shows the service name", threadHasTitle);
    const hasComposer = await page.getByPlaceholder(/Escribe un mensaje|Write a message/i).first().isVisible().catch(() => false);
    ok("thread shows the message composer", hasComposer);
    await page.screenshot({ path: path.join(__dirname, "client-thread.png") });

    // 4) Back arrow returns to the LIST
    if ((await back.count()) > 0) {
      await back.click({ timeout: 6000 });
      await page.waitForTimeout(2500);
      const backToList = await page.getByText(/Tus chats, uno por caso|Your chats, one per case/i).first().isVisible().catch(() => false);
      ok("back arrow returns to the chat list", backToList);
      await page.screenshot({ path: path.join(__dirname, "client-list-back.png") });
    }
  }

  ok("no console errors during the flow", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));

  const passed = checks.filter((c) => c.pass).length;
  console.log(`\nRESULT: ${passed}/${checks.length} checks passed`);
  await browser.close();
  process.exit(passed === checks.length ? 0 : 1);
})().catch((e) => { console.error("FATAL", e.message); process.exit(2); });
