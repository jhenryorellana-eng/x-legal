/* Mints a session cookie for the existing test client Carlos Mendoza (owner of
 * the Asilo case with the populated team chat). Resets his password via service
 * role, signs in, prints the @supabase/ssr base64url cookie value to stdout. */
const fs = require("fs");
const path = require("path");
const { createClient } = require(path.join(__dirname, "../../node_modules/@supabase/supabase-js"));

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

(async () => {
  const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });
  const { data: u, error: e0 } = await admin.auth.admin.updateUserById(UID, { password: PASSWORD, email_confirm: true });
  if (e0) throw new Error("update: " + e0.message);
  const email = u.user.email;
  const sb = createClient(URL, ANON, { auth: { persistSession: false } });
  const { data, error } = await sb.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error("login: " + error.message);
  const s = data.session;
  const obj = {
    access_token: s.access_token, token_type: s.token_type, expires_in: s.expires_in,
    expires_at: s.expires_at, refresh_token: s.refresh_token, user: s.user,
  };
  const val = "base64-" + Buffer.from(JSON.stringify(obj)).toString("base64url");
  process.stdout.write(val);
})().catch((e) => { console.error("FAIL", e.message); process.exit(1); });
