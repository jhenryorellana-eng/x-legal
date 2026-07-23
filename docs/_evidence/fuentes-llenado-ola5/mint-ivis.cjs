/* Mint an Ivis Palma client session (U26-000038) for the client-platform walk.
 * Post phone-identity migration her auth email is the synthetic
 * <phone>@clients.usalatinoprime.com. Sets her password (service role, idempotent),
 * signs in with the synthetic email, writes the @supabase/ssr cookie name+value. */
const fs = require("fs");
const path = require("path");
const { createClient } = require(path.join(__dirname, "../../../node_modules/@supabase/supabase-js"));

const env = fs.readFileSync(path.join(__dirname, "../../../.env.local"), "utf8");
const get = (k) => { const m = env.match(new RegExp("^" + k + "=(.*)$", "m")); return m ? m[1].trim().replace(/^["']/, "").replace(/["']$/, "") : null; };

const URL = get("NEXT_PUBLIC_SUPABASE_URL");
const ANON = get("NEXT_PUBLIC_SUPABASE_ANON_KEY") || get("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
const SERVICE = get("SUPABASE_SERVICE_ROLE_KEY");
const USER_ID = "85878b64-0034-4b0c-b6c0-53ff7f120c57"; // Ivis (case U26-000038)
const EMAIL = "13466094183@clients.usalatinoprime.com"; // synthetic auth email
const PASSWORD = "demo-ivis!";
const ref = new (require("url").URL)(URL).host.split(".")[0];

(async () => {
  const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });
  await admin.auth.admin.updateUserById(USER_ID, { password: PASSWORD, email_confirm: true });

  const sb = createClient(URL, ANON, { auth: { persistSession: false } });
  const { data, error } = await sb.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
  if (error) { console.error("LOGIN_ERROR:", error.message); process.exit(2); }

  const s = data.session;
  const payload = JSON.parse(Buffer.from(s.access_token.split(".")[1], "base64").toString());
  const obj = {
    access_token: s.access_token, token_type: s.token_type, expires_in: s.expires_in,
    expires_at: s.expires_at, refresh_token: s.refresh_token, user: s.user,
  };
  const val = "base64-" + Buffer.from(JSON.stringify(obj)).toString("base64url");
  const cookieName = "sb-" + ref + "-auth-token";
  fs.writeFileSync(path.join(__dirname, "ivis-cookie.json"), JSON.stringify({ name: cookieName, value: val }));
  console.log("user_kind=" + payload.user_kind + " org_id=" + (payload.org_id || "NONE"));
  console.log("COOKIE_NAME=" + cookieName);
  console.log("COOKIE_LEN=" + val.length);
  process.exit(0);
})();
