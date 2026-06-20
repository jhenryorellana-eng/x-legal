/* Mints a CLIENT + an Asilo Político case (fase-1, plan self) so the real client
 * wizard can be exercised, then writes the @supabase/ssr cookie value.
 * Usage: SBTOKEN=<mgmt-token> node docs/_evidence/a3-test/mint-asilo-client.cjs
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { createClient } = require(path.join(__dirname, "../../../node_modules/@supabase/supabase-js"));

const env = fs.readFileSync(path.join(__dirname, "../../../.env.local"), "utf8");
const get = (k) => {
  const m = env.match(new RegExp("^" + k + "=(.*)$", "m"));
  return m ? m[1].trim().replace(/^["']/, "").replace(/["']$/, "") : null;
};
const URL = get("NEXT_PUBLIC_SUPABASE_URL");
const ANON = get("NEXT_PUBLIC_SUPABASE_ANON_KEY") || get("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
const SERVICE = get("SUPABASE_SERVICE_ROLE_KEY");
const ref = new (require("url").URL)(URL).host.split(".")[0];

const EMAIL = "rosa.demo.asilo@example.com";
const PASSWORD = "demo-rosa!";
const ORG = "a3e5f333-455a-4b3b-a5da-5a3716d24761";
const SERVICE_ID = "344b44c9-0800-456d-87f7-d5c29e537d1b";
const PLAN = "c8050bb6-bb50-4316-850c-aee185c0fc4d"; // self
const PHASE1 = "10218501-fde6-488a-a11a-8b9ed4c41fc6";

const PROJ = "uexxyokexcamyjcknxua";
const sql = async (q) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROJ}/database/query`, {
    method: "POST",
    headers: { Authorization: "Bearer " + process.env.SBTOKEN, "Content-Type": "application/json" },
    body: JSON.stringify({ query: q }),
  });
  const t = await r.text();
  if (r.status >= 300) throw new Error(`SQL ${r.status}: ${t}`);
  return t ? JSON.parse(t) : [];
};

(async () => {
  const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });

  // 1) auth user (create or reuse + reset password)
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
  await sql(`insert into users (id, org_id, kind, email, locale, is_active)
             values ('${uid}', '${ORG}', 'client', '${EMAIL}', 'es', true)
             on conflict (id) do update set org_id=excluded.org_id, kind='client', is_active=true;`);

  // 3) case on Asilo (reuse if one already exists for this client+service)
  const existing = await sql(`select id::text from cases where primary_client_id='${uid}' and service_id='${SERVICE_ID}' limit 1;`);
  let caseId;
  if (existing.length) {
    caseId = existing[0].id;
  } else {
    caseId = crypto.randomUUID();
    const caseNo = "ASY-DEMO-" + String(Date.now()).slice(-6);
    await sql(`insert into cases (id, org_id, case_number, service_id, service_plan_id, current_phase_id, primary_client_id, status, opened_at)
               values ('${caseId}', '${ORG}', '${caseNo}', '${SERVICE_ID}', '${PLAN}', '${PHASE1}', '${uid}', 'active', now());`);
  }

  // 4) case_members (owner) — requireCaseAccess for clients reads this
  await sql(`insert into case_members (id, case_id, user_id, access_role)
             values ('${crypto.randomUUID()}', '${caseId}', '${uid}', 'owner')
             on conflict do nothing;`);

  // 5) sign in + build the SSR cookie (base64url, NOT std base64)
  const sb = createClient(URL, ANON, { auth: { persistSession: false } });
  const { data: sess, error: e2 } = await sb.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
  if (e2) throw new Error("login: " + e2.message);
  const s = sess.session;
  const payload = JSON.parse(Buffer.from(s.access_token.split(".")[1], "base64").toString());
  const obj = {
    access_token: s.access_token, token_type: s.token_type, expires_in: s.expires_in,
    expires_at: s.expires_at, refresh_token: s.refresh_token, user: s.user,
  };
  const val = "base64-" + Buffer.from(JSON.stringify(obj)).toString("base64url");
  const cookieName = "sb-" + ref + "-auth-token";
  fs.writeFileSync(path.join(__dirname, "asilo-cookie.json"), JSON.stringify({ name: cookieName, value: val, caseId, formId: "e7f12a89-d1dd-4478-84f3-17afff5a0b8d" }));
  console.log("user_kind=" + payload.user_kind + " org_id=" + (payload.org_id || "NONE"));
  console.log("CASE_ID=" + caseId);
  console.log("COOKIE_NAME=" + cookieName + " LEN=" + val.length);
})().catch((e) => { console.error("FAIL", e.message); process.exit(1); });
