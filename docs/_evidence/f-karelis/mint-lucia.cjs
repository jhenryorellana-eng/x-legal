/* Mints an SSR session cookie for the test client Lucía (case ULP-2026-0016, 0 docs).
 * Used to verify the Ola 2 document gate (forms locked until docs 100%). Test data. */
const fs = require("fs");
const path = require("path");
const { createClient } = require(path.join(__dirname, "../../../node_modules/@supabase/supabase-js"));

const env = fs.readFileSync(path.join(__dirname, "../../../.env.local"), "utf8");
const get = (k) => {
  const m = env.match(new RegExp("^" + k + "=(.*)$", "m"));
  return m ? m[1].trim().replace(/^["']/, "").replace(/["']$/, "") : null;
};
const URL = get("NEXT_PUBLIC_SUPABASE_URL");
const ANON = get("NEXT_PUBLIC_SUPABASE_ANON_KEY") || get("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
const SERVICE = get("SUPABASE_SERVICE_ROLE_KEY");
const UID = "fb8796c8-b6b5-41bc-aa13-e66288cd1a65";
const PASSWORD = "demo-lucia!";

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
  fs.writeFileSync(path.join(__dirname, "lucia-cookie.txt"), val);
  process.stdout.write("OK len=" + val.length);
})().catch((e) => { console.error("FAIL", e.message); process.exit(1); });
