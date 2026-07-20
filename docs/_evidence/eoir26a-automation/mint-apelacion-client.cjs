/* Mints a CLIENT + a fresh Apelación (BIA) case (fase-1, plan self, active) so the
 * real client wizard can be exercised end-to-end, then writes the @supabase/ssr
 * cookie. Identity matches the Valentina fixture docs (internally consistent for the
 * Pre-Mortem). Uses the service-role client (RLS bypass). Idempotent per (client, service).
 *   node docs/_evidence/eoir26a-automation/mint-apelacion-client.cjs
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { createClient } = require(path.join(__dirname, "../../../node_modules/@supabase/supabase-js"));

const env = fs.readFileSync(path.join(__dirname, "../../../.env.local"), "utf8");
const get = (k) => { const m = env.match(new RegExp("^" + k + "=(.*)$", "m")); return m ? m[1].trim().replace(/^["']|["']$/g, "") : null; };
const URL = get("NEXT_PUBLIC_SUPABASE_URL");
const ANON = get("NEXT_PUBLIC_SUPABASE_ANON_KEY") || get("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
const SERVICE = get("SUPABASE_SERVICE_ROLE_KEY");
const ref = new (require("url").URL)(URL).host.split(".")[0];

const EMAIL = "valentina.e2e.apelacion@example.com";
const PASSWORD = "demo-valentina-e2e!";
const ORG = "a3e5f333-455a-4b3b-a5da-5a3716d24761";
const SERVICE_ID = "163a31af-7405-4475-868a-c0389dc54ab4"; // apelacion
const PLAN = "4ca33db0-de14-4a11-b0b1-8aa8808a205f";        // self
const PHASE1 = "f62fafe4-f5ef-49ac-9565-919d8c2a3ce1";      // fase-1

(async () => {
  const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });

  // 1) auth user
  const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  let user = (list?.users || []).find((u) => u.email === EMAIL);
  if (!user) {
    const { data, error } = await admin.auth.admin.createUser({ email: EMAIL, password: PASSWORD, email_confirm: true });
    if (error) throw new Error("createUser: " + error.message);
    user = data.user;
  } else {
    await admin.auth.admin.updateUserById(user.id, { password: PASSWORD, email_confirm: true });
  }
  const uid = user.id;

  // 2) public.users (client) — the access-token hook reads kind+org_id from here
  const u = await admin.from("users").upsert({ id: uid, org_id: ORG, kind: "client", email: EMAIL, locale: "es", is_active: true }, { onConflict: "id" });
  if (u.error) throw new Error("users: " + u.error.message);

  // 3) client_profiles (name matches the fixture docs)
  const p = await admin.from("client_profiles").upsert(
    { user_id: uid, first_name: "Valentina Carolina", last_name: "Rojas Medina", country_of_origin: "Venezuela" },
    { onConflict: "user_id" },
  );
  if (p.error) console.warn("client_profiles (non-fatal):", p.error.message);

  // 4) case on apelación (reuse if one already exists for this client+service)
  const { data: existing } = await admin.from("cases").select("id").eq("primary_client_id", uid).eq("service_id", SERVICE_ID).limit(1);
  let caseId;
  if (existing && existing.length) {
    caseId = existing[0].id;
  } else {
    caseId = crypto.randomUUID();
    const caseNo = "APE-E2E-" + String(Date.now()).slice(-6);
    const c = await admin.from("cases").insert({
      id: caseId, org_id: ORG, case_number: caseNo, service_id: SERVICE_ID, service_plan_id: PLAN,
      current_phase_id: PHASE1, primary_client_id: uid, status: "active", opened_at: new Date().toISOString(),
    });
    if (c.error) throw new Error("cases: " + c.error.message);
  }

  // 5) case_members (owner) — requireCaseAccess for clients reads this
  const m = await admin.from("case_members").upsert({ id: crypto.randomUUID(), case_id: caseId, user_id: uid, access_role: "owner" }, { onConflict: "case_id,user_id" });
  if (m.error) console.warn("case_members (non-fatal):", m.error.message);

  // 6) sign in + build the SSR cookie (base64url)
  const sb = createClient(URL, ANON, { auth: { persistSession: false } });
  const { data: sess, error: e2 } = await sb.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
  if (e2) throw new Error("login: " + e2.message);
  const s = sess.session;
  const payload = JSON.parse(Buffer.from(s.access_token.split(".")[1], "base64").toString());
  const obj = { access_token: s.access_token, token_type: s.token_type, expires_in: s.expires_in, expires_at: s.expires_at, refresh_token: s.refresh_token, user: s.user };
  const val = "base64-" + Buffer.from(JSON.stringify(obj)).toString("base64url");
  const cookieName = "sb-" + ref + "-auth-token";
  fs.writeFileSync(path.join(__dirname, "apelacion-e2e-cookie.json"), JSON.stringify({ name: cookieName, value: val, caseId, uid }));
  console.log("user_kind=" + payload.user_kind + " org_id=" + (payload.org_id || "NONE"));
  console.log("CASE_ID=" + caseId);
  console.log("COOKIE_NAME=" + cookieName + " LEN=" + val.length);
})().catch((e) => { console.error("FAIL", e.message); process.exit(1); });
