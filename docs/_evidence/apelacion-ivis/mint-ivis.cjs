/* Mint a fresh Ivis (test client, U26-000038) session cookie for live MCP
 * verification against PROD. The account was created via the real email-OTP
 * flow (no password), so this first sets a known password via the service
 * role, then signs in with the anon key and writes the @supabase/ssr cookie
 * value (base64url — the SSR client does NOT decode standard base64).
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

const IVIS_ID = "85878b64-0034-4b0c-b6c0-53ff7f120c57";
const EMAIL = "mau252004@gmail.com";
const PASSWORD = "e2e-ivis-2026!";

(async () => {
  const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });
  const { error: upErr } = await admin.auth.admin.updateUserById(IVIS_ID, { password: PASSWORD });
  if (upErr) { console.error("SET_PASSWORD_ERROR:", upErr.message); process.exit(2); }

  const sb = createClient(URL, ANON, { auth: { persistSession: false } });
  const { data, error } = await sb.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
  if (error) { console.error("LOGIN_ERROR:", error.message); process.exit(2); }

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
  // base64url — CRITICAL: @supabase/ssr does not decode standard base64.
  const val = "base64-" + Buffer.from(JSON.stringify(obj)).toString("base64url");
  fs.writeFileSync(path.join(__dirname, "ivis-cookie.txt"), val);
  console.log("COOKIE_LEN=" + val.length + " written to ivis-cookie.txt");
})();
