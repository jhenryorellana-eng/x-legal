/* Mint a session cookie for the PRUEBA EVALUACION DEMO test client
 * (created via the staff alta for the evaluacion-asilo service verification).
 * Client login is phone-OTP (no SMTP in dev), so: set a password via the
 * service-role admin API first, then signInWithPassword and emit the
 * @supabase/ssr cookie value (base64url — see CLAUDE.md).
 */
const fs = require("fs");
const path = require("path");
const { createClient } = require(path.join(__dirname, "../../../node_modules/@supabase/supabase-js"));

const env = fs.readFileSync(path.join(__dirname, "../../../.env.local"), "utf8");
function get(k) {
  const m = env.match(new RegExp("^" + k + "=(.*)$", "m"));
  if (!m) return null;
  return m[1].trim().replace(/^["']/, "").replace(/["']$/, "");
}

const URL = get("NEXT_PUBLIC_SUPABASE_URL");
const ANON = get("NEXT_PUBLIC_SUPABASE_ANON_KEY") || get("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
const SERVICE = get("SUPABASE_SERVICE_ROLE_KEY");

const USER_ID = "ba2c0442-724c-49c4-b310-fe7c864cfdfb";
const EMAIL = "prueba.evaluacion.demo@example.com";
const PASSWORD = "demo-prueba-evaluacion!";

(async () => {
  const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });
  const { error: updErr } = await admin.auth.admin.updateUserById(USER_ID, {
    password: PASSWORD,
    email: EMAIL,
    email_confirm: true,
  });
  if (updErr) {
    console.error("ADMIN_UPDATE_ERROR:", updErr.message);
    process.exit(2);
  }

  const sb = createClient(URL, ANON, { auth: { persistSession: false } });
  const { data, error } = await sb.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
  if (error) {
    console.error("LOGIN_ERROR:", error.message);
    process.exit(2);
  }
  const s = data.session;
  const payload = JSON.parse(Buffer.from(s.access_token.split(".")[1], "base64").toString());
  console.log("user_kind=" + payload.user_kind + " org_id=" + (payload.org_id || "NONE"));
  const obj = {
    access_token: s.access_token,
    token_type: s.token_type,
    expires_in: s.expires_in,
    expires_at: s.expires_at,
    refresh_token: s.refresh_token,
    user: s.user,
  };
  const val = "base64-" + Buffer.from(JSON.stringify(obj)).toString("base64url");
  fs.writeFileSync(path.join(__dirname, "prueba-cookie.txt"), val);
  console.log("COOKIE_LEN=" + val.length + " written");
})();
