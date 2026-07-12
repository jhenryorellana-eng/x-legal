/* Mint a Lucía client session (case 97f883f9) for the notes live walk.
 * Same mechanism as mint-carlos.cjs: ensure password via service role, sign in,
 * write the @supabase/ssr cookie value + name + length. */
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
const EMAIL = "lucia.test.asilo@example.com";
const PASSWORD = "demo-lucia!";
const ref = new (require("url").URL)(URL).host.split(".")[0];

(async () => {
  const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });
  const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const user = (list?.users || []).find((u) => u.email === EMAIL);
  if (!user) { console.error("USER_NOT_FOUND", EMAIL); process.exit(2); }
  await admin.auth.admin.updateUserById(user.id, { password: PASSWORD, email_confirm: true });

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
  const val = "base64-" + Buffer.from(JSON.stringify(obj)).toString("base64url");
  const cookieName = "sb-" + ref + "-auth-token";
  fs.writeFileSync(path.join(__dirname, "lucia-cookie.json"), JSON.stringify({ name: cookieName, value: val }));
  console.log("user_kind=" + payload.user_kind + " org_id=" + (payload.org_id || "NONE"));
  console.log("COOKIE_NAME=" + cookieName);
  console.log("COOKIE_LEN=" + val.length);
})();
