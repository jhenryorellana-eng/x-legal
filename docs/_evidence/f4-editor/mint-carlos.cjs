/* Mint a Carlos client session for the F4 wizard live walk.
 * Ensures his password via the service role (idempotent), signs in, verifies the
 * user_kind claim, and writes the @supabase/ssr cookie value + name + length.
 */
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
const EMAIL = "carlos.ramirez.demo@example.com";
const PASSWORD = "demo-carlos!";
const ref = new (require("url").URL)(URL).host.split(".")[0];

(async () => {
  // 1) ensure password via service role (idempotent)
  const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });
  const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const user = (list?.users || []).find((u) => u.email === EMAIL);
  if (!user) { console.error("USER_NOT_FOUND", EMAIL); process.exit(2); }
  await admin.auth.admin.updateUserById(user.id, { password: PASSWORD, email_confirm: true });

  // 2) sign in as Carlos
  const sb = createClient(URL, ANON, { auth: { persistSession: false } });
  const { data, error } = await sb.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
  if (error) { console.error("LOGIN_ERROR:", error.message); process.exit(2); }

  const s = data.session;
  const payload = JSON.parse(Buffer.from(s.access_token.split(".")[1], "base64").toString());
  const obj = {
    access_token: s.access_token,
    token_type: s.token_type,
    expires_in: s.expires_in,
    expires_at: s.expires_at,
    refresh_token: s.refresh_token,
    user: s.user,
  };
  // @supabase/ssr stores the session as "base64-" + base64URL(JSON) (NOT std base64).
  const val = "base64-" + Buffer.from(JSON.stringify(obj)).toString("base64url");
  const cookieName = "sb-" + ref + "-auth-token";
  fs.writeFileSync(path.join(__dirname, "carlos-cookie.json"), JSON.stringify({ name: cookieName, value: val }));
  console.log("user_kind=" + payload.user_kind + " org_id=" + (payload.org_id || "NONE"));
  console.log("COOKIE_NAME=" + cookieName);
  console.log("COOKIE_LEN=" + val.length);
})();
